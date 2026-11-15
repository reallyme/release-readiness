// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createReleaseReadinessContext } from "../core.mjs";
import { PUBLIC_CI_CONFIG, PUBLIC_CI_WORKFLOW, describeCiLanes, readPublicCiConfig, renderPublicCi } from "../scripts/public-ci.mjs";

const adapter = `on:
  workflow_call:
    outputs:
      verified_sha:
        value: \${{ jobs.verify.outputs.verified_sha }}
jobs:
  verify:
    runs-on: ubuntu-24.04
`;
const defaultConfig = {
  schema: 1,
  lanes: {
    policy: { workflow: "policy.yml" },
    swift: { workflow: "swift.yml", paths: ["packages/swift/", "Package.swift"] },
  },
};
const formalPath = ".github/workflows/formal-verification.yml";
const formalTemplate = readFileSync(new URL("../templates/formal-verification.yml", import.meta.url), "utf8");
const workflowContext = createReleaseReadinessContext({ scriptUrl: import.meta.url, requireTrackedFiles: false });
const parse = (mutate = () => {}) => {
  const config = structuredClone(defaultConfig);
  const trackedFiles = new Set([
    PUBLIC_CI_CONFIG, "Package.swift", "packages/swift/Library.swift",
    ".github/workflows/policy.yml", ".github/workflows/swift.yml",
  ]);
  const sources = new Map([...trackedFiles].filter((path) => path.endsWith(".yml")).map((path) => [path, adapter]));
  mutate(config, trackedFiles, sources);
  return readPublicCiConfig({
    readJson: () => config,
    readText: (path) => sources.get(path),
    fail: assert.fail,
    readPublicWorkflow: workflowContext.readPublicWorkflow,
    assertPublicPolicyWorkflow: () => {},
    trackedKaniHarnesses: () => [...trackedFiles].filter((path) => path.endsWith("_proofs.rs")),
    assertFormalVerificationWorkflow: (path, receipt) => {
      assert.equal(path, formalPath);
      assert.equal(receipt, "proofs");
      return ["scripts/check-formal.sh"];
    },
  }, trackedFiles);
};

const formalConfig = (config, trackedFiles, sources) => {
  trackedFiles.add(formalPath);
  trackedFiles.add("formal/Session.tla");
  trackedFiles.add("formal/Session.cfg");
  trackedFiles.add("formal/session.spthy");
  trackedFiles.add("scripts/check-formal.sh");
  sources.set(formalPath, formalTemplate);
  sources.set("scripts/check-formal.sh", "cargo kani");
  config.lanes.formal = { workflow: "formal-verification.yml", paths: ["formal/"] };
};

test("standard CI renders deterministically and rejects unsupported or untracked lanes", () => {
  const { lanes } = parse();
  const { lanes: reordered } = parse((config) => {
    config.lanes.swift.paths.reverse();
    config.lanes = { swift: config.lanes.swift, policy: config.lanes.policy };
  });
  assert.equal(renderPublicCi(lanes), renderPublicCi(reordered));
  assert.match(renderPublicCi(lanes), /needs: \[scope, policy, swift\]/u);
  assert.match(renderPublicCi(lanes), /\n  policy:\n    if:/u);
  assert.match(renderPublicCi(lanes), /\n  swift:\n    needs: scope/u);
  const unscoped = renderPublicCi(parse((config) => { delete config.lanes.swift.paths; }).lanes);
  assert.match(unscoped, /needs: \[policy, swift\]/u);
  assert.doesNotMatch(unscoped, /Identify CI lanes/u);
  parse((_config, _files, sources) => {
    sources.set(".github/workflows/swift.yml", adapter.replace("    runs-on: ubuntu-24.04", `
    strategy:
      matrix:
        os: [ubuntu-24.04, macos-15-intel]
    runs-on: \${{ matrix.os }}`));
  });
  for (const [mutate, message] of [
    [(config) => { delete config.lanes.policy; }, /policy lane/u],
    [(config) => { config.schema = 2; }, /schema 1/u],
    [(config) => { config.lanes.proto = { workflow: "https://invalid" }; }, /local reusable workflow/u],
    [(config) => { config.lanes.swift.workflow = "policy.yml"; }, /dedicated reusable workflow/u],
    [(config) => { config.lanes.swift.paths = ["../", "packages/**"]; }, /invalid change paths/u],
    [(config) => { config.lanes.swift.paths = ["missing/"]; }, /cover a tracked file/u],
    [(config) => { config.lanes.swift.paths = null; }, /invalid change paths/u],
    [(config) => { config.lanes.policy.paths = ["Package.swift"]; }, /scope the policy lane/u],
    [(_config, files) => { files.delete(".github/workflows/swift.yml"); }, /verified_sha output/u],
    [(_config, files) => { files.add("api.proto"); }, /must declare a proto lane/u],
    [(_config, _files, sources) => {
      sources.set(".github/workflows/swift.yml", adapter.replace("on:\n", "on:\n  push:\n"));
    }, /verified_sha output/u],
    [(_config, _files, sources) => {
      sources.set(".github/workflows/swift.yml", `concurrency: grouped\n${adapter}`);
    }, /leave workflow concurrency/u],
    [(_config, _files, sources) => {
      sources.set(".github/workflows/swift.yml", "on: workflow_call\njobs: {}\n");
    }, /verified_sha output/u],
    [(_config, _files, sources) => {
      sources.set(".github/workflows/swift.yml", adapter.replace("ubuntu-24.04", "self-hosted"));
    }, /standard GitHub-hosted runner/u],
    [(_config, _files, sources) => {
      sources.set(".github/workflows/swift.yml", adapter.replace("runs-on: ubuntu-24.04", "runs-on: [self-hosted, Linux]"));
    }, /standard GitHub-hosted runner/u],
  ]) {
    assert.throws(() => parse(mutate), message);
  }
});

test("release-readiness uses the CI and CLA generated from its own plan", () => {
  const { lanes } = readPublicCiConfig(
    workflowContext,
    new Set([PUBLIC_CI_CONFIG, ".github/workflows/checks.yml"]),
    { selfCheck: true },
  );
  assert.equal(readFileSync(new URL(`../${PUBLIC_CI_WORKFLOW}`, import.meta.url), "utf8"), renderPublicCi(lanes));
  assert.equal(
    readFileSync(new URL("../.github/workflows/cla.yaml", import.meta.url), "utf8"),
    readFileSync(new URL("../templates/cla.yaml", import.meta.url), "utf8"),
  );
});

test("hosted CI matrices accept project runner combinations and reject any uncovered or dynamic runner", () => {
  const lane = (matrix) => (_config, _files, sources) => {
    sources.set(".github/workflows/swift.yml", adapter.replace("    runs-on: ubuntu-24.04", `    runs-on: \${{ matrix.runner }}
    strategy:
      matrix:
${matrix}`));
  };
  const include = `        include:
          - target: aarch64-apple-ios
            runner: 'macos-15'
          - target: aarch64-linux-android
            runner: ubuntu-24.04 # Android only needs Linux here`;
  const mixed = `        target: [aarch64-apple-ios, aarch64-linux-android]
${include}`;
  parse(lane(include));
  parse(lane(mixed));
  parse(lane(`        runner:
          - ubuntu-24.04
          - macos-15`));
  for (const matrix of [
    mixed.replace("target: [aarch64-apple-ios,", "target: [unsupported,"),
    include.replace("'macos-15'", "self-hosted"),
    include.replace("'macos-15'", "\${{ inputs.runner }}"),
    include.replace("            runner: 'macos-15'\n", ""),
    `        runner: [ubuntu-24.04]
${include.replace("ubuntu-24.04 # Android only needs Linux here", "self-hosted")}`,
  ]) {
    assert.throws(() => parse(lane(matrix)), /standard GitHub-hosted runner/u);
  }
});

test("formal lane requires the model inputs and excludes duplicate required workflows", () => {
  const { lanes } = parse(formalConfig);
  const workflow = renderPublicCi(lanes);
  assert.match(workflow, /\n  formal:\n    needs: scope\n    if: .*\.formal \}\}/u);
  assert.match(workflow, /needs: \[scope, policy, swift, formal\]/u);
  for (const [change, diagnostic] of [
    [(config) => { delete config.lanes.formal; }, /must declare a formal lane/u],
    [(_config, files) => { files.add("crates/native/input_proofs.rs"); }, /cover changes to crates\/native\/input_proofs\.rs/u],
    [(_config, files) => { files.delete("scripts/check-formal.sh"); }, /must be a tracked, non-empty formal verification script/u],
    [(config) => { config.lanes.formal.paths = ["formal/Session.tla", "formal/session.spthy"]; }, /cover changes to formal\/Session\.cfg/u],
    [(config) => { config.lanes.formal.paths = ["formal/Session.tla", "formal/Session.cfg"]; }, /cover changes to formal\/session\.spthy/u],
    [(_config, files) => { files.add(".github/workflows/formal-methods.yml"); }, /separate names for extended runs/u],
  ]) {
    assert.throws(() => parse((...args) => {
      formalConfig(...args);
      change(...args);
    }), diagnostic);
  }
  assert.ok(parse((config, files, sources) => {
    formalConfig(config, files, sources);
    delete config.lanes.formal.paths;
    files.add(".github/workflows/formal-verification-extended.yml");
  }).lanes.has("formal"));
  for (const path of ["formal/Session.tla", "formal/session.spthy", ".github/workflows/formal-methods.yaml", "src/input_proofs.rs"]) {
    assert.throws(() => parse((_config, files) => { files.add(path); }), /must declare a formal lane/u);
  }
});

test("the formal template requires every proof job, Bash failure propagation and an exact-SHA result", (t) => {
  const root = mkdtempSync(join(tmpdir(), "reallyme-formal-ci-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "formal.yml");
  const verify = (source, receipt = "proofs") => {
    writeFileSync(file, source);
    return spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { createReleaseReadinessContext } from ${JSON.stringify(import.meta.resolve("../core.mjs"))};
      const context = createReleaseReadinessContext({ scriptUrl: import.meta.url, repoRoot: "." });
      context.assertFormalVerificationWorkflow("formal.yml", ${JSON.stringify(receipt)});
    `], { cwd: root, encoding: "utf8" });
  };
  const accepted = verify(formalTemplate);
  assert.equal(accepted.status, 0, accepted.stderr);
  const multiple = formalTemplate.replace("jobs.proofs.outputs", "jobs.verified.outputs").trimEnd() + `

  verified:
    needs: [proofs]
    runs-on: ubuntu-24.04
    timeout-minutes: 2
    outputs:
      verified_sha: \${{ github.sha }}
    steps:
      - run: echo Verified
`;
  const acceptedAggregate = verify(multiple, "verified");
  assert.equal(acceptedAggregate.status, 0, acceptedAggregate.stderr);
  for (const [source, diagnostic] of [
    [multiple.replace("    needs: [proofs]\n", ""), /must depend on every formal verification job/u],
    [multiple.replace("    needs: [proofs]", "    needs: [proofs]\n    if: always()"), /must run without a condition/u],
    [multiple.replace("    needs: [proofs]", "    needs: [proofs]\n    strategy:\n      matrix:\n        axis: [1, 2]"), /must report one result/u],
    [multiple.replace("  proofs:", '  "proofs":'), /must use block-form job IDs/u],
    [multiple.replace("    timeout-minutes: 15", "    timeout-minutes: 15\n    needs: [verified]"), /must run independently/u],
  ]) {
    const rejected = verify(source, "verified");
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.match(rejected.stderr, diagnostic);
  }
  for (const [source, diagnostic] of [
    [formalTemplate.replace("contents: read", "contents: write"), /permissions changed/u],
    [formalTemplate.replace("    timeout-minutes: 15", "    timeout-minutes: 0"), /explicit timeout/u],
    [formalTemplate.replace("    timeout-minutes: 15", "    timeout-minutes: 15\n    continue-on-error: true"), /propagate failures/u],
    [formalTemplate.replace("        shell: bash", "        shell: sh"), /must use shell: bash/u],
    [formalTemplate.replace("        shell: bash", "        if: false\n        shell: bash"), /must run Verify proof obligations unconditionally/u],
    [formalTemplate.replaceAll("github.sha", "github.event.before"), /must report the candidate/u],
    [formalTemplate.replace("      - name: Verify proof obligations", "      - name: Optional proof"), /must define one Verify proof obligations step/u],
    [formalTemplate.replace("persist-credentials: false", "persist-credentials: true"), /without persisting credentials/u],
    [formalTemplate.replace("persist-credentials: false", "persist-credentials: false\n          ref: main"), /must check out the candidate SHA/u],
    [formalTemplate.replace("        uses: actions/checkout@", "        if: false\n        uses: actions/checkout@"), /must check out the candidate before/u],
    [formalTemplate.replace("        working-directory: .\n", ""), /must run Verify proof obligations from the repository root/u],
    [formalTemplate.replace("bash -e -o pipefail scripts/check-formal.sh", "true"), /must verify the checked out SHA/u],
    [formalTemplate.replace('test "$(git rev-parse --verify HEAD)" = "$GITHUB_SHA"', "echo proof"), /must verify the checked out SHA/u],
    [formalTemplate.replace("bash -e -o pipefail scripts/check-formal.sh", "bash -e -o pipefail scripts/check-formal.sh || true"), /must verify the checked out SHA/u],
    [formalTemplate.replace("      - name: Verify proof obligations", `      - uses: actions/checkout@0000000000000000000000000000000000000000
      - name: Verify proof obligations`), /must use named setup steps/u],
  ]) {
    const rejected = verify(source);
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.match(rejected.stderr, diagnostic);
  }
});

const shellScript = (workflow, index) => {
  const lines = workflow.split("        run: |\n")[index].split("\n");
  const end = lines.findIndex((line) => line !== "" && !line.startsWith("          "));
  return lines.slice(0, end === -1 ? undefined : end).map((line) => line.slice(10)).join("\n");
};

test("formal proof step propagates failure, checks the checkout and discovers tracked Kani harnesses", (t) => {
  const root = mkdtempSync(join(tmpdir(), "reallyme-formal-proof-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "user.name=ReallyMe Test", "-c", "user.email=test@really.me", ...args], {
      cwd: root, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "--quiet", "--initial-branch=main");
  writeFileSync(join(root, "harness.rs"), "#[kani::proof]\nfn verify() {}\n");
  writeFileSync(join(root, "contract.rs"), "#[kani::proof_for_contract(property)]\nfn verify() {}\n");
  writeFileSync(join(root, "test.rs"), "// #[kani::proof]\n#[test]\nfn verify() {}\n");
  writeFileSync(join(root, "gated.rs"), "#[cfg_attr(kani, kani::proof)]\nfn verify() {}\n");
  writeFileSync(join(root, "gated_contract.rs"), "#[cfg_attr(kani, kani::proof_for_contract(property))]\nfn verify() {}\n");
  writeFileSync(join(root, "other_attr.rs"), "#[cfg_attr(feature = \"kani\", allow(dead_code))]\nfn verify() {}\n");
  git("add", "harness.rs", "contract.rs", "test.rs", "gated.rs", "gated_contract.rs", "other_attr.rs");
  git("commit", "--quiet", "-m", "Proof inputs");
  writeFileSync(join(root, "untracked.rs"), "#[kani::proof]\nfn verify() {}\n");
  const found = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { createReleaseReadinessContext } from ${JSON.stringify(import.meta.resolve("../core.mjs"))};
    const context = createReleaseReadinessContext({ scriptUrl: import.meta.url, repoRoot: "." });
    console.log(JSON.stringify(context.trackedKaniHarnesses()));
  `], { cwd: root, encoding: "utf8" });
  assert.equal(found.status, 0, found.stderr);
  assert.deepEqual(JSON.parse(found.stdout).sort(), ["contract.rs", "gated.rs", "gated_contract.rs", "harness.rs"]);

  const proof = "scripts/check-formal.sh";
  const sha = git("rev-parse", "HEAD");
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, proof), "false | cat\nprintf '%s\\n' proved\n");
  const run = (candidate) => spawnSync("bash", ["-e", "-o", "pipefail", "-c", shellScript(formalTemplate, 1)], {
    cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_SHA: candidate },
  });
  const failed = run(sha);
  assert.equal(failed.status, 1, failed.stderr);
  assert.equal(failed.stdout, "");
  writeFileSync(join(root, proof), "printf '%s\\n' proved\n");
  assert.equal(run("0".repeat(40)).stdout, "");
  const success = run(sha);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stdout, "proved\n");
  writeFileSync(join(root, proof), "printf '%s\\n' modified >harness.rs\n");
  const changed = run(sha);
  assert.equal(changed.status, 1, changed.stderr);
  assert.match(changed.stdout, /harness\.rs/u);
  writeFileSync(join(root, proof), "printf '%s\\n' proved\n");
  const alreadyChanged = run(sha);
  assert.equal(alreadyChanged.status, 1, alreadyChanged.stderr);
  assert.doesNotMatch(alreadyChanged.stdout, /proved/u);
});

const requireJq = (t) => {
  const jq = spawnSync("jq", ["--version"], { encoding: "utf8" });
  if (jq.error?.code === "ENOENT" && process.env.GITHUB_ACTIONS !== "true") {
    t.skip("jq is required to run the same CI script as the hosted workflow");
    return false;
  }
  assert.equal(jq.status, 0, jq.stderr);
  return true;
};

test("planner handles scoped changes, moves, large diffs and an unknown baseline", (t) => {
  if (!requireJq(t)) return;
  const root = mkdtempSync(join(tmpdir(), "reallyme-ci-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
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
  git("init", "--quiet", "--initial-branch=main");
  mkdirSync(join(root, "packages/swift"), { recursive: true });
  mkdirSync(join(root, "formal"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "packages/swift/Library.swift"), "old");
  writeFileSync(join(root, "formal/Session.tla"), "old");
  writeFileSync(join(root, "Package.swift"), "old");
  writeFileSync(join(root, "README.md"), "one");
  writeFileSync(join(root, "scripts/build.sh"), "echo old");
  const base = commit("Base");
  writeFileSync(join(root, "README.md"), "two");
  const docs = commit("Docs");
  writeFileSync(join(root, "formal/Session.tla"), "new");
  const modelChange = commit("Formal model");
  writeFileSync(join(root, "Package.swift"), "new");
  const packageChange = commit("Swift manifest");
  renameSync(join(root, "packages/swift/Library.swift"), join(root, "Moved.swift"));
  const rename = commit("Move source");
  writeFileSync(join(root, "Cargo.lock"), "shared");
  const common = commit("Shared dependency");
  mkdirSync(join(root, "tools/verifier/.cargo"), { recursive: true });
  writeFileSync(join(root, "tools/verifier/.cargo/config.toml"), "compiler configuration");
  const buildInput = commit("Nested Cargo configuration");
  writeFileSync(join(root, "scripts/build.sh"), "echo new");
  const shellInput = commit("Build helper change");
  writeFileSync(join(root, ".gitattributes"), "*.sh text eol=lf\n");
  const rootAttributes = commit("Root checkout attributes");
  writeFileSync(join(root, "packages/.gitattributes"), "*.swift text eol=lf\n");
  const nestedAttributes = commit("Nested checkout attributes");
  for (let n = 0; n < 650; n += 1) {
    writeFileSync(join(root, `change-${n}-${"x".repeat(200)}.md`), "large diff");
  }
  unlinkSync(join(root, "Package.swift"));
  const large = commit("Large diff with a deleted Swift manifest");
  const output = join(root, ".git", "output");
  const { lanes } = parse((config, files, sources) => {
    formalConfig(config, files, sources);
    files.add("scripts/build.sh");
    sources.set(".github/workflows/swift.yml", `${adapter}    steps:
      - run: bash "$GITHUB_WORKSPACE/scripts/build.sh"
      - working-directory: scripts
        run: ./build.sh
`);
  });
  const workflow = renderPublicCi(lanes);
  const planner = shellScript(workflow, 1);
  const envFrom = (key) => new RegExp(`^ +${key}: '([^']+)'$`, "mu").exec(workflow)[1];
  const plan = (before, after, expectedSwift, expectedFormal = false) => {
    git("checkout", "--quiet", "--detach", after);
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", planner], {
      cwd: root, encoding: "utf8",
      env: {
        ...process.env,
        BASE_SHA: before, HEAD_SHA: after, GITHUB_OUTPUT: output,
        LANE_PATHS: envFrom("LANE_PATHS"), SHARED_PATHS: envFrom("SHARED_PATHS"),
        CHECKOUT_ATTRIBUTES: envFrom("CHECKOUT_ATTRIBUTES"), FORMAL_BUILD_INPUT: envFrom("FORMAL_BUILD_INPUT"),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8").slice("lanes=".length)), {
      policy: true,
      swift: expectedSwift,
      formal: expectedFormal,
    });
  };
  plan(base, docs, false);
  plan(docs, modelChange, false, true);
  plan(modelChange, packageChange, true);
  plan(packageChange, rename, true);
  plan(rename, common, true, true);
  plan(common, buildInput, false, true);
  plan(buildInput, common, false, true);
  plan(buildInput, shellInput, true, true);
  plan(shellInput, buildInput, true, true);
  plan(shellInput, rootAttributes, true, true);
  plan(rootAttributes, nestedAttributes, true, true);
  plan(nestedAttributes, rootAttributes, true, true);
  plan(nestedAttributes, large, true);
  for (const lane of describeCiLanes(lanes).filter(({ scoped }) => scoped)) {
    assert.equal(lane.inputsChanged([".gitattributes"]), true, lane.name);
    assert.equal(lane.inputsChanged(["packages/.gitattributes"]), true, lane.name);
    assert.equal(lane.inputsChanged(["docs/.gitattributes.md"]), false, lane.name);
  }
  plan(common, common, true, true);
  plan("", docs, true, true);
  plan("0".repeat(40), docs, true, true);
  const wrongCheckout = spawnSync("bash", ["-c", planner], {
    cwd: root, encoding: "utf8", env: { ...process.env, HEAD_SHA: base },
  });
  assert.equal(wrongCheckout.status, 1);
  assert.match(wrongCheckout.stdout, /did not check out the candidate SHA/u);
});

test("required CI fails when scheduled verification is skipped, fails or reports another SHA", (t) => {
  if (!requireJq(t)) return;
  const script = shellScript(renderPublicCi(parse(formalConfig).lanes), 2);
  const sha = "a".repeat(40);
  const checked = { result: "success", outputs: { verified_sha: sha } };
  const check = (plan, overrides = {}) => spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      HEAD_SHA: sha,
      FIXED_PLAN: "",
      NEEDS: JSON.stringify({
        scope: { result: "success", outputs: { lanes: JSON.stringify(plan) } },
        policy: checked,
        swift: { result: "skipped" },
        formal: { result: "skipped" },
        ...overrides,
      }),
    },
  });
  const scoped = { policy: true, swift: false, formal: false };
  const full = { policy: true, swift: true, formal: true };
  assert.equal(check(scoped).status, 0);
  assert.equal(check(full, { swift: checked, formal: checked }).status, 0);
  const failedProof = check({ ...scoped, formal: true }, { formal: { result: "failure" } });
  assert.equal(failedProof.status, 1);
  assert.match(failedProof.stderr, /formal expected success, got failure/u);
  const skippedProof = check({ ...scoped, formal: true });
  assert.equal(skippedProof.status, 1);
  assert.match(skippedProof.stderr, /formal expected success, got skipped/u);
  const fixedWorkflow = renderPublicCi(parse((config) => { delete config.lanes.swift.paths; }).lanes);
  const fixed = spawnSync("bash", ["-c", shellScript(fixedWorkflow, 1)], {
    encoding: "utf8",
    env: {
      ...process.env,
      HEAD_SHA: sha,
      FIXED_PLAN: JSON.stringify({ policy: true, swift: true }),
      NEEDS: JSON.stringify({ policy: checked, swift: checked }),
    },
  });
  assert.equal(fixed.status, 0, fixed.stderr);
  for (const [plan, states] of [
    [full, {}],
    [full, { swift: { result: "success" } }],
    [full, { swift: { result: "success", outputs: { verified_sha: "b".repeat(40) } } }],
    [full, { swift: { result: "cancelled" } }],
    [scoped, { policy: { result: "failure" } }],
    [scoped, { scope: { result: "skipped" } }],
    [scoped, { swift: checked }],
    [{ policy: true }, {}],
    [{ policy: false, swift: false }, {}],
    [{ policy: true, swift: "false" }, {}],
  ]) {
    const result = check(plan, states);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /required CI lane failed/u);
  }
});

test("merge-queue repositories drop the duplicate push run and validate the setting", () => {
  const queued = parse((config) => { config.mergeQueue = true; });
  assert.equal(queued.mergeQueue, true);
  const workflow = renderPublicCi(queued.lanes, { mergeQueue: true });
  assert.doesNotMatch(workflow, /\n {2}push:/u);
  assert.match(workflow, /\n {2}pull_request:\n {4}branches: \[main\]\n {2}merge_group:\n/u);
  assert.match(renderPublicCi(parse().lanes), /\n {2}push:\n {4}branches: \[main\]\n {2}merge_group:\n/u);
  assert.equal(parse().mergeQueue, false);
  for (const value of ["true", 1, null]) {
    assert.throws(() => parse((config) => { config.mergeQueue = value; }), /mergeQueue must be true or false/u);
  }
});

test("the shared plan covers workflow and script directories while keeping metadata scoped", () => {
  const workflow = renderPublicCi(parse().lanes);
  const shared = JSON.parse(/^ +SHARED_PATHS: '([^']+)'$/mu.exec(workflow)[1]);
  for (const path of [PUBLIC_CI_CONFIG, ".github/workflows/", ".github/actions/", ".github/scripts/", "scripts/"]) {
    assert.ok(shared.includes(path), path);
  }
  assert.ok(!shared.includes(".github/"));
});

test("planner diffs a pull request against its test merge's first parent", (t) => {
  if (!requireJq(t)) return;
  const root = mkdtempSync(join(tmpdir(), "reallyme-ci-pr-base-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "user.name=ReallyMe Test", "-c", "user.email=test@really.me", ...args], {
      cwd: root, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "--quiet", "--initial-branch=main");
  mkdirSync(join(root, "packages/swift"), { recursive: true });
  mkdirSync(join(root, ".github/ISSUE_TEMPLATE"), { recursive: true });
  writeFileSync(join(root, "packages/swift/Library.swift"), "old");
  writeFileSync(join(root, "README.md"), "one");
  git("add", "-A");
  git("commit", "--quiet", "-m", "Base");
  const stale = git("rev-parse", "HEAD");
  git("checkout", "--quiet", "-b", "feature");
  writeFileSync(join(root, ".github/ISSUE_TEMPLATE/bug.yml"), "name: Bug");
  git("add", "-A");
  git("commit", "--quiet", "-m", "Issue template");
  git("checkout", "--quiet", "main");
  // Main moves on with a Swift change after the PR branched.
  writeFileSync(join(root, "packages/swift/Library.swift"), "new");
  git("add", "-A");
  git("commit", "--quiet", "-m", "Swift change on main");
  git("merge", "--quiet", "--no-ff", "--no-edit", "feature");
  const merge = git("rev-parse", "HEAD");
  const output = join(root, ".git", "output");
  const workflow = renderPublicCi(parse().lanes);
  const envFrom = (key) => new RegExp(`^ +${key}: '([^']+)'$`, "mu").exec(workflow)[1];
  const plan = (env) => {
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", shellScript(workflow, 1)], {
      cwd: root, encoding: "utf8",
      env: {
        ...process.env, HEAD_SHA: merge, GITHUB_OUTPUT: output,
        LANE_PATHS: envFrom("LANE_PATHS"), SHARED_PATHS: envFrom("SHARED_PATHS"),
        CHECKOUT_ATTRIBUTES: envFrom("CHECKOUT_ATTRIBUTES"), FORMAL_BUILD_INPUT: envFrom("FORMAL_BUILD_INPUT"),
        ...env,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(output, "utf8").slice("lanes=".length));
  };
  // The PR only adds an issue template, which no scoped lane depends on.
  assert.deepEqual(plan({ EVENT_NAME: "pull_request", BASE_SHA: stale }), { policy: true, swift: false });
  // A push diff from the old base also sees main's Swift change.
  assert.deepEqual(plan({ EVENT_NAME: "push", BASE_SHA: stale }), { policy: true, swift: true });
});
