// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const ecosystems = ["crates", "npm", "swift", "maven"];
const stableVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const workflowFile = /^[a-z0-9][a-z0-9_-]*\.ya?ml$/u;
const manifestFile = /^(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/u;
const shaPattern = /^[0-9a-f]{40}$/u;
const packageWorkflowName = /^(crates|npm|swift|kotlin-android)-(?:package-)?(preflight|release)\.ya?ml$/u;
const standaloneReleaseName = /^(?:release(?:-[a-z0-9_-]+)?|[a-z0-9_-]+-release(?:-[a-z0-9_-]+)?)\.ya?ml$/u;
const receiptPrefix = "release-readiness-ci-";
const receiptFile = "release-readiness-ci.json";
const receiptName = /^release-readiness-ci-([1-9][0-9]*)-([1-9][0-9]*)$/u;
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;

const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const onlyKeys = (value, keys) =>
  record(value) && Object.keys(value).every((key) => keys.includes(key));

function packageArtifactName(template, version, sha) {
  return template.replaceAll("{version}", version).replaceAll("{sha}", sha);
}

export function readPublicRelease(context, trackedFiles, config, ciWorkflows) {
  const workflowRoot = ".github/workflows/";
  const usedWorkflows = new Set([
    ".github/workflows/ci.yml", ".github/workflows/ci.yaml",
    ".github/workflows/cla.yml", ".github/workflows/cla.yaml",
    ...ciWorkflows,
  ]);
  const packageWorkflows = new Map();
  const otherWorkflows = new Set();
  for (const path of trackedFiles) {
    if (!path.startsWith(workflowRoot)) continue;
    const file = path.slice(workflowRoot.length);
    const match = packageWorkflowName.exec(file);
    if (match !== null) packageWorkflows.set(file, match);
    else if (standaloneReleaseName.test(file) && !usedWorkflows.has(path)) otherWorkflows.add(file);
  }
  if (Object.hasOwn(config, "otherReleases")) {
    if (!Array.isArray(config.otherReleases)) context.fail("otherReleases must list reviewed standalone release workflows");
    for (const entry of config.otherReleases) {
      if (!onlyKeys(entry, ["workflow", "reason"]) ||
          typeof entry.workflow !== "string" || !workflowFile.test(entry.workflow) ||
          typeof entry.reason !== "string" || entry.reason.trim().length === 0 ||
          usedWorkflows.has(`${workflowRoot}${entry.workflow}`) ||
          !trackedFiles.has(`${workflowRoot}${entry.workflow}`) || packageWorkflows.has(entry.workflow)) {
        context.fail("otherReleases entries must identify distinct tracked standalone release workflows and explain their release type");
      }
      otherWorkflows.delete(entry.workflow);
      usedWorkflows.add(`${workflowRoot}${entry.workflow}`);
    }
  }
  if (!Object.hasOwn(config, "release")) {
    if (packageWorkflows.size > 0) {
      context.fail("public repositories with package workflows must declare their release ecosystems");
    }
    if (otherWorkflows.size > 0) context.fail(`declare standalone release workflows in otherReleases: ${[...otherWorkflows].join(", ")}`);
    return null;
  }
  const { release } = config;
  const { fail } = context;
  if (!onlyKeys(release, ["tagPrefix", ...ecosystems]) ||
      typeof release.tagPrefix !== "string" || !/^(?:v|[a-z0-9][a-z0-9-]*-v)?$/u.test(release.tagPrefix) ||
      !ecosystems.some((name) => Object.hasOwn(release, name))) {
    fail("public release configuration requires an explicit tagPrefix and at least one supported release ecosystem");
  }
  const tagOwner = Object.hasOwn(release, "swift") ? "swift" : Object.hasOwn(release, "crates") ? "crates" : "github";
  const channels = new Map();
  for (const name of ecosystems) {
    if (!Object.hasOwn(release, name)) {
      continue;
    }
    const channel = release[name];
    const requiredManifest = name === "npm" ? "package.json" : name === "maven" ? "build.gradle.kts" : null;
    const allowedKeys = ["preflight", "publish", "artifacts"];
    if (name === tagOwner) allowedKeys.push("tagJob", "finalizeJob");
    if (requiredManifest !== null) allowedKeys.push("manifests");
    if (!onlyKeys(channel, allowedKeys)) {
      fail(`public release configuration for ${name} has unsupported fields`);
    }
    if (name === tagOwner && (typeof channel.tagJob !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(channel.tagJob))) {
      fail(`public ${name} release must name the ${name} publish workflow's canonical tag job`);
    }
    if (Object.hasOwn(channel, "finalizeJob") &&
        (typeof channel.finalizeJob !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(channel.finalizeJob) ||
          channel.finalizeJob === channel.tagJob)) {
      fail(`public ${name} release must name a distinct job to finalize the existing GitHub release`);
    }
    if (!Array.isArray(channel.artifacts) || channel.artifacts.length === 0 ||
        new Set(channel.artifacts).size !== channel.artifacts.length ||
        channel.artifacts.some((name) => typeof name !== "string" || name.startsWith(receiptPrefix) ||
          !/^[a-zA-Z0-9_.-](?:[a-zA-Z0-9_.-]|\{version\}|\{sha\}){0,179}$/u.test(name))) {
      fail(`public ${name} release must declare distinct preflight package artifact names`);
    }
    for (const purpose of ["preflight", "publish"]) {
      const file = channel[purpose];
      if (typeof file !== "string" || !workflowFile.test(file)) {
        fail(`public ${name} ${purpose} requires a dedicated tracked workflow`);
      }
      const path = `${workflowRoot}${file}`;
      if (usedWorkflows.has(path) || !trackedFiles.has(path)) {
        fail(`public ${name} ${purpose} requires a dedicated tracked workflow`);
      }
      if (purpose === "preflight") {
        const contents = context.readText(path);
        const title = publicPreflightTitle(name, "${{ inputs.version }}", "${{ inputs.source_sha }}");
        const declaredTitles = [...contents.matchAll(/^run-name:[ \t]*(.+?)[ \t]*\r?$/gmu)];
        if (declaredTitles.length !== 1 || declaredTitles[0][1] !== title) {
          fail(`${path} must use the standard package preflight run name`);
        }
      }
      const step = context.assertWorkflowRunStep(
        path,
        "Verify release candidate",
        `node .release-readiness/scripts/run-consumer-check.mjs --check-release ${name} ${purpose} "$RELEASE_VERSION" "$RELEASE_TAG" "$SOURCE_SHA"`,
      );
      if (step.condition !== null || (step.continueOnError !== null && step.continueOnError !== "false")) {
        fail(`${path} must always fail closed when the release candidate cannot be verified`);
      }
      assertGatedReleaseWorkflow(context, path, step, purpose, channel);
      const lastStep = purpose === "preflight" ? assertPreflightReceiptStep(context, path, step) : step;
      if (context.readText(path).split(/\r?\n/u).slice(step.index + 1, lastStep.end).some((line) =>
        new RegExp(`^ {${step.indent}}-\\s+(?!name:)`, "u").test(line))) {
        fail(`${path} must give each step in the release verification job a name`);
      }
      const workflowSteps = context.extractWorkflowSteps(path).filter(({ job }) => job === step.job);
      if (workflowSteps.at(-1)?.index !== lastStep.index) {
        fail(`${path} must finish the verification job before starting package or publish jobs`);
      }
      usedWorkflows.add(path);
      otherWorkflows.delete(file);
    }
    if (requiredManifest !== null) {
      if (!Array.isArray(channel.manifests) || channel.manifests.length === 0 ||
          new Set(channel.manifests).size !== channel.manifests.length ||
          channel.manifests.some((path) =>
            typeof path !== "string" || !manifestFile.test(path) ||
            path.split("/").at(-1) !== requiredManifest || !trackedFiles.has(path))) {
        fail(`public ${name} release must identify distinct tracked ${requiredManifest} files`);
      }
    }
    channels.set(name, channel);
  }
  for (const [file, [, ecosystem, phase]] of packageWorkflows) {
    const channel = channels.get(ecosystem === "kotlin-android" ? "maven" : ecosystem);
    if (channel?.[phase === "release" ? "publish" : phase] !== file) {
      fail(`every tracked package preflight and publish workflow must belong to its release ecosystem: ${file}`);
    }
  }
  if (otherWorkflows.size > 0) context.fail(`declare standalone release workflows in otherReleases: ${[...otherWorkflows].join(", ")}`);
  return { channels, tagOwner, tagPrefix: release.tagPrefix };
}

function assertGatedReleaseWorkflow(context, path, step, purpose, channel) {
  const workflow = context.readPublicWorkflow(path);
  const { jobs, block, sequence, value } = workflow;
  const tagJob = purpose === "publish" ? channel.tagJob : undefined;
  const finalizeJob = purpose === "publish" ? channel.finalizeJob : undefined;
  const gitHubReleaseJobs = new Set([tagJob, finalizeJob].filter((name) => name !== undefined));
  const candidate = jobs.get(step.job);
  if (candidate === undefined || jobs.size < 2 || gitHubReleaseJobs.has(step.job) ||
      [...gitHubReleaseJobs].some((name) => !jobs.has(name)) ||
      ["if", "needs", "strategy", "environment", "uses"].some((key) => candidate.has(key))) {
    context.fail(`${path} must use an unconditional, dedicated release verification job before package or tag jobs`);
  }
  const permissions = (field, indent) => {
    if (field?.value === "{}") {
      value(field);
      return new Map();
    }
    if (field === undefined) return new Map();
    return new Map([...block(field, indent)].map(([scope, grant]) => {
      const access = value(grant);
      if (!["none", "read", "write"].includes(access)) context.fail(`${path} must use explicit workflow permissions`);
      return [scope, access];
    }));
  };
  const baseline = permissions(workflow.fields.get("permissions"), 2);
  if (baseline.get("contents") !== "read" || [...baseline.values()].includes("write")) {
    context.fail(`${path} must declare read-only workflow permissions with contents: read`);
  }
  const waiting = new Map();
  const canReadArtifacts = new Set();
  for (const [name, job] of jobs) {
    const granted = job.has("permissions") ? permissions(job.get("permissions"), 6) : baseline;
    if (granted.get("actions") === "read") canReadArtifacts.add(name);
    if (gitHubReleaseJobs.has(name) !== (granted.get("contents") === "write")) {
      context.fail(`${path} only the canonical tag job and its declared finalizer may have contents: write, and those jobs must declare it`);
    }
    if (name === step.job && (granted.get("actions") !== "read" || granted.get("contents") !== "read" ||
        [...granted.values()].includes("write"))) {
      context.fail(`${path} release verification must have read-only contents and actions permissions`);
    }
    const condition = value(job.get("if"));
    const tolerance = value(job.get("continue-on-error"));
    if ((condition !== undefined && (condition.length === 0 || /\b(?:always|cancelled|failure|success)\s*\(/iu.test(condition))) ||
        (tolerance !== undefined && tolerance !== "false")) {
      context.fail(`${path} job ${name} must preserve the default success condition and propagate failures`);
    }
    if (name === step.job) continue;
    const field = job.get("needs");
    const scalar = field?.value ? value(field) : "";
    const needs = field === undefined ? [] : /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(scalar)
      ? [scalar] : sequence(field, 4, `job ${name} needs`);
    if (needs.some((dependency) => !jobs.has(dependency)) || new Set(needs).size !== needs.length) {
      context.fail(`${path} job ${name} has an invalid needs dependency`);
    }
    waiting.set(name, needs);
  }
  const downloads = purpose === "publish"
    ? assertPublishArtifactDownload(context, path, workflow, step, waiting, canReadArtifacts)
    : null;
  // Every branch must pass through the verifier. An unrelated root could
  // package or publish independently even if the workflow later fails.
  const gated = new Set([step.job]);
  const followsTag = new Set(tagJob === undefined ? [] : [tagJob]);
  while (waiting.size > 0) {
    const previous = waiting.size;
    for (const [name, needs] of waiting) {
      if (needs.length === 0 || !needs.every((dependency) => gated.has(dependency))) continue;
      if (downloads !== null && !downloads.has(name) && needs.every((dependency) => dependency === step.job)) {
        context.fail(`${path} job ${name} must download the verified package or depend on a job that does`);
      }
      if (needs.some((dependency) => followsTag.has(dependency))) followsTag.add(name);
      gated.add(name);
      waiting.delete(name);
    }
    if (waiting.size === previous) {
      context.fail(`${path} jobs must depend on successful release verification: ${[...waiting.keys()].join(", ")}`);
    }
  }
  if (finalizeJob !== undefined && !followsTag.has(finalizeJob)) {
    context.fail(`${path} finalizing a GitHub release must depend on the canonical tag job`);
  }
}

function assertPublishArtifactDownload(context, path, workflow, candidate, dependencies, canReadArtifacts) {
  const { jobs, block, value, lines } = workflow;
  const outputs = block(jobs.get(candidate.job).get("outputs"), 6);
  const candidateId = `${" ".repeat(candidate.indent + 2)}id: candidate`;
  const runId = "preflight_run_id";
  const artifactIds = "package_artifact_ids";
  if (!lines.slice(candidate.index + 1, candidate.end).includes(candidateId) ||
      [runId, artifactIds].some((key) => value(outputs.get(key)) !== `\${{ steps.candidate.outputs.${key} }}`)) {
    context.fail(`${path} must expose the verified preflight run and package artifact IDs from the candidate step`);
  }
  const name = "Download verified package";
  const steps = context.extractWorkflowSteps(path).filter((step) => step.name === name);
  if (steps.length === 0) context.fail(`${path} must download the verified preflight package artifacts`);
  for (const step of steps) {
    if (!dependencies.get(step.job)?.includes(candidate.job) || step.condition !== null ||
        !canReadArtifacts.has(step.job) || (step.continueOnError !== null && step.continueOnError !== "false")) {
      context.fail(`${path} must download verified artifacts unconditionally in a job that needs the verifier`);
    }
    context.assertWorkflowUsesStepPinnedTo(path, name, "actions/download-artifact", step.job);
    const inputs = context.readWorkflowStepInputs(path, step, lines);
    if (inputs.get("run-id") !== `\${{ needs.${candidate.job}.outputs.${runId} }}` ||
        inputs.get("artifact-ids") !== `\${{ needs.${candidate.job}.outputs.${artifactIds} }}` ||
        inputs.get("github-token") !== "${{ github.token }}" ||
        inputs.get("digest-mismatch") !== "error" ||
        ["name", "pattern", "repository", "skip-decompress"].some((key) => inputs.has(key))) {
      context.fail(`${path} must download the exact package artifacts from the verified run and fail on a digest mismatch`);
    }
  }
  return new Set(steps.map(({ job }) => job));
}

function assertPreflightReceiptStep(context, path, candidate) {
  const name = "Record verified CI";
  context.assertWorkflowUsesStepPinnedTo(path, name, "actions/upload-artifact", candidate.job);
  const receipt = context.extractWorkflowSteps(path).find((step) => step.job === candidate.job && step.name === name);
  if (candidate.job === null || receipt === undefined) context.fail(`${path} must record verified CI in the candidate job`);
  const source = context.readText(path).split(/\r?\n/u);
  const property = (step, line) => `${" ".repeat(step.indent + 2)}${line}`;
  const input = (line) => property(receipt, `  ${line}`);
  const candidateLines = source.slice(candidate.index + 1, candidate.end);
  const receiptLines = source.slice(receipt.index + 1, receipt.end);
  if (!candidateLines.includes(property(candidate, "id: candidate")) || receipt.index <= candidate.index ||
      receipt.condition !== null || (receipt.continueOnError !== null && receipt.continueOnError !== "false") ||
      !receiptLines.includes(property(receipt, "with:")) ||
      !receiptLines.includes(input(`name: ${receiptPrefix}\${{ github.run_attempt }}-\${{ steps.candidate.outputs.ci_run_id }}`)) ||
      !receiptLines.includes(input(`path: \${{ runner.temp }}/${receiptFile}`)) ||
      !receiptLines.includes(input("if-no-files-found: error"))) {
    context.fail(`${path} must upload the verified CI receipt after the candidate step in the same job`);
  }
  return receipt;
}

// Validate locked workspace metadata from `cargo metadata --no-deps`.
export function assertCargoReleaseVersions(context, metadata, version) {
  if (!Array.isArray(metadata?.packages) || !Array.isArray(metadata?.workspace_members) ||
      metadata.packages.some((pkg) => !record(pkg) || typeof pkg.id !== "string") ||
      new Set(metadata.packages.map((pkg) => pkg.id)).size !== metadata.packages.length ||
      metadata.workspace_members.length === 0 ||
      new Set(metadata.workspace_members).size !== metadata.workspace_members.length ||
      metadata.workspace_members.some((id) => typeof id !== "string")) {
    context.fail("Cargo metadata must identify the release workspace members");
  }
  const members = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  let published = 0;
  for (const id of metadata.workspace_members) {
    const pkg = members.get(id);
    if (typeof pkg?.name !== "string") context.fail("Cargo metadata omitted a release workspace member");
    // Cargo reports `publish = false` as an empty registry list and an
    // unrestricted package as null. Internal tooling and test-support crates
    // never ship, so their versions are not part of the release identity.
    if (Array.isArray(pkg.publish) && pkg.publish.length === 0) continue;
    if (pkg.publish !== null && pkg.publish !== undefined &&
        (!Array.isArray(pkg.publish) || pkg.publish.some((registry) => typeof registry !== "string"))) {
      context.fail(`Cargo metadata reported an invalid publish setting for ${pkg.name}`);
    }
    if (pkg.version !== version) {
      context.fail(`Cargo package ${pkg.name} must declare the repository release version ${version}`);
    }
    published += 1;
  }
  if (published === 0) {
    context.fail("public crates release requires at least one publishable workspace member");
  }
}

export function assertPublicReleaseVersion(context, trackedFiles, release, version, tag) {
  const { fail } = context;
  if (release === null) {
    fail("declare the public release ecosystems before verifying a release candidate");
  }
  if (typeof version !== "string" || !stableVersion.test(version) ||
      tag !== `${release.tagPrefix}${version}`) {
    fail("release version and canonical Git tag must identify the same stable version");
  }
  const check = (found, location) => {
    if (found !== version) fail(`${location} must declare the repository release version ${version}`);
  };
  if (release.channels.has("crates")) {
    if (!trackedFiles.has("Cargo.toml") || !trackedFiles.has("Cargo.lock")) {
      fail("public crates release requires a tracked Cargo.toml and Cargo.lock");
    }
    const command = ["metadata", "--format-version", "1", "--no-deps", "--locked", "--offline"];
    const result = spawnSync("cargo", command, { encoding: "utf8", maxBuffer: 16_777_216 });
    if (result.error !== undefined || result.status !== 0) {
      fail("could not read locked Cargo workspace package versions");
    }
    let metadata;
    try {
      metadata = JSON.parse(result.stdout);
    } catch {
      fail("Cargo metadata returned invalid JSON");
    }
    assertCargoReleaseVersions(context, metadata, version);
  }
  if (release.channels.has("swift")) {
    if (!trackedFiles.has("Package.swift")) fail("public Swift release requires a tracked Package.swift");
    const declarations = [...context.readText("Package.swift").matchAll(
      /^\s*(?:(?:private|internal|public|fileprivate)\s+)?(?:let|var)\s+packageVersion\s*(?::[^=\r\n]+)?=\s*([^\r\n]+)/gmu,
    )];
    // SwiftPM gets its published version from the Git tag. Repos with a
    // separate packageVersion constant must keep that literal aligned too.
    if (declarations.length > 0) {
      const literal = declarations.length === 1
        ? /^"([^"]+)"(?:[ \t]*\/\/.*)?[ \t]*$/u.exec(declarations[0][1])
        : null;
      check(literal?.[1], "Package.swift packageVersion");
    }
  }
  for (const path of release.channels.get("npm")?.manifests ?? []) {
    const manifest = context.readJson(path);
    if (!record(manifest) || typeof manifest.name !== "string" || manifest.name.length === 0 ||
        (manifest.private !== undefined && manifest.private !== false)) {
      fail(`${path} must describe a publishable npm package`);
    }
    check(manifest.version, path);
    const lockPath = path.replace(/package\.json$/u, "package-lock.json");
    if (trackedFiles.has(lockPath)) {
      const lock = context.readJson(lockPath);
      check(lock?.version, lockPath);
      check(lock?.packages?.[""]?.version, `${lockPath} root package`);
    }
  }
  for (const path of release.channels.get("maven")?.manifests ?? []) {
    const declarations = [...context.readText(path).matchAll(/^version[ \t]*=[ \t]*([^\r\n]+)/gmu)];
    const literal = declarations.length === 1
      ? /^"([^"]+)"(?:[ \t]*\/\/.*)?[ \t]*$/u.exec(declarations[0][1])
      : null;
    check(literal?.[1], path);
  }
}

export function assertPublicReleaseInvocation(context, repository, sha, ecosystem, phase, release, workflowRef) {
  const { fail } = context;
  if (typeof repository !== "string" || !/^reallyme\/[a-z0-9_.-]+$/iu.test(repository) ||
      typeof sha !== "string" || !shaPattern.test(sha)) {
    fail("select an exact source SHA from main in the current public ReallyMe repository");
  }
  const channel = release?.channels.get(ecosystem);
  const workflow = phase === "preflight" || phase === "publish" ? channel?.[phase] : null;
  if (workflow === null || workflow === undefined ||
      (workflowRef !== undefined && workflowRef !== `${repository}/.github/workflows/${workflow}@refs/heads/main`)) {
    fail("release verification must run from the configured ecosystem workflow on main");
  }
  const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { encoding: "utf8" });
  const clean = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" });
  if (head.error !== undefined || head.status !== 0 || head.stdout.trim() !== sha ||
      clean.error !== undefined || clean.status !== 0 || clean.stdout !== "") {
    fail("release verification requires the exact qualified source checked out with unchanged tracked inputs");
  }
}

export function assertPublicPreflightDispatch(context, version, sha) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  let event;
  try {
    event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  } catch {
    context.fail("could not read the dispatch inputs for the public package preflight");
  }
  if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" || process.env.GITHUB_SHA !== sha ||
      event?.inputs?.version !== version || event?.inputs?.source_sha !== sha) {
    context.fail("the package preflight dispatch version and source SHA must match the verified candidate");
  }
}

// GitHub names the temporary branch for a merge queue entry after the target
// branch, the PR number and the base commit the queue built on.
const mergeQueueBranch = /^gh-readonly-queue\/main\/pr-[1-9][0-9]*-[0-9a-f]{40}$/u;

const exactRun = (run, repository, sha, workflow) =>
  record(run) && run.path === workflow &&
    typeof run.head_repository?.full_name === "string" &&
    run.head_repository.full_name.toLowerCase() === repository.toLowerCase() &&
    run.head_sha === sha &&
    run.status === "completed" && run.conclusion === "success" &&
    Number.isSafeInteger(run.id) && run.id > 0 &&
    Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0;

const exactMainRun = (run, repository, sha, workflow) =>
  exactRun(run, repository, sha, workflow) && run.head_branch === "main";

// A merge queue fast-forwards main to the exact commit it tested, so a queue
// run is evidence for that SHA once the SHA is confirmed to be on main.
const qualifyingCiRun = (run, repository, sha, mergeQueue) => {
  if (!exactRun(run, repository, sha, ".github/workflows/ci.yml")) return false;
  if (run.event === "merge_group") {
    return mergeQueue && typeof run.head_branch === "string" && mergeQueueBranch.test(run.head_branch);
  }
  return ["push", "workflow_dispatch"].includes(run.event) && run.head_branch === "main";
};

// Bound the history searched for carried-forward lane results. A lane whose
// last successful run is older than this needs a fresh dispatch.
const MAX_CARRY_FORWARD_RUNS = 100;
const CARRY_FORWARD_BUDGET_MS = 45_000;
const REQUEST_TIMEOUT_MS = 30_000;

const passedRequiredCi = (jobs, run, sha) => {
  const gates = jobs.filter((job) => job?.name === "Required CI");
  return gates.length === 1 && gates[0].run_id === run.id && gates[0].head_sha === sha &&
    gates[0].status === "completed" && gates[0].conclusion === "success";
};

// GitHub reports the jobs of a reusable-workflow lane as `lane / job`, and a
// lane whose caller job was skipped as a single job under the lane's key. Any
// other shape is "unknown" and is never treated as evidence either way.
export function laneOutcome(jobs, lane) {
  const prefix = `${lane} / `;
  const laneJobs = jobs.filter((job) =>
    typeof job?.name === "string" && (job.name === lane || job.name.startsWith(prefix)));
  if (laneJobs.length === 1 && laneJobs[0].name === lane &&
      laneJobs[0].status === "completed" && laneJobs[0].conclusion === "skipped") {
    return "skipped";
  }
  if (laneJobs.length > 0 && laneJobs.every((job) => job.name !== lane && job.status === "completed") &&
      laneJobs.some((job) => job.conclusion === "success")) {
    return "ran";
  }
  return "unknown";
}

// Required CI proves that the lanes the change plan scheduled passed. A lane
// the plan skipped was only shown to be unaffected by that one change, which
// says nothing about the tree if an earlier commit left it failing or untested.
// A skipped lane therefore needs its own evidence: a successful run of that
// lane at an ancestor commit, with none of the lane's inputs changed since.
// The `lanes` rules are the scope job's, so "unchanged" means the same thing
// here as it does when CI decides to skip the lane.
export function findCarriedLaneEvidence(lanes, history, repository, sha, mergeQueue, {
  listJobs, isAncestor, changedPaths, timeRemaining = () => Infinity,
}) {
  const missing = new Map(lanes.map((lane) => [lane.name, lane]));
  const evidence = new Map();
  const seen = new Set();
  const candidates = history.filter((run) => {
    if (typeof run?.head_sha !== "string" || !shaPattern.test(run.head_sha) || run.head_sha === sha ||
        seen.has(run.id) || !qualifyingCiRun(run, repository, run.head_sha, mergeQueue)) {
      return false;
    }
    seen.add(run.id);
    return true;
  }).sort((a, b) => b.id - a.id).slice(0, MAX_CARRY_FORWARD_RUNS);
  for (const run of candidates) {
    if (missing.size === 0 || timeRemaining() === 0) break;
    const jobs = listJobs(run);
    // A history run needs an explicit lane result even when it was a manual
    // dispatch, because that commit's configuration may not have had the lane.
    if (jobs === null || !passedRequiredCi(jobs, run, run.head_sha)) continue;
    const ran = [...missing.values()].filter((lane) => laneOutcome(jobs, lane.name) === "ran");
    if (ran.length === 0) continue;
    const base = run.head_sha;
    if (!isAncestor(base)) continue;
    const changed = changedPaths(base);
    if (changed === null) continue;
    for (const lane of ran) {
      if (!lane.inputsChanged(changed)) {
        evidence.set(lane.name, { runId: run.id, runAttempt: run.run_attempt, sha: base });
        missing.delete(lane.name);
      }
    }
  }
  return missing.size === 0 ? evidence : null;
}

// Accept results attached to the standard workflow, repository, branch, SHA
// and run attempt. Unscoped lanes cannot be skipped without failing Required
// CI. A path-scoped lane must have run in the selected run or carry forward
// an earlier result. A manual dispatch has no comparison base and runs every
// lane, and this SHA's ci.yml is the checked standard render, so a dispatch
// at the release SHA qualifies by construction.
export function findPublicCiRun(runs, repository, sha, listJobs, {
  acceptsRun = () => true, mergeQueue = false, lanes = [], carryForward = () => null,
} = {}) {
  const candidates = runs.filter((run) => qualifyingCiRun(run, repository, sha, mergeQueue));
  candidates.sort((a, b) => b.id - a.id);
  for (const run of candidates) {
    const jobs = listJobs(run);
    if (!passedRequiredCi(jobs, run, sha) || !acceptsRun(run)) continue;
    let carried = new Map();
    if (run.event !== "workflow_dispatch") {
      const outcomes = lanes.filter((lane) => lane.scoped).map((lane) => [lane, laneOutcome(jobs, lane.name)]);
      if (outcomes.some(([, outcome]) => outcome === "unknown")) continue;
      const skipped = outcomes.filter(([, outcome]) => outcome === "skipped").map(([lane]) => lane);
      if (skipped.length > 0) {
        carried = carryForward(skipped);
        if (carried === null) continue;
      }
    }
    return { runId: run.id, runAttempt: run.run_attempt, carried };
  }
  return null;
}

function actionsData(context, endpoint, field, { firstPage = false, timeRemaining } = {}) {
  const { fail } = context;
  const timeout = Math.min(timeRemaining?.() ?? REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS);
  if (timeout === 0) return null;
  const pagination = firstPage ? [] : ["--paginate", "--slurp"];
  const response = spawnSync("gh", ["api", "--hostname", "github.com", ...pagination, endpoint], {
    encoding: "utf8", maxBuffer: 16_777_216, timeout,
  });
  if (timeRemaining !== undefined && response.error?.code === "ETIMEDOUT") return null;
  if (response.error !== undefined || response.status !== 0) {
    fail("could not read release evidence from GitHub Actions");
  }
  let pages;
  try {
    const data = JSON.parse(response.stdout);
    pages = firstPage ? [data] : data;
  } catch {
    fail("GitHub Actions returned invalid release evidence");
  }
  if (!Array.isArray(pages) || pages.length === 0 ||
      pages.some((page) => !Array.isArray(page?.[field]))) {
    fail("GitHub Actions returned incomplete release evidence");
  }
  return pages.flatMap((page) => page[field]);
}

const listRuns = (context, repository, workflow, sha) => actionsData(
  context,
  `repos/${repository}/actions/workflows/${workflow}/runs?branch=main&head_sha=${sha}&status=success&per_page=100`,
  "workflow_runs",
);

const listMergeQueueRuns = (context, repository, sha) => actionsData(
  context,
  `repos/${repository}/actions/workflows/ci.yml/runs?event=merge_group&head_sha=${sha}&status=success&per_page=100`,
  "workflow_runs",
);

// `base...head` compares through the merge base. An `ahead` or `identical`
// status with nothing behind means main contains the selected commit.
export function containsCommit(comparison) {
  return record(comparison) && ["ahead", "identical"].includes(comparison.status) &&
    comparison.behind_by === 0;
}

// Whether `head` contains `base`. API and parse failures stop the release
// rather than being read as "not contained", which would hide outages.
function commitContains(context, repository, base, head, timeRemaining) {
  const timeout = Math.min(timeRemaining?.() ?? REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS);
  if (timeout === 0) return null;
  const response = spawnSync("gh", [
    "api", "--hostname", "github.com", `repos/${repository}/compare/${base}...${head}?per_page=1`,
  ], { encoding: "utf8", maxBuffer: 16_777_216, timeout });
  if (timeRemaining !== undefined && response.error?.code === "ETIMEDOUT") return null;
  if (response.error !== undefined || response.status !== 0) {
    context.fail("could not compare release evidence commits on GitHub");
  }
  let comparison;
  try {
    comparison = JSON.parse(response.stdout);
  } catch {
    context.fail("GitHub returned an invalid commit comparison for release evidence");
  }
  return containsCommit(comparison);
}

export function assertOnMain(context, repository, sha) {
  if (!commitContains(context, repository, sha, "main")) {
    context.fail("the selected source SHA must be on main");
  }
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

// Changed tracked paths between an ancestor and the checked-out release SHA,
// using the scope job's semantics: both trees, NUL-delimited names and no
// rename detection, so moves and deletions count on both sides. Returns null
// when the comparison cannot be made, which leaves the lane without evidence.
function changedPathsSince(base, sha, timeRemaining) {
  const runGit = (args, options) => {
    const timeout = timeRemaining();
    return timeout === 0 ? null : spawnSync("git", args, { ...options, timeout });
  };
  const present = runGit(["cat-file", "-e", `${base}^{commit}`], { stdio: "ignore" });
  if (present === null || present.error !== undefined) return null;
  if (present.status !== 0) {
    const fetched = runGit(["fetch", "--quiet", "--no-tags", "--depth=1", "origin", base], {
      stdio: "ignore",
    });
    if (fetched === null || fetched.error !== undefined || fetched.status !== 0) return null;
  }
  const diff = runGit(["diff", "--name-only", "--no-renames", "-z", base, sha, "--"], {
    maxBuffer: 67_108_864,
  });
  if (diff === null || diff.error !== undefined || diff.status !== 0) return null;
  try {
    return utf8.decode(diff.stdout).split("\0").filter((path) => path.length > 0);
  } catch {
    return null;
  }
}

export function findAndroidMavenArtifact(artifacts, run, sha) {
  const name = `android-maven-${sha}`;
  const matches = artifacts.filter((artifact) => artifact?.name === name);
  if (matches.length !== 1) return null;
  const [artifact] = matches;
  return isRetainedRunArtifact(artifact, run, sha) ? artifact.id : null;
}

const isRetainedRunArtifact = (artifact, run, sha) =>
  positiveId(artifact.id) && artifact.expired === false &&
    Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 &&
    typeof artifact.digest === "string" && /^sha256:[0-9a-f]{64}$/u.test(artifact.digest) &&
    artifact.workflow_run?.id === run.id && artifact.workflow_run.head_sha === sha &&
    typeof run.head_branch === "string" &&
    artifact.workflow_run.head_branch === run.head_branch;

function cached(cache, key, load) {
  if (!cache.has(key)) cache.set(key, load());
  return cache.get(key);
}

export function assertPublicCiRun(context, repository, sha, {
  mergeQueue = false, requireAndroidPublication = false, lanes = [],
} = {}) {
  const root = `repos/${repository}/actions`;
  const runs = listRuns(context, repository, "ci.yml", sha);
  if (mergeQueue) {
    const known = new Set(runs.map((run) => run?.id));
    runs.push(...listMergeQueueRuns(context, repository, sha).filter((run) => !known.has(run?.id)));
  }
  let androidArtifactId = null;
  const acceptsRun = (run) => {
    if (!requireAndroidPublication) return true;
    const endpoint = `${root}/runs/${run.id}/artifacts?name=android-maven-${sha}&per_page=100`;
    androidArtifactId = findAndroidMavenArtifact(actionsData(context, endpoint, "artifacts"), run, sha);
    return androidArtifactId !== null;
  };
  const jobs = new Map();
  const ancestry = new Map();
  const changes = new Map();
  const listJobs = (run, timeRemaining) => cached(jobs, `${run.id}/${run.run_attempt}`, () =>
    actionsData(context, `${root}/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`, "jobs", { timeRemaining }));
  let history;
  let deadline;
  const timeRemaining = () => Math.max(0, Math.ceil(deadline - performance.now()));
  const carriedBySkippedSet = new Map();
  const carryForward = (skipped) => {
    const key = skipped.map(({ name }) => name).sort().join(",");
    return cached(carriedBySkippedSet, key, () => {
      deadline ??= performance.now() + CARRY_FORWARD_BUDGET_MS;
      const options = { firstPage: true, timeRemaining };
      history ??= [
        ...(actionsData(context, `${root}/workflows/ci.yml/runs?branch=main&status=success&per_page=100`, "workflow_runs", options) ?? []),
        ...(mergeQueue
          ? actionsData(context, `${root}/workflows/ci.yml/runs?event=merge_group&status=success&per_page=100`, "workflow_runs", options) ?? []
          : []),
      ];
      return findCarriedLaneEvidence(skipped, history, repository, sha, mergeQueue, {
        listJobs: (run) => listJobs(run, timeRemaining),
        isAncestor: (base) => cached(ancestry, base, () => commitContains(context, repository, base, sha, timeRemaining)),
        changedPaths: (base) => cached(changes, base, () => changedPathsSince(base, sha, timeRemaining)),
        timeRemaining,
      });
    });
  };
  const selected = findPublicCiRun(runs, repository, sha, listJobs, { acceptsRun, mergeQueue, lanes, carryForward });
  if (selected === null) {
    const remedy = "Dispatch CI on main at this SHA to run every lane.";
    if (requireAndroidPublication) {
      context.fail(`Maven preflight needs successful Required CI with a retained tested Android publication for this SHA. ${remedy}`);
    }
    context.fail(`the selected source SHA needs successful Required CI, and each path-scoped lane must have run for it or have an unchanged earlier result. ${remedy}`);
  }
  // Pushes and queue runs record the SHA they tested, not whether it is still
  // on main. A force push or a queue entry that never merged must not qualify.
  assertOnMain(context, repository, sha);
  return { ciRunId: selected.runId, ciRunAttempt: selected.runAttempt, androidArtifactId, carriedLanes: selected.carried };
}

export function publicPreflightTitle(ecosystem, version, sha) {
  return `Preflight ${ecosystem} ${version} ${sha}`;
}

export function renderPreflightSummaryStep() {
  // Render a self-contained step so package jobs can report inputs without
  // checking out the runner again. Keep both patterns compatible with Bash.
  const fence = "```";
  return `- name: Show release form inputs
  shell: bash
  env:
    RELEASE_VERSION: \${{ inputs.version }}
    SOURCE_SHA: \${{ inputs.source_sha }}
    VERSION_PATTERN: '${stableVersion.source}'
    SHA_PATTERN: '${shaPattern.source}'
  run: |
    if [[ "$GITHUB_EVENT_NAME" != workflow_dispatch || "$GITHUB_REF" != refs/heads/main ||
          "$SOURCE_SHA" != "$GITHUB_SHA" || ! "$SOURCE_SHA" =~ $SHA_PATTERN ||
          ! "$RELEASE_VERSION" =~ $VERSION_PATTERN ]]; then
      echo "::warning::Cannot show release inputs without a matching preflight dispatch on main." >&2
      exit 0
    fi
    if [[ -z "$GITHUB_STEP_SUMMARY" ]]; then
      echo "::warning::GitHub Actions did not provide a job summary file." >&2
      exit 0
    fi
    if ! printf '%s\\n' '## Release form inputs' '' \\
        'Copy these values into the release form for this ecosystem once the preflight run succeeds.' '' \\
        '**Version**' '${fence}text' "$RELEASE_VERSION" '${fence}' '' \\
        '**Source SHA**' '${fence}text' "$SOURCE_SHA" '${fence}' >>"$GITHUB_STEP_SUMMARY"; then
      echo "::warning::Could not write release inputs to the GitHub Actions summary." >&2
    fi
`;
}

export function findPublicPreflightRun(runs, repository, workflow, ecosystem, version, sha) {
  return qualifyingPreflightRuns(runs, repository, workflow, ecosystem, version, sha)[0]?.id ?? null;
}

function qualifyingPreflightRuns(runs, repository, workflow, ecosystem, version, sha) {
  const title = publicPreflightTitle(ecosystem, version, sha);
  return runs.filter((run) =>
    exactMainRun(run, repository, sha, `.github/workflows/${workflow}`) &&
    run.event === "workflow_dispatch" && run.display_title === title)
    .sort((a, b) => b.id - a.id);
}

// Artifact metadata binds the CI run ID to this successful preflight. The
// file inside records the exact attempts and carried lanes for later audit.
// A partial preflight rerun can reuse a receipt from a successful earlier job.
export function findPreflightCiReceipt(artifacts, preflight, sha) {
  const receipts = artifacts.flatMap((artifact) => {
    const match = typeof artifact?.name === "string" ? receiptName.exec(artifact.name) : null;
    if (match === null) return [];
    const attempt = Number(match[1]);
    const ciRunId = Number(match[2]);
    return positiveId(attempt) && attempt <= preflight.run_attempt && positiveId(ciRunId)
      ? [{ attempt, ciRunId, artifact }]
      : [];
  }).sort((a, b) => b.attempt - a.attempt);
  const receipt = receipts[0];
  if (receipt === undefined || receipts[1]?.attempt === receipt.attempt ||
      !isRetainedRunArtifact(receipt.artifact, preflight, sha)) return null;
  return receipt.ciRunId;
}

export function assertPublicPreflightRun(context, repository, release, ecosystem, version, sha) {
  const channel = release.channels.get(ecosystem);
  if (channel === undefined) {
    context.fail("the selected release ecosystem does not have a configured preflight");
  }
  const workflow = channel.preflight;
  const runs = listRuns(context, repository, workflow, sha);
  const names = channel.artifacts.map((name) => packageArtifactName(name, version, sha));
  if (new Set(names).size !== names.length) context.fail("preflight package artifact names must resolve to distinct names");
  let foundCiReceipt = false;
  for (const run of qualifyingPreflightRuns(runs, repository, workflow, ecosystem, version, sha)) {
    const endpoint = `repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`;
    const artifacts = actionsData(context, endpoint, "artifacts");
    const ciRunId = findPreflightCiReceipt(artifacts, run, sha);
    if (ciRunId === null) continue;
    foundCiReceipt = true;
    const packageArtifactIds = findPackageArtifacts(artifacts, run, sha, names);
    if (packageArtifactIds !== null) return { preflightRunId: run.id, ciRunId, packageArtifactIds };
  }
  if (foundCiReceipt) {
    context.fail("publish requires every declared package artifact to be retained with a SHA-256 digest in the same successful preflight run");
  }
  context.fail("publish requires a successful ecosystem preflight with a retained CI receipt for the exact version and source SHA");
}

export function findPackageArtifacts(artifacts, run, sha, names) {
  const byName = Map.groupBy(artifacts, (artifact) => artifact?.name);
  const ids = [];
  for (const name of names) {
    const matches = byName.get(name);
    if (matches?.length !== 1 || !isRetainedRunArtifact(matches[0], run, sha)) return null;
    ids.push(matches[0].id);
  }
  return new Set(ids).size === ids.length ? ids : null;
}

export function writePublicPreflightReceipt(context, identity, ci) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  const directory = process.env.RUNNER_TEMP;
  if (typeof directory !== "string" || !isAbsolute(directory)) {
    context.fail("GitHub Actions did not provide a temporary directory for the CI receipt");
  }
  const receipt = {
    schema: 1, ...identity, ciRunId: ci.ciRunId, ciRunAttempt: ci.ciRunAttempt,
    androidArtifactId: ci.androidArtifactId, carriedLanes: Object.fromEntries(ci.carriedLanes),
  };
  try {
    writeFileSync(join(directory, receiptFile), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch {
    context.fail("could not write the verified CI receipt to the runner temporary directory");
  }
}

export function writePublicReleaseOutputs(context, {
  ciRunId, androidArtifactId, preflightRunId, packageArtifactIds, tagOwner,
}) {
  const output = process.env.GITHUB_OUTPUT;
  if (process.env.GITHUB_ACTIONS !== "true") return;
  if (typeof output !== "string" || output.length === 0) {
    context.fail("GitHub Actions did not provide an output file for release evidence");
  }
  try {
    const preflight = preflightRunId === null ? "" : `preflight_run_id=${preflightRunId}\n`;
    const android = androidArtifactId === null ? "" : `android_artifact_id=${androidArtifactId}\n`;
    const artifacts = packageArtifactIds === undefined ? "" : `package_artifact_ids=${packageArtifactIds.join(",")}\n`;
    appendFileSync(output, `ci_run_id=${ciRunId}\n${android}${preflight}${artifacts}tag_owner=${tagOwner}\n`);
  } catch {
    context.fail("could not write the verified release evidence to GitHub Actions outputs");
  }
}
