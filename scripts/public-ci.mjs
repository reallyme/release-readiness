// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { readPublicRelease } from "./public-release.mjs";

export const PUBLIC_CI_CONFIG = ".github/release-readiness.json";
export const PUBLIC_CI_WORKFLOW = ".github/workflows/ci.yml";

const laneNames = ["policy", "code", "proto", "security", "fuzz", "wasm", "swift", "android", "conformance", "formal"];
const workflowsDirectory = ".github/workflows/";
const formalWorkflowName = /^\.github\/workflows\/formal-(?:verification|methods)\.ya?ml$/u;
const formalModelFile = /\.(?:tla|spthy)$/u;
const checkout = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const hostedRunners = new Set([
  "ubuntu-slim", "ubuntu-latest", "ubuntu-22.04", "ubuntu-24.04", "ubuntu-26.04",
  "ubuntu-22.04-arm", "ubuntu-24.04-arm", "ubuntu-26.04-arm",
  "macos-latest", "macos-15", "macos-15-intel", "macos-26", "macos-26-intel", "xcode-27",
  "windows-latest", "windows-2022", "windows-2025", "windows-2025-vs2026",
  "windows-11-arm", "windows-11-vs2026-arm",
]);
// Shell scripts can resolve and call helpers through environment variables,
// working directories, and nested actions. Treat these CI directories as
// shared inputs so changes to indirect helpers also schedule verification.
const sharedPaths = [
  PUBLIC_CI_CONFIG, ".github/workflows/", ".github/actions/", ".github/scripts/", "scripts/",
  ".cargo/", "rust-toolchain.toml", "Cargo.toml", "Cargo.lock",
  "buf.yaml", "buf.gen.yaml", "buf.lock", "package.json", "package-lock.json",
];
const pathSegment = /^[a-zA-Z0-9_.-]+$/u;
const workflowFilename = /^[a-z0-9][a-z0-9_-]*\.ya?ml$/u;

const hasOnlyKeys = (value, keys) =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));

const validPath = (path) =>
  typeof path === "string" && path.length <= 240 &&
  path.replace(/\/$/u, "").split("/").every((segment) =>
    pathSegment.test(segment) && segment !== "." && segment !== "..");

const matchesPathRule = (path, rule) => rule.endsWith("/") ? path.startsWith(rule) : path === rule;

const checkoutAttributes = /(?:^|\/)\.gitattributes$/u;
const formalBuildInput = /(?:^|\/)(?:Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?|\.cargo\/config(?:\.toml)?)$/u;
const fuzzWorkspaceInputs = ["fuzz/Cargo.toml", "fuzz/Cargo.lock"];

// The planner runs against Git's NUL-delimited names. Comparing both trees
// and disabling rename detection makes a deletion or a move out of a lane
// just as visible as adding a file.
const scopeScript = `set -euo pipefail
if [[ ! "$HEAD_SHA" =~ ^[a-f0-9]{40}$ ]] || [[ "$(git rev-parse --verify HEAD)" != "$HEAD_SHA" ]]; then
  echo "::error::The scope job did not check out the candidate SHA."
  exit 1
fi
paths_file=$(mktemp)
changed_file=$(mktemp)
trap 'rm -f "$paths_file" "$changed_file"' EXIT
# A pull request candidate is GitHub's test merge. Its first parent is the
# exact base it was merged with, and the two-commit checkout already has it.
if [[ "\${EVENT_NAME:-}" == "pull_request" ]]; then
  BASE_SHA=$(git rev-parse --verify --quiet "HEAD^1^{commit}" || true)
fi
if [[ "$BASE_SHA" =~ ^[a-f0-9]{40}$ && "$BASE_SHA" != "$HEAD_SHA" ]] &&
   { git cat-file -e "$BASE_SHA^{commit}" 2>/dev/null ||
     git fetch --quiet --no-tags --depth=1 origin "$BASE_SHA"; } &&
   git diff --name-only --no-renames -z "$BASE_SHA" "$HEAD_SHA" -- >"$paths_file"; then
  # A file name that cannot be represented as a JSON string should never
  # cause a relevant lane to be omitted.
  if ! iconv -f UTF-8 -t UTF-8 "$paths_file" | jq -Rs 'split("\\u0000") | map(select(length > 0))' >"$changed_file"; then
    printf '%s\\n' null >"$changed_file"
  fi
else
  echo "::notice::No reliable diff baseline. Running all CI lanes."
  printf '%s\\n' null >"$changed_file"
fi
lanes=$(jq -cen --argjson rules "$LANE_PATHS" --argjson shared "$SHARED_PATHS" --arg attributes "$CHECKOUT_ATTRIBUTES" --arg formal "$FORMAL_BUILD_INPUT" --slurpfile changes "$changed_file" '
  def includes_path($path):
    any(.[]; . as $rule | if endswith("/") then $path | startswith($rule) else . == $path end);
  $changes[0] as $changed | $rules | with_entries(.key as $lane | .value |= (. as $paths |
    $changed == null or ($paths | length == 0) or any($changed[];
      . as $path | ($shared | includes_path($path)) or ($paths | includes_path($path)) or ($path | test($attributes)) or
      ($lane == "formal" and ($path | test($formal))))))
')
echo "lanes=$lanes" >>"$GITHUB_OUTPUT"`;

const gateScript = `set -euo pipefail
if ! jq -er --arg sha "$HEAD_SHA" --arg fixed "$FIXED_PLAN" '
  . as $needs |
  (if $fixed != "" then $fixed else .scope.outputs.lanes end | try fromjson catch null) as $plan |
  if ($sha | test("^[a-f0-9]{40}$") | not) or
     ($fixed == "" and $needs.scope.result != "success") or ($plan | type) != "object" then
    error("CI scope did not produce a valid plan")
  elif ($plan | keys) != ($needs | del(.scope) | keys) or $plan.policy != true then
    error("CI scope did not plan every lane")
  else
    [ $plan | to_entries[] | .key as $lane |
      (if .value == true then "success" elif .value == false then "skipped" else "invalid" end) as $expected |
      $needs[$lane].result as $actual |
      if $expected == "invalid" or $expected != $actual then
        "\\($lane) expected \\($expected), got \\($actual)"
      elif $expected == "success" and $needs[$lane].outputs.verified_sha != $sha then
        "\\($lane) did not verify the candidate SHA"
      else empty end
    ] | if length == 0 then "Required CI passed" else error(join("; ")) end
  end
' <<<"$NEEDS"; then
  echo "::error::A required CI lane failed, was cancelled, or disagreed with the change plan."
  exit 1
fi`;

// Keep this header narrow so the adapter runs only when called. The required
// gate needs a receipt because a reusable workflow can succeed with skipped jobs.
const reusableReceiptJob = (source) => {
  const trigger = /^(?:on|'on'|"on")\s*:/gmu;
  if ([...source.matchAll(trigger)].length !== 1) return undefined;
  const normalized = source.replaceAll("\r\n", "\n").replaceAll(/^[ \t]*#.*\n|^[ \t]*\n/gmu, "");
  const output = /^on:\n  workflow_call:\n    outputs:\n      verified_sha:\n        value: \$\{\{ jobs\.([a-z][a-z0-9_-]*)\.outputs\.verified_sha \}\}[ \t]*\n(?=[^ \t]|$)/mu;
  return output.exec(normalized)?.[1];
};

function hostedMatrixIncludes(workflow, include, invalid) {
  if (include === undefined) return [];
  if (include.value !== "") invalid();
  const rows = [];
  for (const line of workflow.lines.slice(include.index + 1, include.end)) {
    if (/^\s*(?:#|$)/u.test(line)) continue;
    const entry = /^ {10}(?:- |  )([A-Za-z_][A-Za-z0-9_-]*):[ \t]+(.+)$/u.exec(line.trimEnd());
    if (entry === null) invalid();
    if (line.startsWith("          - ")) rows.push(new Map());
    const row = rows.at(-1);
    if (row === undefined || row.has(entry[1])) invalid();
    // Other fields can customize the job, but every runner must remain static.
    row.set(entry[1], workflow.scalar(entry[2]));
  }
  if (rows.length === 0) invalid();
  return rows;
}

function assertHostedLane(context, path, workflow) {
  for (const [name, job] of workflow.jobs) {
    const invalid = () => context.fail(`${path} job ${name} must use a standard GitHub-hosted runner for every static matrix entry`);
    const runner = workflow.value(job.get("runs-on"));
    if (job.has("uses")) invalid();
    if (hostedRunners.has(runner)) continue;
    const axis = /^\$\{\{\s*matrix\.([a-z][a-z0-9_-]*)\s*\}\}$/u.exec(runner)?.[1];
    if (axis === undefined || axis === "include" || axis === "exclude") invalid();
    const strategy = workflow.block(job.get("strategy"), 6);
    const matrix = workflow.block(strategy.get("matrix"), 8);
    const rows = hostedMatrixIncludes(workflow, matrix.get("include"), invalid);
    if (rows.some((row) => !hostedRunners.has(row.get(axis)))) invalid();
    if (matrix.has(axis)) {
      if (workflow.sequence(matrix.get(axis), 8, `job ${name} runner axis`)
        .some((label) => !hostedRunners.has(label))) invalid();
      continue;
    }
    if (rows.length === 0) invalid();
    // GitHub adds unmatched include entries as standalone jobs. Those are
    // covered above. Every original combination still needs a runner, too.
    // Check the full product so an exclude rule cannot hide a missing runner.
    let combinations = [new Map()];
    for (const [key, field] of matrix) {
      if (key === "include" || key === "exclude") continue;
      const values = workflow.sequence(field, 8, `job ${name} matrix axis ${key}`);
      // Limit the comparison to plain string values. YAML number, boolean,
      // and null values could otherwise compare differently on GitHub.
      if (values.some((value) => !/^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/iu.test(value) ||
          /^(?:true|false|null|y|yes|n|no|on|off)$/iu.test(value)) ||
          combinations.length * values.length > 256) invalid();
      combinations = combinations.flatMap((combination) =>
        values.map((value) => new Map([...combination, [key, value]])));
    }
    if (combinations.some((combination) => !rows.some((row) =>
      [...combination].every(([key, value]) => !row.has(key) || row.get(key) === value)))) invalid();
  }
}

function assertFormalCoverage(context, trackedFiles, lane) {
  const workflows = [...trackedFiles].filter((path) => formalWorkflowName.test(path));
  const models = [...trackedFiles].filter((path) => formalModelFile.test(path));
  const harnesses = [...trackedFiles].some((path) => path.endsWith(".rs")) ? context.trackedKaniHarnesses() : [];
  if (lane === undefined) {
    if (workflows.length > 0 || models.length > 0 || harnesses.length > 0) {
      context.fail(`${PUBLIC_CI_CONFIG} must declare a formal lane for tracked formal workflows, models or Kani harnesses`);
    }
    return;
  }
  if (workflows.some((path) => path !== lane.path)) {
    context.fail("use the formal lane's reusable workflow for required proofs and separate names for extended runs");
  }
  if (lane.paths.length === 0) return;
  const tlaDirectories = new Set(models.filter((path) => path.endsWith(".tla")).map(
    (path) => path.slice(0, path.lastIndexOf("/") + 1),
  ));
  const inputs = [...models, ...harnesses, ...[...trackedFiles].filter((path) =>
    path.endsWith(".cfg") && tlaDirectories.has(path.slice(0, path.lastIndexOf("/") + 1)),
  )];
  const rules = [...sharedPaths, ...lane.paths];
  for (const path of inputs) {
    if (!rules.some((rule) => matchesPathRule(path, rule))) {
      context.fail(`the formal lane must cover changes to ${path}`);
    }
  }
}

export function readPublicCiConfig(context, trackedFiles, { selfCheck = false } = {}) {
  const { fail } = context;
  if (!trackedFiles.has(PUBLIC_CI_CONFIG)) {
    fail(`public repositories must track ${PUBLIC_CI_CONFIG}`);
  }
  const config = context.readJson(PUBLIC_CI_CONFIG);
  if (!hasOnlyKeys(config, ["schema", "lanes", "mergeQueue", "release", "otherReleases"]) || config.schema !== 1 ||
      !hasOnlyKeys(config.lanes, laneNames) || !Object.hasOwn(config.lanes, "policy")) {
    fail(`${PUBLIC_CI_CONFIG} must declare schema 1 and a policy lane using the supported CI lane names`);
  }
  if (Object.hasOwn(config, "mergeQueue") && typeof config.mergeQueue !== "boolean") {
    fail(`${PUBLIC_CI_CONFIG} mergeQueue must be true or false`);
  }
  const mergeQueue = config.mergeQueue === true;
  const usedWorkflows = new Set();
  const lanes = new Map();
  for (const name of laneNames) {
    if (!Object.hasOwn(config.lanes, name)) {
      continue;
    }
    const lane = config.lanes[name];
    if (!hasOnlyKeys(lane, name === "formal" ? ["workflow", "paths", "mode"] : ["workflow", "paths"]) ||
        typeof lane.workflow !== "string" || !workflowFilename.test(lane.workflow)) {
      fail(`${PUBLIC_CI_CONFIG} lane ${name} must name a local reusable workflow`);
    }
    const mode = lane.mode ?? "required";
    if (Object.hasOwn(lane, "mode") && !["required", "manual"].includes(lane.mode)) {
      fail(`${PUBLIC_CI_CONFIG} formal mode must be required or manual`);
    }
    const path = `${workflowsDirectory}${lane.workflow}`;
    if (["ci.yml", "ci.yaml", "cla.yml", "cla.yaml"].includes(lane.workflow) || usedWorkflows.has(path)) {
      fail(`${PUBLIC_CI_CONFIG} lane ${name} must use a dedicated reusable workflow`);
    }
    const paths = lane.paths ?? [];
    if ((Object.hasOwn(lane, "paths") && !Array.isArray(lane.paths)) ||
        paths.length > 128 || paths.some((path) => !validPath(path)) ||
        new Set(paths).size !== paths.length || (name === "policy" && paths.length !== 0)) {
      fail(`${PUBLIC_CI_CONFIG} lane ${name} has invalid change paths or tries to scope the policy lane`);
    }
    for (const changedPath of paths) {
      const exists = changedPath.endsWith("/")
        ? [...trackedFiles].some((file) => file.startsWith(changedPath))
        : trackedFiles.has(changedPath);
      if (!exists) {
        fail(`${PUBLIC_CI_CONFIG} lane ${name} change path must cover a tracked file: ${changedPath}`);
      }
    }
    if (!trackedFiles.has(path)) {
      fail(`${path} must be tracked${mode === "manual" ? " for manual formal verification" : " and use the reusable-only workflow_call trigger with a verified_sha output"}`);
    }
    const source = context.readText(path);
    const receiptJob = reusableReceiptJob(source);
    if (mode !== "manual" && receiptJob === undefined) {
      fail(`${path} must use the reusable-only workflow_call trigger with a verified_sha output`);
    }
    if (mode !== "manual" && /^(?:concurrency|"concurrency"|'concurrency')\s*:/mu.test(source)) {
      fail(`${path} must leave workflow concurrency to ${PUBLIC_CI_WORKFLOW}`);
    }
    const workflow = context.readPublicWorkflow(path, source);
    assertHostedLane(context, path, workflow);
    if (name === "policy") {
      const job = workflow.jobs.get(receiptJob);
      if (job === undefined || job.has("strategy") || job.has("if") ||
          (job.has("continue-on-error") && workflow.value(job.get("continue-on-error")) !== "false")) {
        fail(`${path} must define one required policy receipt job ${receiptJob}`);
      }
      context.assertPublicPolicyWorkflow(path, receiptJob, selfCheck);
    }
    if (name === "fuzz" && fuzzWorkspaceInputs.every((input) => trackedFiles.has(input))) {
      for (const input of fuzzWorkspaceInputs) {
        if (paths.length !== 0 && !paths.some((rule) => matchesPathRule(input, rule))) {
          fail(`the fuzz lane must cover changes to ${input}`);
        }
      }
      context.assertFuzzLockfileWorkflow(path, receiptJob);
    }
    if (name === "formal") {
      for (const script of context.assertFormalVerificationWorkflow(path, receiptJob, { mode })) {
        if (!trackedFiles.has(script) || context.readText(script).trim().length === 0) {
          fail(`${script} must be a tracked, non-empty formal verification script`);
        }
      }
    }
    usedWorkflows.add(path);
    lanes.set(name, { path, paths: [...paths].sort(), mode });
  }
  assertFormalCoverage(context, trackedFiles, lanes.get("formal"));
  const pathRulesBytes = [...lanes.values()].reduce((bytes, { paths }) =>
    bytes + Buffer.byteLength(JSON.stringify(paths)), 0);
  if (pathRulesBytes > 32_768) {
    fail(`${PUBLIC_CI_CONFIG} has too many total change path rules; use directory prefixes`);
  }
  if ([...trackedFiles].some((path) => path.endsWith(".proto")) && !lanes.has("proto")) {
    fail(`${PUBLIC_CI_CONFIG} must declare a proto lane for tracked protobuf schemas`);
  }
  return { lanes, mergeQueue, release: readPublicRelease(context, trackedFiles, config, usedWorkflows) };
}

// With a merge queue, main only ever moves to a commit the queue already
// tested, so a push run would repeat that exact run. Release qualification
// accepts the queue run instead, and a manual dispatch covers direct pushes.
export function renderPublicCi(lanes, { mergeQueue = false } = {}) {
  // Manual proofs have their own dispatch and never enter the required plan.
  // Omitting them also prevents a green gate from implying they ran.
  lanes = new Map([...lanes].filter(([, lane]) => lane.mode !== "manual"));
  const paths = Object.fromEntries([...lanes].map(([name, lane]) => [name, lane.paths]));
  const usesScope = [...lanes.values()].some((lane) => lane.paths.length > 0);
  const publicRepository = "github.repository_owner == 'reallyme' && toJSON(github.event.repository.private) == 'false' && (github.event.repository.visibility == null || github.event.repository.visibility == 'public')";
  const fixedPlan = usesScope ? "" : JSON.stringify(Object.fromEntries([...lanes.keys()].map((name) => [name, true])));
  const laneJobs = [...lanes].map(([name, { path, paths: lanePaths }]) => `  ${name}:
    ${lanePaths.length > 0 ? `needs: scope\n    if: \${{ fromJSON(needs.scope.outputs.lanes).${name} }}` : `if: \${{ ${publicRepository} }}`}
    uses: ./${path}`).join("\n\n");
  const indent = (script) => script.split("\n").map((line) => `          ${line}`).join("\n");
  const scopeJob = usesScope ? `  scope:
    name: Identify CI lanes
    if: \${{ ${publicRepository} }}
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    outputs:
      lanes: \${{ steps.plan.outputs.lanes }}
    steps:
      - name: Checkout candidate
        uses: ${checkout}
        with:
          persist-credentials: false
          fetch-depth: 2
          filter: blob:none
          sparse-checkout: ${PUBLIC_CI_CONFIG}
          sparse-checkout-cone-mode: false
      - name: Plan checks
        id: plan
        shell: bash
        env:
          EVENT_NAME: \${{ github.event_name }}
          BASE_SHA: \${{ github.event.merge_group.base_sha || github.event.before }}
          HEAD_SHA: \${{ github.sha }}
          LANE_PATHS: '${JSON.stringify(paths)}'
          SHARED_PATHS: '${JSON.stringify(sharedPaths)}'
          CHECKOUT_ATTRIBUTES: '${checkoutAttributes.source}'
          FORMAL_BUILD_INPUT: '${formalBuildInput.source}'
        run: |
${indent(scopeScript)}

` : "";
  const needs = [...(usesScope ? ["scope"] : []), ...lanes.keys()];
  const pushTrigger = mergeQueue ? "" : "  push:\n    branches: [main]\n";
  return `# SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
#
# SPDX-License-Identifier: MIT OR Apache-2.0
#
# Generated by release-readiness --render-ci from ${PUBLIC_CI_CONFIG}.

name: CI

on:
  pull_request:
    branches: [main]
${pushTrigger}  merge_group:
    types: [checks_requested]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-\${{ github.event_name }}-\${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}

jobs:
${scopeJob}${laneJobs}

  required:
    name: Required CI
    if: \${{ always() && ${publicRepository} }}
    needs: [${needs.join(", ")}]
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - name: Verify planned checks
        shell: bash
        env:
          NEEDS: \${{ toJSON(needs) }}
          HEAD_SHA: \${{ github.sha }}
          FIXED_PLAN: '${fixedPlan}'
        run: |
${indent(gateScript)}
`;
}

export function assertPublicCi(context, trackedFiles, options) {
  const { lanes, mergeQueue, release } = readPublicCiConfig(context, trackedFiles, options);
  if (!trackedFiles.has(PUBLIC_CI_WORKFLOW) || trackedFiles.has(".github/workflows/ci.yaml")) {
    context.fail(`public repositories must track ${PUBLIC_CI_WORKFLOW} as their standard CI workflow`);
  }
  context.assertPathsAbsent([".github/workflows/ci.yaml"]);
  const normalize = (source) => source.replaceAll("\r\n", "\n");
  if (normalize(context.readText(PUBLIC_CI_WORKFLOW)) !== renderPublicCi(lanes, { mergeQueue })) {
    context.fail(`${PUBLIC_CI_WORKFLOW} differs from the standard CI workflow. Regenerate it with --render-ci`);
  }
  const attributes = [...trackedFiles].filter((path) => checkoutAttributes.test(path));
  const coverage = new Map([...lanes.values()].filter((lane) => lane.mode !== "manual").map(({ path, paths }) => [
    path,
    paths.length === 0 ? [] : [...sharedPaths, ...attributes, ...paths],
  ]));
  return { coverage, release, mergeQueue, ciLanes: describeCiLanes(lanes), hasAndroidLane: lanes.has("android") };
}

// Release qualification must decide "would this lane have run" exactly as the
// scope job does, so it reuses these rules rather than re-deriving them. An
// unscoped lane runs on every candidate and can never be carried forward.
export function describeCiLanes(lanes) {
  // Preflight uses only the lanes represented by Required CI. A manual proof
  // is neither a missing result nor evidence that can be carried forward.
  return [...lanes].filter(([, lane]) => lane.mode !== "manual").map(([name, { paths }]) => ({
    name,
    scoped: paths.length > 0,
    inputsChanged: (changedPaths) => paths.length === 0 || changedPaths.some((path) =>
      sharedPaths.some((rule) => matchesPathRule(path, rule)) ||
      paths.some((rule) => matchesPathRule(path, rule)) ||
      checkoutAttributes.test(path) ||
      (name === "formal" && formalBuildInput.test(path))),
  }));
}
