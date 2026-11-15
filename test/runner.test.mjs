// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runnerPath = fileURLToPath(new URL("../scripts/run-consumer-check.mjs", import.meta.url));
const corePath = fileURLToPath(new URL("../core.mjs", import.meta.url));
const publicRepoPolicyPath = fileURLToPath(new URL("../scripts/public-repo-policy.mjs", import.meta.url));
const publicCiPath = fileURLToPath(new URL("../scripts/public-ci.mjs", import.meta.url));
const publicReleasePath = fileURLToPath(new URL("../scripts/public-release.mjs", import.meta.url));
const claTemplate = readFileSync(new URL("../templates/cla.yaml", import.meta.url), "utf8");
const claPath = ".github/workflows/cla.yaml";
const mavenBundlePath = "scripts/maven-central-bundle.local.sh";
const mavenBundleFixture = "#!/usr/bin/env bash\nexit 0\n";

const createConsumer = () => {
  const root = mkdtempSync(join(tmpdir(), "reallyme-release-runner-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, "scripts", "check_release_readiness.mjs"),
    "process.exit(0);\n",
  );
  const gitInit = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const gitAdd = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  return root;
};

const runConsumer = (root, selectedRunnerPath = runnerPath, env = {}, args = []) =>
  spawnSync(process.execPath, [selectedRunnerPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_ACTIONS: "",
      GITHUB_EVENT_PATH: "",
      GITHUB_REPOSITORY: "",
      RELEASE_READINESS_PUBLIC_REPO: "",
      ...env,
    },
  });

const stageFiles = (root, ...paths) => {
  const result = spawnSync("git", ["add", "--", ...paths], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};

const reusableHeader = (job) => `on:
  workflow_call:
    outputs:
      verified_sha:
        value: \${{ jobs.${job}.outputs.verified_sha }}
`;
const releaseWorkflow = (ecosystem, phase, tagOwner = false) => {
  const upload = phase === "preflight" ? `      - name: Record verified CI
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9
        with:
          name: release-readiness-ci-\${{ github.run_attempt }}-\${{ steps.candidate.outputs.ci_run_id }}
          path: \${{ runner.temp }}/release-readiness-ci.json
          if-no-files-found: error
` : "";
  const outputs = phase === "publish" ? `    outputs:
      preflight_run_id: \${{ steps.candidate.outputs.preflight_run_id }}
      package_artifact_ids: \${{ steps.candidate.outputs.package_artifact_ids }}
` : "";
  const work = phase === "preflight" ? `  prepare:
    needs: verify
    runs-on: ubuntu-24.04
    steps:
      - name: Prepare package
        run: echo prepare
` : `  publish:
    needs: [verify]
    runs-on: ubuntu-24.04
    permissions:
      actions: read
      contents: ${tagOwner ? "write" : "read"}
    steps:
      - name: Download verified package
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333
        with:
          run-id: \${{ needs.verify.outputs.preflight_run_id }}
          artifact-ids: \${{ needs.verify.outputs.package_artifact_ids }}
          github-token: \${{ github.token }}
          digest-mismatch: error
      - name: Publish package
        run: echo publish
`;
  return `name: ${ecosystem} ${phase}
run-name: Preflight ${ecosystem} \${{ inputs.version }} \${{ inputs.source_sha }}
on: workflow_dispatch
permissions:
  actions: read
  contents: read
jobs:
  verify:
    runs-on: ubuntu-24.04
${outputs}    steps:
      - name: Verify release candidate
        id: candidate
        run: node .release-readiness/scripts/run-consumer-check.mjs --check-release ${ecosystem} ${phase} "$RELEASE_VERSION" "$RELEASE_TAG" "$SOURCE_SHA"
${upload}${work}`;
};
const installStandardCi = (root, additionalLanes = {}, release) => {
  writeFileSync(join(root, ".github/release-readiness.json"), JSON.stringify({
    schema: 1,
    lanes: { policy: { workflow: "policy.yml" }, ...additionalLanes },
    release,
  }));
  writeFileSync(join(root, ".github/workflows/policy.yml"), `${reusableHeader("verify")}jobs:
  verify:
    runs-on: ubuntu-24.04
    steps:
      - name: Checkout candidate
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          persist-credentials: false
      - name: Checkout policy
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          repository: reallyme/release-readiness
          ref: ${"a".repeat(40)}
          persist-credentials: false
          path: .release-readiness
      - name: Run release readiness checks
        run: node .release-readiness/scripts/run-consumer-check.mjs
`);
  stageFiles(root, ".github/release-readiness.json", ".github/workflows/policy.yml");
  const render = runConsumer(root, runnerPath, {}, ["--render-ci"]);
  assert.equal(render.status, 0, render.stderr);
  writeFileSync(join(root, ".github/workflows/ci.yml"), render.stdout);
  stageFiles(root, ".github/workflows/ci.yml");
  return render.stdout;
};

test("public ReallyMe Actions runs require the tracked canonical CLA workflow", (t) => {
  const root = createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const eventPath = join(root, "event.json");
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: "reallyme/example",
    RELEASE_READINESS_PUBLIC_REPO: "false",
  };
  writeFileSync(eventPath, JSON.stringify({ repository: { full_name: env.GITHUB_REPOSITORY, private: false } }));
  const check = () => runConsumer(root, runnerPath, env);
  const missing = check();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /must track exactly one CLA workflow/u);

  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, claPath), claTemplate);
  const untracked = check();
  assert.equal(untracked.status, 1);
  assert.match(untracked.stderr, /must track exactly one CLA workflow/u);
  stageFiles(root, claPath);
  const noPlan = check();
  assert.equal(noPlan.status, 1);
  assert.match(noPlan.stderr, /must track \.github\/release-readiness\.json/u);
  installStandardCi(root);
  const accepted = check();
  assert.equal(accepted.status, 0, accepted.stderr);

  for (const modified of [
    claTemplate.replace("/main/CLA.md", "/main/CONTRIBUTING.md"),
    claTemplate.replace(/@\b[0-9a-f]{40}\b/u, "@v3.2.0"),
    claTemplate.replace("require-opener-as-author: 'true'", "require-opener-as-author: 'false'"),
    claTemplate + "      - uses: actions/checkout@v7\n",
  ]) {
    assert.notEqual(modified, claTemplate);
    writeFileSync(join(root, claPath), modified);
    const rejected = check();
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /must match templates\/cla.yaml/u);
  }
  writeFileSync(join(root, claPath), claTemplate);
  writeFileSync(join(root, ".github/workflows/cla.yml"), claTemplate);
  const untrackedAlternate = check();
  assert.equal(untrackedAlternate.status, 1);
  assert.match(untrackedAlternate.stderr, /cla\.yml must not exist/u);
  stageFiles(root, ".github/workflows/cla.yml");
  const duplicate = check();
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /must track exactly one CLA workflow/u);
});

test("local public checks accept the .yml filename and reject symbolic links", (t) => {
  const root = createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { RELEASE_READINESS_PUBLIC_REPO: "true" };
  const workflow = ".github/workflows/cla.yml";
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, workflow), claTemplate.replaceAll("\n", "\r\n"));
  stageFiles(root, workflow);
  installStandardCi(root);
  const accepted = runConsumer(root, runnerPath, env);
  assert.equal(accepted.status, 0, accepted.stderr);
  unlinkSync(join(root, workflow));
  symlinkSync(join(root, "scripts/check_release_readiness.mjs"), join(root, workflow));
  const rejected = runConsumer(root, runnerPath, env);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /must not be a symbolic link/u);
});

test("workflow-only check catches CI drift before running a consumer checker", (t) => {
  const root = createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { RELEASE_READINESS_PUBLIC_REPO: "true" };
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, claPath), claTemplate);
  stageFiles(root, claPath);
  const generated = installStandardCi(root);
  const check = () => runConsumer(root, runnerPath, env, ["--check-workflows"]);
  unlinkSync(join(root, "scripts/check_release_readiness.mjs"));
  const verified = check();
  assert.equal(verified.status, 0, verified.stderr);
  writeFileSync(join(root, ".github/workflows/ci.yml"), generated.replace("contents: read", "contents: write"));
  const drifted = check();
  assert.equal(drifted.status, 1);
  assert.match(drifted.stderr, /Regenerate it with --render-ci/u);
  writeFileSync(join(root, ".github/workflows/ci.yml"), generated);
  writeFileSync(join(root, ".github/workflows/ci.yaml"), generated);
  const duplicate = check();
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /ci\.yaml must not exist/u);
});

test("the preflight summary step reports copyable inputs for an exact main dispatch", (t) => {
  const root = createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const render = (args) => runConsumer(root, runnerPath, {}, ["--render-preflight-summary", ...args]);
  const rendered = render([]);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /RELEASE_VERSION: \$\{\{ inputs\.version \}\}/u);
  assert.match(rendered.stdout, /SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/u);
  const extraArgument = render(["crates"]);
  assert.equal(extraArgument.status, 1);
  assert.match(extraArgument.stderr, /must be used on its own/u);

  const [header, body] = rendered.stdout.split("  run: |\n");
  assert.ok(body);
  const patterns = Object.fromEntries(
    [...header.matchAll(/^ {4}((?:VERSION|SHA)_PATTERN): '([^']+)'$/gmu)]
      .map(([, name, pattern]) => [name, pattern]),
  );
  const shell = body.replace(/^ {4}/gmu, "");
  const summary = join(root, "step summary.md");
  const sha = "a".repeat(40);
  const execute = (overrides = {}) => spawnSync("bash", ["-e", "-o", "pipefail", "-c", shell], {
    encoding: "utf8",
    env: {
      ...process.env, ...patterns, RELEASE_VERSION: "0.4.3", SOURCE_SHA: sha,
      GITHUB_SHA: sha, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
      GITHUB_STEP_SUMMARY: summary, ...overrides,
    },
  });
  writeFileSync(summary, "Existing summary\n\n");
  const success = execute();
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stderr, "");
  const fence = "```";
  const content = [
    "Existing summary", "", "## Release form inputs", "",
    "Copy these values into the release form for this ecosystem once the preflight run succeeds.", "",
    "**Version**", `${fence}text`, "0.4.3", fence, "",
    "**Source SHA**", `${fence}text`, sha, fence, "",
  ].join("\n");
  assert.equal(readFileSync(summary, "utf8"), content);

  for (const overrides of [
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/topic" },
    { GITHUB_SHA: "b".repeat(40) },
    { SOURCE_SHA: "aaa", GITHUB_SHA: "aaa" },
    { RELEASE_VERSION: "0.04.3" },
    { RELEASE_VERSION: "0.4.3\nadditional text" },
    { GITHUB_STEP_SUMMARY: "" },
    { GITHUB_STEP_SUMMARY: root },
  ]) {
    const result = execute(overrides);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /::warning::/u);
    assert.equal(readFileSync(summary, "utf8"), content);
  }
});

test("the pinned runner gives protobuf policy the verified coverage of a reusable lane", (t) => {
  const root = createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of [".github/workflows", "contracts", "schema"]) {
    mkdirSync(join(root, path), { recursive: true });
  }
  writeFileSync(join(root, claPath), claTemplate);
  writeFileSync(join(root, "contracts/README.md"), `
[Architecture](https://github.com/reallyme/.github/blob/main/ARCHITECTURE.md)
[Engineering Philosophy](https://github.com/reallyme/.github/blob/main/ENGINEERING_PHILOSOPHY.md)
`);
  writeFileSync(join(root, "schema/request.proto"), 'syntax = "proto3";\nmessage Request {\n  uint32 id = 1;\n}\n');
  writeFileSync(join(root, ".github/workflows/proto.yml"), `${reusableHeader("schema")}jobs:
  schema:
    runs-on: ubuntu-24.04
    steps:
      - name: Check schema
        run: ./scripts/check-schema
`);
  writeFileSync(join(root, "scripts/check_release_readiness.mjs"), `
const { createReleaseReadinessContext } = await import(process.env.RELEASE_READINESS_CORE_URL);
const context = createReleaseReadinessContext({ scriptUrl: import.meta.url, requireTrackedFiles: true });
context.assertProtobufFirstPolicy({
  schemaPaths: ["schema/request.proto"],
  verification: {
    workflow: ".github/workflows/proto.yml",
    job: "schema",
    step: "Check schema",
    run: "./scripts/check-schema",
  },
});
`);
  stageFiles(root, ".");
  const check = () => runConsumer(root, runnerPath, { RELEASE_READINESS_PUBLIC_REPO: "true" });
  // The checker encodes the protobuf contract and scripts/ is covered by the shared plan.
  installStandardCi(root, { proto: { workflow: "proto.yml", paths: ["schema/", "contracts/"] } });
  const accepted = check();
  assert.equal(accepted.status, 0, accepted.stderr);
  installStandardCi(root, { proto: { workflow: "proto.yml", paths: ["schema/"] } });
  const rejected = check();
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /standard CI lane does not cover changes to contracts\/README\.md/u);
});

test("release command binds versions, workflow identity and GitHub preflight evidence to the checkout", (t) => {
  const root = createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = "reallyme/example";
  const version = "1.2.3";
  const preflight = "npm-package-preflight.yml";
  const publish = "npm-package-release.yml";
  const mavenPreflight = "kotlin-android-package-preflight.yml";
  const mavenPublish = "kotlin-android-package-release.yml";
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, claPath), claTemplate);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "example", version }));
  writeFileSync(join(root, "build.gradle.kts"), `version = "${version}"\n`);
  writeFileSync(join(root, mavenBundlePath), mavenBundleFixture, { mode: 0o755 });
  writeFileSync(join(root, ".github/workflows/android.yml"), `${reusableHeader("verify")}jobs:
  verify:
    runs-on: ubuntu-24.04
`);
  for (const [ecosystem, phase, workflow] of [
    ["npm", "preflight", preflight], ["npm", "publish", publish],
    ["maven", "preflight", mavenPreflight], ["maven", "publish", mavenPublish],
  ]) {
    writeFileSync(join(root, ".github/workflows", workflow), releaseWorkflow(ecosystem, phase));
  }
  stageFiles(root, ".");
  installStandardCi(root, { android: { workflow: "android.yml", paths: ["build.gradle.kts"] } }, {
    tagPrefix: "v", npm: { preflight, publish, manifests: ["package.json"], artifacts: ["npm-{version}-{sha}"] },
    maven: { preflight: mavenPreflight, publish: mavenPublish, manifests: ["build.gradle.kts"], artifacts: ["maven"] },
  });
  const commit = spawnSync("git", ["-c", "user.name=ReallyMe Test", "-c", "user.email=test@really.me",
    "commit", "--quiet", "-m", "Release candidate"], { cwd: root, encoding: "utf8" });
  assert.equal(commit.status, 0, commit.stderr);
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  const eventPath = join(root, "event.json");
  const outputs = join(root, "outputs");
  writeFileSync(eventPath, JSON.stringify({
    repository: { full_name: repository, private: false },
    inputs: { version, source_sha: sha },
  }));
  writeFileSync(join(root, "gh"), `#!/bin/sh
exec "$RR_TEST_NODE" --input-type=module -e '
const endpoint = process.argv.at(-1);
const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
const run = { head_repository: { full_name: repo }, head_branch: "main", head_sha: sha,
  status: "completed", conclusion: "success", run_attempt: 1 };
let page;
const skipAndroid = process.env.FIXTURE_NO_ANDROID_ARTIFACT === "true";
if (endpoint === "repos/" + repo + "/actions/workflows/ci.yml/runs?branch=main&status=success&per_page=100") {
  if (process.env.FIXTURE_REJECT_HISTORY === "true") process.exit(2);
  // No earlier run on main, so a lane skipped for this SHA has nothing to carry forward.
  process.stdout.write(JSON.stringify({ workflow_runs: [{ ...run, path: ".github/workflows/ci.yml", id: 91, event: "push" }] }));
  process.exit(0);
} else if (endpoint.startsWith("repos/" + repo + "/actions/workflows/ci.yml/runs?")) {
  page = { workflow_runs: [{ ...run, path: ".github/workflows/ci.yml", id: 91, event: "push" }] };
} else if (endpoint.includes("/runs/91/attempts/1/jobs?")) {
  page = { jobs: [
    { ...run, name: "Required CI", run_id: 91 },
    { ...run, name: skipAndroid ? "android" : "android / verify", run_id: 91,
      conclusion: skipAndroid ? "skipped" : "success" },
  ] };
} else if (endpoint.includes("/runs/91/artifacts?name=android-maven-" + sha)) {
  page = { artifacts: skipAndroid ? [] : [{
    name: "android-maven-" + sha, id: 96, expired: false, size_in_bytes: 400,
    digest: "sha256:" + "a".repeat(64), workflow_run: { id: 91, head_sha: sha, head_branch: "main" },
  }] };
} else if (endpoint === "repos/" + repo + "/compare/" + sha + "...main?per_page=1") {
  const status = process.env.FIXTURE_COMPARE_STATUS ?? "ahead";
  process.stdout.write(JSON.stringify({ status, behind_by: status === "diverged" ? 1 : 0 }));
  process.exit(0);
} else if (endpoint.includes("/workflows/npm-package-preflight.yml/runs?")) {
  page = { workflow_runs: [{ ...run, path: ".github/workflows/npm-package-preflight.yml",
    id: 92, event: "workflow_dispatch", display_title: "Preflight npm 1.2.3 " + sha }] };
} else if (endpoint.includes("/runs/92/artifacts?")) {
  page = { artifacts: process.env.FIXTURE_NO_NPM_RECEIPT === "true" ? [] : [{
    name: "release-readiness-ci-1-91", id: 97, expired: false, size_in_bytes: 380,
    digest: "sha256:" + "a".repeat(64), workflow_run: { id: 92, head_sha: sha, head_branch: "main" } }] };
  if (process.env.FIXTURE_NO_NPM_PACKAGE !== "true") page.artifacts.push({
    name: "npm-1.2.3-" + sha, id: 99, expired: false, size_in_bytes: 400,
    digest: "sha256:" + "b".repeat(64), workflow_run: { id: 92, head_sha: sha, head_branch: "main" } });
} else if (endpoint.includes("/workflows/kotlin-android-package-preflight.yml/runs?")) {
  page = { workflow_runs: [{ ...run, path: ".github/workflows/kotlin-android-package-preflight.yml",
    id: 93, event: "workflow_dispatch", display_title: "Preflight maven 1.2.3 " + sha }] };
} else if (endpoint.includes("/runs/93/artifacts?")) {
  page = { artifacts: [{ name: "release-readiness-ci-1-91", id: 98, expired: false, size_in_bytes: 380,
    digest: "sha256:" + "a".repeat(64), workflow_run: { id: 93, head_sha: sha, head_branch: "main" } }, {
    name: "maven", id: 100, expired: false, size_in_bytes: 400,
    digest: "sha256:" + "c".repeat(64), workflow_run: { id: 93, head_sha: sha, head_branch: "main" } }] };
} else {
  process.exit(2);
}
process.stdout.write(JSON.stringify([page]));
' -- "$@"
`, { mode: 0o755 });
  const workflows = { npm: { preflight, publish }, maven: { preflight: mavenPreflight, publish: mavenPublish } };
  const check = (phase, overrides = {}, ecosystem = "npm") => runConsumer(root, runnerPath, {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_OUTPUT: outputs,
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: sha,
    RUNNER_TEMP: mkdtempSync(join(root, ".git", "receipt-")),
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/${workflows[ecosystem][phase]}@refs/heads/main`,
    PATH: `${root}${delimiter}${process.env.PATH}`,
    RR_TEST_NODE: process.execPath,
    ...overrides,
  }, ["--check-release", ecosystem, phase, version, "v1.2.3", sha]);
  const unqualified = check("preflight", { GITHUB_SHA: "b".repeat(40) });
  assert.equal(unqualified.status, 1);
  assert.match(unqualified.stderr, /dispatch version and source SHA/u);
  for (const phase of ["preflight", "publish"]) {
    const result = check(phase);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(readFileSync(outputs, "utf8"), "ci_run_id=91\ntag_owner=github\nci_run_id=91\npreflight_run_id=92\npackage_artifact_ids=99\ntag_owner=github\n");
  const noArtifact = check("publish", { FIXTURE_NO_NPM_PACKAGE: "true" });
  assert.equal(noArtifact.status, 1);
  assert.match(noArtifact.stderr, /requires every declared package artifact/u);
  const maven = check("preflight", {}, "maven");
  assert.equal(maven.status, 0, maven.stderr);
  assert.match(readFileSync(outputs, "utf8"), /ci_run_id=91\nandroid_artifact_id=96\ntag_owner=github\n$/u);
  const skippedAndroid = { FIXTURE_NO_ANDROID_ARTIFACT: "true" };
  // A scoped run that skipped Android is not release evidence on its own.
  const scopedNpm = check("preflight", skippedAndroid);
  assert.equal(scopedNpm.status, 1);
  assert.match(scopedNpm.stderr, /path-scoped lane must have run for it or have an unchanged earlier result/u);
  const missing = check("preflight", { ...skippedAndroid, FIXTURE_REJECT_HISTORY: "true" }, "maven");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /successful Required CI with a retained tested Android publication for this SHA/u);
  const mavenRetry = check("publish", { FIXTURE_NO_NPM_RECEIPT: "true" }, "maven");
  assert.equal(mavenRetry.status, 0, mavenRetry.stderr);
  assert.match(readFileSync(outputs, "utf8"), /ci_run_id=91\npreflight_run_id=93\npackage_artifact_ids=100\ntag_owner=github\n$/u);
  const orphaned = check("publish", { FIXTURE_COMPARE_STATUS: "diverged" });
  assert.equal(orphaned.status, 1);
  assert.match(orphaned.stderr, /selected source SHA must be on main/u);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "example", version: "1.2.4" }));
  const dirty = check("publish");
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /unchanged tracked inputs/u);
});

test("a public Maven publisher needs a tracked executable bundle entry point even for JVM-only packages", (t) => {
  const root = createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, claPath), claTemplate);
  writeFileSync(join(root, "build.gradle.kts"), 'version = "1.2.3"\n');
  writeFileSync(join(root, mavenBundlePath), mavenBundleFixture, { mode: 0o755 });
  const preflight = "maven-central-package-preflight.yml";
  const publish = "maven-central-package-release.yml";
  writeFileSync(join(root, ".github/workflows", preflight), releaseWorkflow("maven", "preflight"));
  writeFileSync(join(root, ".github/workflows", publish), releaseWorkflow("maven", "publish"));
  stageFiles(root, ".");
  const release = {
    tagPrefix: "v",
    maven: { preflight, publish, manifests: ["build.gradle.kts"], artifacts: ["maven"] },
  };
  installStandardCi(root, {}, release);
  const check = () => runConsumer(root, runnerPath, { RELEASE_READINESS_PUBLIC_REPO: "true" }, ["--check-workflows"]);
  const accept = () => {
    const result = check();
    assert.equal(result.status, 0, result.stderr);
  };
  const reject = (diagnostic = /Maven release requires a tracked, executable scripts\/maven-central-bundle\.local\.sh/u) => {
    const result = check();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, diagnostic);
  };
  const index = (...args) => {
    const result = spawnSync("git", [...args, "--", mavenBundlePath], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  accept();
  index("rm", "--cached");
  reject();
  stageFiles(root, mavenBundlePath);
  index("update-index", "--chmod=-x");
  reject();
  index("update-index", "--chmod=+x");
  writeFileSync(join(root, mavenBundlePath), "#!/usr/bin/env bash\n");
  reject();
  unlinkSync(join(root, mavenBundlePath));
  symlinkSync("check_release_readiness.mjs", join(root, mavenBundlePath));
  stageFiles(root, mavenBundlePath);
  reject(/must not be a symbolic link/u);
  unlinkSync(join(root, mavenBundlePath));
  writeFileSync(join(root, mavenBundlePath), mavenBundleFixture, { mode: 0o755 });
  stageFiles(root, mavenBundlePath);
  accept();

  writeFileSync(join(root, ".github/release-readiness.json"), JSON.stringify({
    schema: 1, lanes: { policy: { workflow: "policy.yml" } },
  }));
  reject(/package workflows must declare their release ecosystems/u);
});

test("public policy checks release dependencies, artifact promotion, tag ownership and the pinned policy lane", (t) => {
  const root = createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, claPath), claTemplate);
  // Cargo's presence alone does not establish a crates.io release.
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\nmembers = []\n");
  stageFiles(root, ".");
  installStandardCi(root);
  const check = () => runConsumer(root, runnerPath, { RELEASE_READINESS_PUBLIC_REPO: "true" }, ["--check-workflows"]);
  const accept = () => {
    const result = check();
    assert.equal(result.status, 0, result.stderr);
  };
  const reject = (message) => {
    const result = check();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
  };
  const originalPolicy = readFileSync(join(root, ".github/workflows/policy.yml"), "utf8");
  accept();
  for (const [source, message] of [
    [originalPolicy.replace("node .release-readiness/scripts/run-consumer-check.mjs", "echo verified"), /run command changed/u],
    [originalPolicy.replace("a".repeat(40), "main"), /must pin reallyme\/release-readiness/u],
    [originalPolicy.replace("  verify:\n", "  verify:\n    if: false\n"), /required policy receipt job/u],
  ]) {
    writeFileSync(join(root, ".github/workflows/policy.yml"), source);
    reject(message);
  }
  writeFileSync(join(root, ".github/workflows/policy.yml"), originalPolicy);

  const appendJob = (source, body) => source + `  extra:
    runs-on: ubuntu-24.04
${body}    steps:
      - name: Extra work
        run: echo work
`;
  const preflight = "crates-package-preflight.yml";
  const publish = "crates-release.yml";
  const preflightPath = join(root, ".github/workflows", preflight);
  const publishPath = join(root, ".github/workflows", publish);
  const basePreflight = releaseWorkflow("crates", "preflight");
  const basePublish = releaseWorkflow("crates", "publish", true);
  writeFileSync(preflightPath, basePreflight);
  writeFileSync(publishPath, basePublish);
  stageFiles(root, ".");
  reject(/must declare their release ecosystems/u);
  const release = { tagPrefix: "v", crates: { preflight, publish, tagJob: "publish", artifacts: ["crates-{sha}"] } };
  const writePlan = () => writeFileSync(join(root, ".github/release-readiness.json"), JSON.stringify({
    schema: 1, lanes: { policy: { workflow: "policy.yml" } }, release,
    otherReleases: [{ workflow: "release-plz.yml", reason: "Upstream release workflow" }],
  }));
  installStandardCi(root, {}, release);
  accept();
  writeFileSync(join(root, ".github/workflows/release-plz.yml"), "on: workflow_dispatch\n");
  stageFiles(root, ".github/workflows/release-plz.yml");
  reject(/declare standalone release workflows in otherReleases: release-plz.yml/u);
  writePlan();
  accept();

  writeFileSync(preflightPath, appendJob(basePreflight, "    needs:\n      - prepare\n"));
  writeFileSync(publishPath, appendJob(basePublish, "    needs: publish\n"));
  accept();
  writeFileSync(preflightPath, basePreflight);
  writeFileSync(publishPath, basePublish);
  for (const [path, source, message] of [
    [preflightPath, basePreflight.replace("run-name: Preflight", "run-name: Check"), /standard package preflight run name/u],
    [preflightPath, appendJob(basePreflight, ""), /must depend on successful release verification: extra/u],
    [preflightPath, basePreflight.replace("  verify:\n", "  verify:\n    if: github.ref == 'refs/heads/main'\n"), /unconditional, dedicated release verification job/u],
    [preflightPath, basePreflight.replace("        id: candidate\n", "        id: candidate\n        'if' : false\n"), /statically disabled/u],
    [publishPath, appendJob(basePublish, ""), /must depend on successful release verification: extra/u],
    [publishPath, appendJob(basePublish, "    needs: verify\n"), /must download the verified package or depend/u],
    [publishPath, basePublish.replace("    needs: [verify]\n", "    needs: [verify]\n    if: always()\n"), /preserve the default success condition/u],
    [publishPath, basePublish.replace("    needs: [verify]\n", "    needs: [verify]\n    continue-on-error: true\n"), /propagate failures/u],
    [publishPath, basePublish.replace("contents: write", "contents: read"), /only the canonical tag job and its declared finalizer may have contents: write/u],
    [publishPath, appendJob(basePublish, "    needs: publish\n    permissions:\n      contents: write\n"), /only the canonical tag job/u],
    [publishPath, basePublish.replace("digest-mismatch: error", "digest-mismatch: warn"), /must download the exact package artifacts/u],
    [publishPath, basePublish.replace("needs.verify.outputs.package_artifact_ids", "inputs.artifact_id"), /must download the exact package artifacts/u],
  ]) {
    writeFileSync(path, source);
    reject(message);
    writeFileSync(path, path === preflightPath ? basePreflight : basePublish);
  }
  release.crates.finalizeJob = "extra";
  writePlan();
  writeFileSync(publishPath, appendJob(basePublish, "    needs: publish\n    permissions:\n      contents: write\n"));
  accept();
  const parallelFinalizer = basePublish.replace("  publish:\n", "  extra:\n") +
    basePublish.slice(basePublish.indexOf("  publish:\n"));
  writeFileSync(publishPath, parallelFinalizer);
  reject(/finalizing a GitHub release must depend on the canonical tag job/u);
  writeFileSync(publishPath, basePublish);
  delete release.crates.finalizeJob;
  delete release.crates.artifacts;
  writePlan();
  reject(/must declare distinct preflight package artifact names/u);
});

test("private, internal and third-party repositories keep the existing runner behavior", (t) => {
  const root = createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const eventPath = join(root, "event.json");
  for (const repository of [
    { full_name: "reallyme/private", private: true },
    { full_name: "reallyme/internal", private: false, visibility: "internal" },
    { full_name: "elsewhere/public", private: false },
  ]) {
    writeFileSync(eventPath, JSON.stringify({ repository }));
    const result = runConsumer(root, runnerPath, {
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: repository.full_name,
      RELEASE_READINESS_PUBLIC_REPO: "true",
    });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("the runner fails closed if GitHub Actions cannot identify repository visibility", (t) => {
  const root = createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const eventPath = join(root, "event.json");
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: "reallyme/example",
  };
  for (const [payload, diagnostic] of [
    [null, /could not read the GitHub Actions event payload/u],
    ["{", /could not read the GitHub Actions event payload/u],
    ['{"repository":{"full_name":"reallyme/other","private":true}}', /must identify the current repository/u],
    ['{"repository":{"full_name":"reallyme/example","private":"false"}}', /must identify.*its visibility/u],
  ]) {
    if (payload !== null) {
      writeFileSync(eventPath, payload);
    }
    const rejected = runConsumer(root, runnerPath, env);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, diagnostic);
  }
});

test("runner accepts a consumer without a vendored core", () => {
  const root = createConsumer();
  const result = runConsumer(root);
  assert.equal(result.status, 0, result.stderr);
});

test("runner supplies its immutable package core to the consumer", () => {
  const root = createConsumer();
  writeFileSync(
    join(root, "scripts", "check_release_readiness.mjs"),
    `const coreUrl = process.env.RELEASE_READINESS_CORE_URL;
if (typeof coreUrl !== "string") process.exit(2);
const { RELEASE_READINESS_VERSION } = await import(coreUrl);
if (RELEASE_READINESS_VERSION !== "0.9.3") process.exit(3);
`,
  );
  const result = runConsumer(root);
  assert.equal(result.status, 0, result.stderr);
});

test("runner rejects a symlinked consumer checker", () => {
  const root = createConsumer();
  const checkerPath = join(root, "scripts", "check_release_readiness.mjs");
  const targetPath = join(root, "scripts", "checker-target.mjs");
  writeFileSync(targetPath, "process.exit(0);\n");
  // Replacing the fixture file with a symlink models a checkout containing a
  // redirected gate; the runner must fail before executing the target.
  unlinkSync(checkerPath);
  symlinkSync(targetPath, checkerPath);
  const result = runConsumer(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /consumer checker must be a regular file/u);
});

test("runner requires the shared policy for every tracked source language", () => {
  const root = createConsumer();
  writeFileSync(join(root, "implementation.rs"), "pub fn create() {}\n");
  const gitAdd = spawnSync("git", ["add", "implementation.rs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);

  const result = runConsumer(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not enforce the shared rust source policy/u);
});

test("runner accepts a successfully enforced shared source policy", () => {
  const root = createConsumer();
  writeFileSync(join(root, "implementation.rs"), "pub fn create() {}\n");
  writeFileSync(
    join(root, "scripts", "check_release_readiness.mjs"),
    `const { createReleaseReadinessContext } = await import(
  process.env.RELEASE_READINESS_CORE_URL,
);
const context = createReleaseReadinessContext({
  scriptUrl: import.meta.url,
  requireTrackedFiles: true,
});
context.assertRustSourcePolicy();
`,
  );
  const gitAdd = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);

  const result = runConsumer(root);
  assert.equal(result.status, 0, result.stderr);
});

test("runner requires Rust release policy for a repository with a tracked root Cargo manifest", () => {
  const root = createConsumer();
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\nmembers = []\n");
  const gitAdd = spawnSync("git", ["add", "Cargo.toml"], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);

  const result = runConsumer(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not enforce the shared Rust release policy/u);
});

test("runner-bound core remains external inside the consumer checkout", () => {
  const root = createConsumer();
  const packageRoot = join(root, ".release-readiness");
  const packageScripts = join(packageRoot, "scripts");
  mkdirSync(packageScripts, { recursive: true });
  copyFileSync(corePath, join(packageRoot, "core.mjs"));
  const nestedRunnerPath = join(packageScripts, "run-consumer-check.mjs");
  copyFileSync(runnerPath, nestedRunnerPath);
  copyFileSync(publicRepoPolicyPath, join(packageScripts, "public-repo-policy.mjs"));
  copyFileSync(publicCiPath, join(packageScripts, "public-ci.mjs"));
  copyFileSync(publicReleasePath, join(packageScripts, "public-release.mjs"));
  writeFileSync(
    join(root, "scripts", "check_release_readiness.mjs"),
    `const { createReleaseReadinessContext } = await import(
  process.env.RELEASE_READINESS_CORE_URL,
);
createReleaseReadinessContext({
  scriptUrl: import.meta.url,
  requireTrackedFiles: true,
});
`,
  );

  const result = runConsumer(root, nestedRunnerPath);
  assert.equal(result.status, 0, result.stderr);
});

test("release command carries a skipped lane forward only from an unchanged ancestor result", (t) => {
  const root = createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = "reallyme/example";
  const version = "1.2.3";
  const preflight = "npm-package-preflight.yml";
  const publish = "npm-package-release.yml";
  for (const path of [".github/workflows", "packages/swift"]) {
    mkdirSync(join(root, path), { recursive: true });
  }
  writeFileSync(join(root, claPath), claTemplate);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "example", version }));
  writeFileSync(join(root, "packages/swift/Library.swift"), "public let value = 1\n");
  writeFileSync(join(root, "README.md"), "one\n");
  writeFileSync(join(root, ".github/workflows/swift.yml"), `${reusableHeader("build")}jobs:
  build:
    runs-on: ubuntu-24.04
`);
  for (const [phase, workflow] of [["preflight", preflight], ["publish", publish]]) {
    writeFileSync(join(root, ".github/workflows", workflow), releaseWorkflow("npm", phase));
  }
  stageFiles(root, ".");
  installStandardCi(root, { swift: { workflow: "swift.yml", paths: ["packages/swift/"] } }, {
    tagPrefix: "v", npm: { preflight, publish, manifests: ["package.json"], artifacts: ["npm-package"] },
  });
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "user.name=ReallyMe Test", "-c", "user.email=test@really.me", ...args], {
      cwd: root, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const commit = (message) => {
    git("add", "-A");
    git("commit", "--quiet", "-m", message);
    return git("rev-parse", "HEAD");
  };
  // A: swift ran and passed. B: docs only, so swift is skipped. C: a swift change.
  const ancestor = commit("Swift verified");
  writeFileSync(join(root, "README.md"), "two\n");
  const docs = commit("Docs only");
  writeFileSync(join(root, "packages/swift/Library.swift"), "public let value = 2\n");
  const swiftChange = commit("Swift change");
  const eventPath = join(root, "event.json");
  writeFileSync(join(root, ".git", "info", "exclude"), "gh\nevent.json\noutputs\n");
  writeFileSync(join(root, "gh"), `#!/bin/sh
exec "$RR_TEST_NODE" --input-type=module -e '
const endpoint = process.argv.at(-1);
const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.FIXTURE_SOURCE_SHA;
const ancestor = process.env.FIXTURE_ANCESTOR;
const runAt = (head_sha, id) => ({ head_repository: { full_name: repo }, head_branch: "main", head_sha,
  status: "completed", conclusion: "success", run_attempt: 1, path: ".github/workflows/ci.yml", id, event: "push" });
const job = (name, run, head_sha, conclusion = "success") => ({ name, run_id: run, head_sha, status: "completed", conclusion });
const out = (value) => { process.stdout.write(JSON.stringify(value)); process.exit(0); };
const root = "repos/" + repo + "/actions/";
if (process.env.FIXTURE_PUBLISH_RETRY === "true" && endpoint.includes("/actions/workflows/ci.yml/")) process.exit(2);
if (endpoint === root + "workflows/ci.yml/runs?branch=main&head_sha=" + sha + "&status=success&per_page=100") {
  out([{ workflow_runs: [runAt(sha, 91)] }]);
} else if (endpoint === root + "workflows/ci.yml/runs?branch=main&status=success&per_page=100") {
  out({ workflow_runs: [runAt(sha, 91), runAt(ancestor, 80)] });
} else if (endpoint === root + "runs/91/attempts/1/jobs?per_page=100") {
  out([{ jobs: [job("policy / verify", 91, sha), job("swift", 91, sha, "skipped"), job("Required CI", 91, sha)] }]);
} else if (endpoint === root + "runs/80/attempts/1/jobs?per_page=100") {
  const swift = process.env.FIXTURE_ANCESTOR_SWIFT === "skipped" ? job("swift", 80, ancestor, "skipped") : job("swift / build", 80, ancestor);
  out([{ jobs: [job("policy / verify", 80, ancestor), swift, job("Required CI", 80, ancestor)] }]);
} else if (endpoint === "repos/" + repo + "/compare/" + ancestor + "..." + sha + "?per_page=1" ||
           endpoint === "repos/" + repo + "/compare/" + sha + "...main?per_page=1") {
  out({ status: "ahead", behind_by: 0 });
} else if (endpoint.includes("/workflows/npm-package-preflight.yml/runs?")) {
  out([{ workflow_runs: [{ ...runAt(sha, 92), path: ".github/workflows/npm-package-preflight.yml",
    event: "workflow_dispatch", display_title: "Preflight npm 1.2.3 " + sha }] }]);
} else if (endpoint === root + "runs/92/artifacts?per_page=100") {
  const artifacts = process.env.FIXTURE_NO_RECEIPT === "true" ? [] : [{
    id: 95, name: "release-readiness-ci-1-91", expired: false, size_in_bytes: 400,
    digest: "sha256:" + "a".repeat(64), workflow_run: { id: 92, head_sha: sha, head_branch: "main" },
  }, {
    id: 96, name: "npm-package", expired: false, size_in_bytes: 400,
    digest: "sha256:" + "b".repeat(64), workflow_run: { id: 92, head_sha: sha, head_branch: "main" },
  }];
  out([{ artifacts }]);
}
process.exit(2);
' -- "$@"
`, { mode: 0o755 });
  const check = (sha, overrides = {}, phase = "preflight") => {
    git("checkout", "--quiet", "--detach", sha);
    writeFileSync(eventPath, JSON.stringify({ repository: { full_name: repository, private: false }, inputs: { version, source_sha: sha } }));
    return runConsumer(root, runnerPath, {
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_OUTPUT: join(root, "outputs"),
      GITHUB_REPOSITORY: repository,
      GITHUB_SHA: sha,
      GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/${phase === "preflight" ? preflight : publish}@refs/heads/main`,
      RUNNER_TEMP: mkdtempSync(join(root, ".git", "receipt-")),
      PATH: `${root}${delimiter}${process.env.PATH}`,
      RR_TEST_NODE: process.execPath,
      FIXTURE_ANCESTOR: ancestor,
      FIXTURE_SOURCE_SHA: sha,
      ...overrides,
    }, ["--check-release", "npm", phase, version, "v1.2.3", sha]);
  };
  const receiptDirectory = mkdtempSync(join(root, ".git", "preflight-"));
  const carried = check(docs, { RUNNER_TEMP: receiptDirectory });
  assert.equal(carried.status, 0, carried.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(receiptDirectory, "release-readiness-ci.json"), "utf8")), {
    schema: 1, repository, ecosystem: "npm", version, tag: "v1.2.3", sha: docs,
    ciRunId: 91, ciRunAttempt: 1, androidArtifactId: null,
    carriedLanes: { swift: { runId: 80, runAttempt: 1, sha: ancestor } },
  });
  const publishRetry = check(docs, { FIXTURE_PUBLISH_RETRY: "true", GITHUB_SHA: swiftChange }, "publish");
  assert.equal(publishRetry.status, 0, publishRetry.stderr);
  assert.match(readFileSync(join(root, "outputs"), "utf8"), /ci_run_id=91\npreflight_run_id=92\npackage_artifact_ids=96\ntag_owner=github\n$/u);
  const missingReceipt = check(docs, { FIXTURE_PUBLISH_RETRY: "true", FIXTURE_NO_RECEIPT: "true" }, "publish");
  assert.equal(missingReceipt.status, 1);
  assert.match(missingReceipt.stderr, /requires a successful ecosystem preflight with a retained CI receipt/u);
  const notRun = check(docs, { FIXTURE_ANCESTOR_SWIFT: "skipped" });
  assert.equal(notRun.status, 1);
  assert.match(notRun.stderr, /each path-scoped lane must have run for it or have an unchanged earlier result/u);
  const changed = check(swiftChange);
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /Dispatch CI on main at this SHA to run every lane/u);
});
