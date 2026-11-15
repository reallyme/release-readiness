// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCargoReleaseVersions, assertPublicReleaseVersion, containsCommit, findAndroidMavenArtifact,
  findCarriedLaneEvidence, findPackageArtifacts, findPreflightCiReceipt, findPublicCiRun, findPublicPreflightRun, laneOutcome, publicPreflightTitle,
} from "../scripts/public-release.mjs";

const selectedRun = (...args) => findPublicCiRun(...args)?.runId ?? null;

const version = "1.2.3";
const tag = "reallyme-example-v1.2.3";
const repository = "reallyme/example";
const sha = "a".repeat(40);
const releaseFixture = () => {
  const release = {
    tagPrefix: "reallyme-example-v",
    channels: new Map([
      ["npm", { manifests: ["packages/ts/package.json"] }],
      ["swift", {}],
      ["maven", { manifests: ["packages/kotlin/build.gradle.kts", "packages/android/build.gradle.kts"] }],
    ]),
  };
  const manifest = new Map([
    ["Package.swift", 'private let packageVersion = "1.2.3" // release\n'],
    ["packages/kotlin/build.gradle.kts", 'version = "1.2.3"\n'],
    ["packages/android/build.gradle.kts", 'version = "1.2.3"\n'],
    ["packages/ts/package.json", JSON.stringify({ name: "@reallyme/example", version })],
    ["packages/ts/package-lock.json", JSON.stringify({ version, packages: { "": { version } } })],
  ]);
  const context = {
    fail: assert.fail,
    readText: (path) => manifest.get(path) ?? "workflow",
    readJson: (path) => JSON.parse(manifest.get(path)),
  };
  return { release, context, manifest, tracked: new Set(manifest.keys()) };
};

test("public release contract keeps every declared package and tag on one version", () => {
  const { release, context, manifest, tracked } = releaseFixture();
  const check = (expected = version, expectedTag = tag) =>
    assertPublicReleaseVersion(context, tracked, release, expected, expectedTag);
  check();
  assert.throws(() => check("v1.2.3"), /enter a stable release version/u);
  assert.throws(() => check(version, "v1.2.3"), /same stable version/u);
  for (const [path, contents] of [
    ["Package.swift", 'let packageVersion = "1.2.4"\n'],
    ["packages/android/build.gradle.kts", 'version = "1.2.4"\n'],
    ["packages/kotlin/build.gradle.kts", "version = releaseVersion\n"],
    ["packages/ts/package.json", JSON.stringify({ name: "@reallyme/example", version: "1.2.4" })],
    ["packages/ts/package-lock.json", JSON.stringify({ version, packages: { "": { version: "1.2.4" } } })],
  ]) {
    const previous = manifest.get(path);
    manifest.set(path, contents);
    assert.throws(() => check(), /must declare the repository release version/u);
    manifest.set(path, previous);
  }
  manifest.set("Package.swift", "let package = Package(name: \"Example\")\n");
  check();
});

test("preflight can reuse only the exact main CI run and its successful aggregate job", () => {
  const run = {
    path: ".github/workflows/ci.yml", head_repository: { full_name: repository }, head_branch: "main",
    head_sha: sha, event: "push", status: "completed", conclusion: "success", id: 42, run_attempt: 2,
  };
  const job = { name: "Required CI", run_id: 42, head_sha: sha, status: "completed", conclusion: "success" };
  assert.equal(selectedRun([run], repository, sha, ({ run_attempt }) => {
    assert.equal(run_attempt, 2);
    return [job];
  }), 42);
  assert.equal(selectedRun([{ ...run, event: "workflow_dispatch" }], repository, sha, () => [job]), 42);
  for (const changedRun of [
    { event: "pull_request" }, { event: "merge_group" }, { head_branch: "feature" },
    { head_sha: "b".repeat(40) }, { head_repository: { full_name: "elsewhere/example" } },
    { path: ".github/workflows/something.yml" }, { conclusion: "failure" }, { run_attempt: null },
  ]) {
    assert.equal(selectedRun([{ ...run, ...changedRun }], repository, sha, () => [job]), null);
  }
  for (const jobs of [
    [], [job, job], [{ ...job, conclusion: "skipped" }], [{ ...job, run_id: 23 }],
    [{ ...job, head_sha: "b".repeat(40) }], [{ ...job, name: "Other CI" }],
  ]) {
    assert.equal(selectedRun([run], repository, sha, () => jobs), null);
  }
  const queueBranch = `gh-readonly-queue/main/pr-12-${"c".repeat(40)}`;
  const queued = { ...run, event: "merge_group", head_branch: queueBranch };
  assert.equal(selectedRun([queued], repository, sha, () => [job]), null);
  assert.equal(selectedRun([queued], repository, sha, () => [job], { mergeQueue: true }), 42);
  for (const head_branch of ["main", "gh-readonly-queue/feature/pr-12-" + "c".repeat(40), "gh-readonly-queue/main/pr-12"]) {
    assert.equal(selectedRun([{ ...queued, head_branch }], repository, sha, () => [job], { mergeQueue: true }), null);
  }
});

test("a skipped path-scoped lane needs an unchanged earlier result to qualify a release", () => {
  const ancestor = "c".repeat(40);
  const older = "d".repeat(40);
  const runAt = (head_sha, id, extra = {}) => ({
    path: ".github/workflows/ci.yml", head_repository: { full_name: repository }, head_branch: "main",
    head_sha, event: "push", status: "completed", conclusion: "success", id, run_attempt: 1, ...extra,
  });
  const done = (name, conclusion = "success") => ({ name, status: "completed", conclusion });
  const lane = (name, inputs) => ({
    name, scoped: true, inputsChanged: (paths) => paths.some((path) => inputs.some((rule) => path.startsWith(rule))),
  });
  const lanes = [
    { name: "policy", scoped: false, inputsChanged: () => true },
    lane("code", ["crates/"]), lane("swift", ["packages/swift/"]),
  ];
  const jobsFor = (shape) => (run) => shape(run).map((job) => ({ ...job, run_id: run.id, head_sha: run.head_sha }));
  const candidateJobs = [
    done("Identify CI lanes"), done("policy / checks"), done("code / test"), done("swift", "skipped"), done("Required CI"),
  ];
  const fullJobs = [
    done("Identify CI lanes"), done("policy / checks"), done("code / test"), done("swift / build"), done("Required CI"),
  ];
  const candidate = runAt(sha, 50);

  // Pure selection: an ancestor where swift ran, with no swift input changes since.
  const history = [
    runAt(ancestor, 40), runAt(older, 30), runAt(sha, 50), runAt("e".repeat(40), 45, { conclusion: "failure" }),
  ];
  const io = (changes, ancestors = new Set([ancestor, older])) => ({
    listJobs: jobsFor(() => fullJobs),
    isAncestor: (base) => ancestors.has(base),
    changedPaths: (base) => changes.get(base) ?? null,
  });
  const swift = [lanes[2]];
  const find = (input, runs = history, mergeQueue = false) =>
    findCarriedLaneEvidence(swift, runs, repository, sha, mergeQueue, input);
  const docsOnly = new Map([[ancestor, ["README.md"]], [older, ["README.md", "packages/swift/A.swift"]]]);
  assert.deepEqual(find(io(docsOnly)), new Map([["swift", { runId: 40, runAttempt: 1, sha: ancestor }]]));
  // An older unchanged result still counts after a newer one changed; a changed result never does.
  assert.deepEqual(find(io(new Map([[ancestor, ["packages/swift/A.swift"]], [older, ["README.md"]]]))),
    new Map([["swift", { runId: 30, runAttempt: 1, sha: older }]]));
  assert.equal(find(io(new Map([[ancestor, ["packages/swift/A.swift"]], [older, ["packages/swift/B.swift"]]]))), null);
  // Not an ancestor, an unreadable diff, a run where the lane was skipped, or a failed gate is no evidence.
  assert.equal(find(io(docsOnly, new Set())), null);
  assert.equal(find(io(new Map())), null);
  assert.equal(find({ ...io(docsOnly), listJobs: jobsFor(() => candidateJobs) }), null);
  assert.equal(find({ ...io(docsOnly), listJobs: jobsFor(() => fullJobs.filter((job) => job.name !== "Required CI")) }), null);
  // Queue runs count only with a merge queue configured.
  const queued = [runAt(ancestor, 40, { event: "merge_group", head_branch: `gh-readonly-queue/main/pr-3-${"f".repeat(40)}` })];
  assert.equal(find(io(docsOnly), queued), null);
  assert.equal(find(io(docsOnly), queued, true).get("swift").runId, 40);

  // Run selection: a skipped scoped lane qualifies only when carry-forward finds evidence.
  const carried = new Map([["swift", { runId: 40, runAttempt: 1, sha: ancestor }]]);
  const select = (carryForward, jobs = candidateJobs, run = candidate) =>
    findPublicCiRun([run], repository, sha, jobsFor(() => jobs), { lanes, carryForward });
  assert.deepEqual(select((skipped) => {
    assert.deepEqual(skipped.map(({ name }) => name), ["swift"]);
    return carried;
  }), { runId: 50, runAttempt: 1, carried });
  assert.equal(select(() => null), null);
  assert.deepEqual(select(() => assert.fail("no lane was skipped"), fullJobs), { runId: 50, runAttempt: 1, carried: new Map() });
  // An unrecognized job shape for a scoped lane is not evidence.
  const relabeled = candidateJobs.map((job) => (job.name === "swift" ? { ...job, name: "swift / build" } : job));
  assert.equal(select(() => carried, relabeled), null);
  assert.equal(select(() => carried, candidateJobs.filter((job) => job.name !== "swift")), null);
  // Unscoped lanes rely on Required CI and need no job evidence.
  assert.deepEqual(select(() => assert.fail("no scoped lane was skipped"), fullJobs.filter((job) => job.name !== "policy / checks")),
    { runId: 50, runAttempt: 1, carried: new Map() });
  // A dispatch at the release SHA runs every lane by construction.
  assert.deepEqual(select(() => assert.fail("a dispatch runs every lane"), [done("Required CI")], { ...candidate, event: "workflow_dispatch" }),
    { runId: 50, runAttempt: 1, carried: new Map() });
  // Channel evidence such as the Android publication is checked on the selected run.
  const evidence = { lanes, carryForward: () => carried, acceptsRun: ({ id }) => id === 50 };
  assert.equal(findPublicCiRun([candidate, runAt(sha, 51)], repository, sha, jobsFor(() => candidateJobs), evidence).runId, 50);
  assert.equal(findPublicCiRun([candidate], repository, sha, jobsFor(() => candidateJobs), {
    lanes, acceptsRun: () => false, carryForward: () => assert.fail("missing artifact should skip history"),
  }), null);
  assert.equal(find({ ...io(docsOnly), timeRemaining: () => 0, listJobs: () => assert.fail("search budget expired") }), null);

  assert.equal(laneOutcome([done("code / a"), done("code / b", "skipped")], "code"), "ran");
  assert.equal(laneOutcome([done("code", "skipped")], "code"), "skipped");
  for (const jobs of [
    [], [done("code")], [done("code", "skipped"), done("code / a")],
    [{ ...done("code / a"), status: "in_progress" }], [done("code / a", "skipped")],
  ]) {
    assert.equal(laneOutcome(jobs, "code"), "unknown");
  }
});

test("release evidence requires main to contain the selected commit", () => {
  assert.equal(containsCommit({ status: "ahead", behind_by: 0 }), true);
  assert.equal(containsCommit({ status: "identical", behind_by: 0 }), true);
  for (const comparison of [
    { status: "behind", behind_by: 2 }, { status: "diverged", behind_by: 1 }, { status: "ahead", behind_by: 1 },
    { status: "ahead" }, null, [], "ahead",
  ]) {
    assert.equal(containsCommit(comparison), false);
  }
});

test("crate version checks skip workspace members that never publish", () => {
  const context = { fail: assert.fail };
  const member = (name, crateVersion, publish = null) => ({ id: `${name} 1`, name, version: crateVersion, publish });
  const metadata = (...packages) => ({ packages, workspace_members: packages.map(({ id }) => id) });
  assertCargoReleaseVersions(context, metadata(member("core", version), member("xtask", "0.0.0", [])), version);
  assertCargoReleaseVersions(context, metadata(member("core", version, ["crates-io"])), version);
  for (const [input, diagnostic] of [
    [metadata(member("core", "1.2.2")), /Cargo package core must declare/u],
    [metadata(member("xtask", "0.0.0", [])), /at least one publishable workspace member/u],
    [metadata(member("core", version, "crates-io")), /invalid publish setting for core/u],
    [metadata(member("core", version, [7])), /invalid publish setting for core/u],
    [{ packages: [], workspace_members: [] }, /must identify the release workspace members/u],
    [{ packages: [member("core", version)], workspace_members: ["missing 1"] }, /omitted a release workspace member/u],
  ]) {
    assert.throws(() => assertCargoReleaseVersions(context, input, version), diagnostic);
  }
});

test("publication accepts preflight only for the declared workflow, SHA and exact version", () => {
  const workflow = "swift-check.yml";
  const run = {
    path: `.github/workflows/${workflow}`, head_repository: { full_name: repository }, head_branch: "main",
    head_sha: sha, event: "workflow_dispatch", status: "completed", conclusion: "success", id: 42, run_attempt: 1,
    display_title: publicPreflightTitle("swift", version, sha),
  };
  const find = (runs) => findPublicPreflightRun(runs, repository, workflow, "swift", version, sha);
  assert.equal(find([run, { ...run, id: 43 }]), 43);
  for (const changedRun of [
    { path: ".github/workflows/other.yml" }, { head_sha: "b".repeat(40) },
    { display_title: publicPreflightTitle("swift", "1.2.4", sha) },
    { event: "pull_request" }, { conclusion: "failure" }, { status: "in_progress" },
  ]) {
    assert.equal(find([{ ...run, ...changedRun }]), null);
  }
});

test("publish selects the newest reusable CI receipt bound to the qualifying preflight", () => {
  const preflight = { id: 92, run_attempt: 2, head_branch: "main" };
  const receipt = {
    id: 200, name: "release-readiness-ci-1-91", expired: false, size_in_bytes: 400,
    digest: `sha256:${"d".repeat(64)}`,
    workflow_run: { id: preflight.id, head_sha: sha, head_branch: "main" },
  };
  const check = (artifacts) => findPreflightCiReceipt(artifacts, preflight, sha);
  const newer = { ...receipt, id: 201, name: "release-readiness-ci-2-97" };
  assert.equal(check([receipt]), 91);
  assert.equal(check([newer, receipt]), 97);
  assert.equal(check([receipt, { ...newer, name: "release-readiness-ci-3-97" }]), 91);
  for (const artifacts of [
    [], [newer, { ...newer, id: 300, name: "release-readiness-ci-2-98" }],
    [receipt, { ...newer, expired: true }], [{ ...receipt, digest: "unverified" }],
    [{ ...receipt, workflow_run: { ...receipt.workflow_run, id: 93 } }],
    [{ ...receipt, workflow_run: { ...receipt.workflow_run, head_sha: "c".repeat(40) } }],
    [{ ...receipt, workflow_run: { ...receipt.workflow_run, head_branch: "feature" } }],
    [{ ...receipt, name: "release-readiness-ci-1-9007199254740992" }],
  ]) {
    assert.equal(check(artifacts), null);
  }
});

test("Maven preflight accepts only one usable Android artifact from the qualified run", () => {
  const runId = 42;
  const artifact = {
    id: 206, name: `android-maven-${sha}`, expired: false, size_in_bytes: 400,
    digest: `sha256:${"d".repeat(64)}`,
    workflow_run: { id: runId, head_sha: sha, head_branch: "main" },
  };
  const run = { id: runId, head_branch: "main" };
  const check = (artifacts, qualifyingRun = run) => findAndroidMavenArtifact(artifacts, qualifyingRun, sha);
  assert.equal(check([artifact]), 206);
  assert.equal(check([artifact, { name: "other" }]), 206);
  assert.equal(check([artifact, { ...artifact, id: 207 }]), null);
  for (const change of [
    { expired: true }, { digest: null }, { size_in_bytes: 0 }, { name: "android-4.2.0" },
    { workflow_run: { ...artifact.workflow_run, id: 43 } },
    { workflow_run: { ...artifact.workflow_run, head_sha: "b".repeat(40) } },
    { workflow_run: { ...artifact.workflow_run, head_branch: "feature" } },
  ]) {
    assert.equal(check([{ ...artifact, ...change }]), null);
  }
  // A merge-queue run's artifact carries the queue branch it was built on.
  const queueBranch = `gh-readonly-queue/main/pr-12-${"c".repeat(40)}`;
  const queued = { ...artifact, workflow_run: { ...artifact.workflow_run, head_branch: queueBranch } };
  assert.equal(check([queued], { id: runId, head_branch: queueBranch }), 206);
  assert.equal(check([queued]), null);
  assert.equal(check([artifact], { id: runId }), null);
});

test("publish selects the entire digested package set from one preflight", () => {
  const run = { id: 20, head_branch: "main" };
  const artifact = {
    name: "archive",
    id: 22,
    expired: false,
    size_in_bytes: 100,
    digest: `sha256:${"9".repeat(64)}`,
    workflow_run: { id: run.id, head_sha: sha, head_branch: "main" },
  };
  const evidence = { ...artifact, name: "attestation", id: 23 };
  const names = ["archive", "attestation"];
  assert.deepEqual(findPackageArtifacts([evidence, artifact], run, sha, names), [22, 23]);
  for (const artifacts of [
    [artifact],
    [artifact, evidence, { ...artifact, id: 24 }],
    [artifact, { ...evidence, id: 22 }],
    [artifact, { ...evidence, digest: null }],
    [artifact, { ...evidence, expired: true }],
    [artifact, { ...evidence, workflow_run: { ...artifact.workflow_run, id: 19 } }],
    [artifact, { ...evidence, workflow_run: { ...artifact.workflow_run, head_sha: "b".repeat(40) } }],
  ]) {
    assert.equal(findPackageArtifacts(artifacts, run, sha, names), null);
  }
});
