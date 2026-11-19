// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createReleaseReadinessContext } from "../core.mjs";
import { checkDependencyMaintenance, readDependencyExceptions, reviewDependencyVersions } from "../scripts/dependency-maintenance.mjs";
import { compareVersions, createVersionLookup, DependencyMaintenanceError, selectStableAction, selectStableCrate,
  workflowDependencies } from "../scripts/dependency-versions.mjs";

const firstSha = "a".repeat(40);
const secondSha = "b".repeat(40);
const registry = "registry+https://github.com/rust-lang/crates.io-index";
const policyPath = ".github/dependency-maintenance.json";
const auditSettings = { severity: null, target_arch: [], target_os: [], ignore: [], informational_warnings: ["unmaintained", "unsound", "notice"] };
const errorCode = (code) => (error) => error instanceof DependencyMaintenanceError && error.code === code;
const hold = (overrides = {}) => ({ kind: "crate", path: "Cargo.lock", name: "example", current: "1.0.0", latest: "2.0.0",
  reason: "The upstream adapter still requires the previous API.", expires: "2099-12-31", ...overrides });

function fixture(t, { rust = true, fuzz = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "reallyme-dependencies-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const trackedFiles = new Set();
  const write = (path, contents = "") => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
    trackedFiles.add(path);
  };
  const metadata = new Map();
  const workspace = (prefix, members) => {
    const path = prefix.length === 0 ? "Cargo.toml" : `${prefix}/Cargo.toml`;
    const lock = prefix.length === 0 ? "Cargo.lock" : `${prefix}/Cargo.lock`;
    write(path, "[workspace]\n");
    write(lock, "version = 4\n");
    const packages = members.map((name) => {
      const manifest = `${prefix.length === 0 ? "" : `${prefix}/`}${name}/Cargo.toml`;
      write(manifest, `[package]\nname = "${name}"\n`);
      return { id: name, name, version: "0.1.0", manifest_path: join(root, manifest), source: null,
        dependencies: [{ name: "example", req: "^1.0.0", source: registry }] };
    });
    packages.push({ id: "example", name: "example", version: "1.0.0", source: registry });
    const value = { workspace_root: dirname(join(root, path)), workspace_members: members, packages };
    metadata.set(path, value);
    for (const pkg of packages.filter((pkg) => pkg.source === null)) {
      metadata.set(pkg.manifest_path.slice(root.length + 1), value);
    }
  };
  if (rust) workspace("", ["first", "second"]);
  if (fuzz) workspace("fuzz", ["harness"]);
  const context = createReleaseReadinessContext({ scriptUrl: pathToFileURL(join(root, "scripts/check_release_readiness.mjs")).href });
  const commands = [];
  const run = (command, args, options) => {
    commands.push({ command, args, options });
    if (command !== "cargo") assert.fail("Only injected Cargo commands are expected");
    if (args[0] === "metadata") return { stdout: JSON.stringify(metadata.get(args.at(-1))) };
    if (args[0] === "audit") return { stdout: JSON.stringify({ settings: auditSettings, vulnerabilities: { found: false, list: [] }, warnings: {} }) };
    return { stdout: "{}" };
  };
  const lookups = [];
  const lookup = async (kind, name) => { lookups.push([kind, name]); return { version: "1.0.0", sha: firstSha }; };
  const check = (options = {}) => checkDependencyMaintenance({ context, trackedFiles, root, run, lookup, ...options });
  return { root, context, trackedFiles, write, metadata, commands, lookups, check, run };
}

test("stable release selection excludes prereleases and yanks and peels annotated tags", () => {
  assert.equal(selectStableCrate({ versions: [
    { num: "0.20.2", yanked: false }, { num: "0.21.0", yanked: false },
    { num: "0.22.0", yanked: true }, { num: "1.0.0-rc.1", yanked: false },
  ] }), "0.21.0");
  assert.deepEqual(selectStableAction([
    `${firstSha}\trefs/tags/v9.0.0`, `${firstSha}\trefs/tags/v10.0.0`,
    `${secondSha}\trefs/tags/v10.0.0^{}`, `${firstSha}\trefs/tags/v11.0.0-beta.1`,
  ].join("\n")), { version: "10.0.0", sha: secondSha });
  assert.equal(compareVersions("100000000000000000000.0.0", "9.0.0"), 1);
  assert.equal(selectStableCrate({ versions: [{ num: "2.0.16+zstd.1.5.7", yanked: false }] }), "2.0.16+zstd.1.5.7");
  assert.equal(compareVersions("2.0.16+zstd.1.5.7", "2.0.16"), 0);
  for (const value of [null, {}, { versions: [] }, { versions: [{ num: "1.0.0" }] }]) {
    assert.throws(() => selectStableCrate(value), errorCode("INVALID_CRATE_REGISTRY_RESPONSE"));
  }
  assert.throws(() => selectStableCrate({ versions: [{ num: "1.0.0-rc.1", yanked: false }] }), errorCode("NO_STABLE_CRATE_RELEASE"));
  assert.throws(() => selectStableAction(`${firstSha}\trefs/tags/v1`), errorCode("NO_STABLE_ACTION_RELEASE"));
  assert.throws(() => selectStableAction(`${firstSha}\trefs/tags/v1.0.0\n${secondSha}\trefs/tags/1.0.0`), errorCode("AMBIGUOUS_ACTION_RELEASE"));
  assert.throws(() => compareVersions("1.0", "1.0.0"), errorCode("INVALID_STABLE_VERSION"));
});

test("registry requests are bounded, validated and deduplicated without an offline success path", async () => {
  let requests = 0;
  const calls = [];
  const lookup = createVersionLookup((...args) => {
    calls.push(args);
    return { stdout: `${firstSha}\trefs/tags/v3.2.0\n` };
  }, { fetchRegistry: async () => {
    requests += 1;
    return new Response(JSON.stringify({ versions: [{ num: "0.21.0", yanked: false }, { num: "0.20.1", yanked: true }] }));
  } });
  const values = await Promise.all([lookup("crate", "cargo-deny"), lookup("crate", "cargo-deny")]);
  assert.equal(requests, 1);
  assert.deepEqual(values[0], { version: "0.21.0", yanked: ["0.20.1"] });
  assert.equal((await lookup("action", "owner/project")).version, "3.2.0");
  assert.deepEqual(calls, [["git", ["ls-remote", "--tags", "https://github.com/owner/project.git"]]]);
  await assert.rejects(() => lookup("crate", "../../escape"), errorCode("INVALID_DEPENDENCY_NAME"));
  await assert.rejects(() => lookup("other", "owner/project"), errorCode("INVALID_DEPENDENCY_KIND"));
  const unavailable = createVersionLookup(() => ({}), { fetchRegistry: async () => new Response("unavailable", { status: 503 }) });
  await assert.rejects(() => unavailable("crate", "example"), errorCode("CRATE_REGISTRY_UNAVAILABLE"));
  const invalid = createVersionLookup(() => ({}), { fetchRegistry: async () => new Response("{invalid") });
  await assert.rejects(() => invalid("crate", "example"), errorCode("CRATE_REGISTRY_UNAVAILABLE"));
});

test("all workspace members and separate fuzz lockfiles are reviewed once without rebuilding", async (t) => {
  const { check, commands, lookups, root } = fixture(t, { fuzz: true });
  const original = readFileSync(join(root, "Cargo.lock"));
  const report = await check();
  assert.deepEqual(report.workspaces, ["Cargo.toml", "fuzz/Cargo.toml"]);
  assert.deepEqual(report.updates, []);
  assert.equal(report.checked, 1);
  assert.deepEqual(lookups, [["crate", "example"]]);
  for (const operation of ["metadata", "audit", "update", "outdated"]) {
    assert.equal(commands.filter(({ args }) => args[0] === operation).length, 2);
  }
  assert(commands.filter(({ args }) => args[0] === "metadata").every(({ args }) => args.includes("--all-features") && args.includes("--locked")));
  assert(commands.filter(({ args }) => args[0] === "update").every(({ args }) => args.includes("--dry-run")));
  assert(!commands.some(({ args }) => ["fmt", "clippy", "test"].includes(args[0])));
  assert.deepEqual(readFileSync(join(root, "Cargo.lock")), original);
});

test("local validation runs fmt, strict Clippy and tests in each workspace", async (t) => {
  const { check, commands, root } = fixture(t, { fuzz: true });
  await check({ validate: true });
  for (const cwd of [root, join(root, "fuzz")]) {
    assert.deepEqual(commands.filter((entry) => entry.options?.cwd === cwd).map(({ args }) => args), [
      ["fmt", "--all", "--check"],
      ["clippy", "--locked", "--workspace", "--all-targets", "--all-features", "--", "-D", "warnings"],
      ["test", "--locked", "--workspace", "--all-features"],
    ]);
  }
});

test("synchronous action checks finish before any timed registry request starts", async (t) => {
  const { check, write } = fixture(t);
  write(".github/workflows/checks.yml", `on: push\njobs:\n  code:\n    steps:\n      - uses: actions/checkout@${firstSha}\n`);
  const lookups = [];
  await check({ lookup: async (kind, name) => {
    lookups.push([kind, name]);
    return { version: "1.0.0", sha: firstSha };
  } });
  assert.deepEqual(lookups, [["action", "actions/checkout"], ["crate", "example"]]);
});

test("major, transitive and stale manifest lower bounds are reported with their owning paths", async (t) => {
  const { check, metadata } = fixture(t);
  metadata.get("Cargo.toml").packages.push({ id: "transitive", name: "transitive", version: "0.5.0", source: registry });
  const result = await check({ lookup: async () => ({ version: "2.0.0" }) });
  assert.deepEqual(result.updates.map(({ kind, path, name }) => [kind, path, name]), [
    ["requirement", "first/Cargo.toml", "example"], ["requirement", "second/Cargo.toml", "example"],
    ["crate", "Cargo.lock", "example"], ["crate", "Cargo.lock", "transitive"],
  ]);
});

test("dependency holds must match the exact dependency and upstream version and never cover yanks", () => {
  const dependency = { kind: "crate", path: "Cargo.lock", name: "example", current: "1.0.0" };
  const latest = new Map([["crate:example", { version: "2.0.0" }]]);
  assert.equal(reviewDependencyVersions([dependency], latest, []).updates.length, 1);
  const allowed = reviewDependencyVersions([dependency], latest, [hold()]);
  assert.equal(allowed.updates.length, 0);
  assert.equal(allowed.held[0].expires, "2099-12-31");
  for (const exception of [hold({ current: "0.9.0" }), hold({ latest: "1.9.0" }), hold({ path: "fuzz/Cargo.lock" })]) {
    assert.throws(() => reviewDependencyVersions([dependency], latest, [exception]), errorCode("UNUSED_DEPENDENCY_EXCEPTION"));
  }
  assert.throws(() => reviewDependencyVersions([dependency], new Map([["crate:example", { version: "2.0.0", yanked: ["1.0.0"] }]]), [hold()]), errorCode("YANKED_CARGO_DEPENDENCY"));
});

test("exception schema rejects broad, expired, duplicate, untracked and malformed overrides", (t) => {
  const { context, trackedFiles, write } = fixture(t);
  const configured = (value) => { write(policyPath, JSON.stringify(value)); return () => readDependencyExceptions(context, trackedFiles, "2026-11-19"); };
  assert.equal(configured({ schema: 1, exceptions: [hold()] })().length, 1);
  for (const [value, code] of [
    [{ schema: 1, skip: true, exceptions: [] }, "INVALID_DEPENDENCY_POLICY"],
    [{ schema: 1, exceptions: [hold({ expires: "2026-11-18" })] }, "EXPIRED_DEPENDENCY_EXCEPTION"],
    [{ schema: 1, exceptions: [hold({ expires: "2026-02-30" })] }, "INVALID_DEPENDENCY_EXCEPTION"],
    [{ schema: 1, exceptions: [hold({ reason: "because" })] }, "INVALID_DEPENDENCY_EXCEPTION"],
    [{ schema: 1, exceptions: [hold({ path: "../Cargo.lock" })] }, "INVALID_DEPENDENCY_EXCEPTION"],
    [{ schema: 1, exceptions: [hold({ path: "missing/Cargo.lock" })] }, "INVALID_DEPENDENCY_EXCEPTION"],
    [{ schema: 1, exceptions: [hold({ kind: "security" })] }, "INVALID_DEPENDENCY_EXCEPTION"],
    [{ schema: 1, exceptions: [hold(), hold()] }, "DUPLICATE_DEPENDENCY_EXCEPTION"],
  ]) assert.throws(configured(value), errorCode(code));
});

test("audit failures and ignored vulnerabilities cannot be waived by version holds", async (t) => {
  const { check, run, write } = fixture(t);
  write(policyPath, JSON.stringify({ schema: 1, exceptions: [hold()] }));
  for (const audit of [
    { vulnerabilities: { found: true, list: [{ advisory: {} }] } },
    { settings: { ignore: ["RUSTSEC-0000-0000"] }, vulnerabilities: { found: false, list: [] } },
    {},
    { settings: { ...auditSettings, severity: "critical" }, vulnerabilities: { found: false, list: [] }, warnings: {} },
    { settings: { ...auditSettings, target_os: ["linux"] }, vulnerabilities: { found: false, list: [] }, warnings: {} },
    { settings: auditSettings, vulnerabilities: { found: false, list: [] }, warnings: { unsound: [{}] } },
  ]) {
    await assert.rejects(() => check({ lookup: async () => ({ version: "2.0.0" }),
      run: (command, args, options) => args[0] === "audit" ? { stdout: JSON.stringify(audit) } : run(command, args, options),
    }), errorCode("SECURITY_AUDIT_FAILED"));
  }
});

test("mutation, missing lockfiles, unreviewed lockfiles and unsupported sources fail closed", async (t) => {
  const { check, run, write, metadata, trackedFiles } = fixture(t);
  await assert.rejects(() => check({ run: (command, args, options) => {
    if (args[0] === "update") write("Cargo.lock", "changed\n");
    return run(command, args, options);
  } }), errorCode("DEPENDENCY_CHECK_CHANGED_LOCKFILE"));
  write("Cargo.lock", "version = 4\n");
  metadata.get("Cargo.toml").packages.at(-1).source = "git+https://example.com/repository";
  await assert.rejects(() => check(), errorCode("UNSUPPORTED_CARGO_SOURCE"));
  metadata.get("Cargo.toml").packages.at(-1).source = registry;
  trackedFiles.delete("Cargo.lock");
  await assert.rejects(() => check(), errorCode("UNTRACKED_CARGO_INPUT"));
  write("Cargo.lock"); write("unused/Cargo.lock");
  await assert.rejects(() => check(), errorCode("UNREVIEWED_CARGO_LOCKFILE"));
});

test("workflow actions, sub-actions, pinned Rust tools, Buffa and Buf participate in freshness checks", async (t) => {
  const { context, write, check } = fixture(t, { rust: false });
  const path = ".github/workflows/checks.yml";
  write(path, `on: push
env:
  BUFFA_VERSION: "0.1.2"
  BUF_VERSION: "1.72.0"
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - name: Cache
        uses: actions/cache/restore@${firstSha}
      - name: Install audit
        uses: taiki-e/install-action@${firstSha}
        with:
          tool: cargo-deny@0.21.0
          fallback: none
      - name: Install generator
        run: cargo install reallyme-protoc-gen-buffa --version "=$BUFFA_VERSION" --locked
`);
  const values = workflowDependencies(context, path);
  assert(values.some((entry) => entry.name === "cargo-deny" && entry.current === "0.21.0"));
  assert(values.some((entry) => entry.name === "bufbuild/buf" && entry.kind === "action-version"));
  assert(values.some((entry) => entry.name === "reallyme-buffa"));
  const result = await check({ lookup: async () => ({ version: "2.0.0", sha: secondSha }) });
  assert.equal(result.workspaces.length, 0);
  assert(result.updates.some((entry) => entry.name === "actions/cache"));
  assert(result.updates.some((entry) => entry.name === "cargo-deny"));
});

test("unversioned tools and mutable actions cannot silently escape the inventory", (t) => {
  const { context, write } = fixture(t, { rust: false });
  for (const [step, code] of [
    ["uses: actions/checkout@v7", "UNPINNED_WORKFLOW_ACTION"],
    ["run: cargo install cargo-deny --locked", "UNPINNED_WORKFLOW_TOOL"],
    ["run: cargo install cargo-deny --version latest --locked", "UNPINNED_WORKFLOW_TOOL"],
  ]) {
    const path = ".github/workflows/checks.yml";
    write(path, `on: push\njobs:\n  check:\n    steps:\n      - name: Install\n        ${step}\n`);
    assert.throws(() => workflowDependencies(context, path), errorCode(code));
  }
});

test("dependency inventory includes unnamed steps and steps whose first field is id", (t) => {
  const { context, write } = fixture(t, { rust: false });
  const path = ".github/workflows/tools.yml";
  write(path, `on: push
jobs:
  tools:
    steps:
      - uses: taiki-e/install-action@${firstSha}
        with:
          tool: cargo-audit@0.23.0
      - run: cargo install cargo-deny --version="=0.21.0" --locked
      - id: install
        run: |
          cargo install cargo-outdated --version '=0.19.0' --locked
`);
  assert.deepEqual(workflowDependencies(context, path).map(({ name }) => name), [
    "taiki-e/install-action", "cargo-audit", "cargo-deny", "cargo-outdated",
  ]);
  for (const step of ["uses: actions/checkout@main", "run: cargo install cargo-deny --locked"]) {
    write(path, `on: push\njobs:\n  tools:\n    steps:\n      - ${step}\n`);
    assert.throws(() => workflowDependencies(context, path), (error) => error instanceof DependencyMaintenanceError);
  }
});

test("unsupported step mappings fail rather than omitting dependencies", (t) => {
  const { context, write } = fixture(t, { rust: false });
  const path = ".github/workflows/tools.yml";
  for (const body of [
    `steps: [{ uses: actions/checkout@${firstSha} }]`,
    `steps:\n      - 'uses': actions/checkout@${firstSha}`,
    `steps:\n      - id: checkout\n        'uses': actions/checkout@${firstSha}`,
    `steps:\n      - *aliased-step`,
  ]) {
    write(path, `on: push\njobs:\n  tools:\n    ${body}\n`);
    assert.throws(() => workflowDependencies(context, path), errorCode("UNSUPPORTED_WORKFLOW_STEPS"));
  }
});

test("pinned GitHub sources, tool revisions and reusable workflows share stable-tag checks", async (t) => {
  const { check, metadata, write, context } = fixture(t);
  const source = `git+https://github.com/example/library?rev=${firstSha}#${firstSha}`;
  metadata.get("Cargo.toml").packages.at(-1).source = source;
  for (const pkg of metadata.get("Cargo.toml").packages.filter((pkg) => pkg.source === null)) {
    pkg.dependencies[0].source = source;
  }
  const path = ".github/workflows/tools.yml";
  write(path, `on: push
jobs:
  reusable:
    uses: example/workflows/.github/workflows/check.yml@${firstSha}
  tools:
    steps:
      - name: Install
        run: cargo install --git https://github.com/example/tool --rev ${firstSha} --locked cargo-tool
`);
  const values = workflowDependencies(context, path);
  assert(values.some((entry) => entry.kind === "action" && entry.name === "example/workflows"));
  assert(values.some((entry) => entry.kind === "git" && entry.name === "example/tool"));
  const result = await check({ lookup: async () => ({ version: "1.0.0", sha: firstSha }) });
  assert.deepEqual(result.updates, []);
});

test("tool inventory supports native flag order, continuations, comments and tracked local tools", (t) => {
  const { context, write, trackedFiles } = fixture(t);
  const path = ".github/workflows/tools.yml";
  for (const command of [
    "cargo install --locked --version '=0.21.0' cargo-deny # stable pin",
    "cargo +1.100.0 install --force cargo-deny --locked --version=0.21.0",
    'cargo install cargo-deny --locked --version="=0.21.0" --features="json zeroize"',
    "cargo install cargo-deny --locked --version='0.21.0' --features json --features zeroize",
    ["cargo install cargo-deny \\", "          --version \"0.21.0\" --locked"].join("\n"),
  ]) {
    write(path, `on: push\njobs:\n  install:\n    steps:\n      - name: Install\n        run: |\n          ${command}\n`);
    assert(workflowDependencies(context, path).some((entry) => entry.name === "cargo-deny" && entry.current === "0.21.0"));
  }
  write(path, "on: push\njobs:\n  install:\n    steps:\n      - name: Local tool\n        run: cargo install --locked --path first\n");
  assert.deepEqual(workflowDependencies(context, path, { trackedFiles }), []);
  trackedFiles.delete("first/Cargo.toml");
  assert.throws(() => workflowDependencies(context, path, { trackedFiles }), errorCode("UNPINNED_WORKFLOW_TOOL"));
});

test("tool inventory rejects shell evaluation and ambiguous version options", (t) => {
  const { context, write } = fixture(t, { rust: false });
  const path = ".github/workflows/tools.yml";
  for (const command of [
    'cargo install cargo-deny --locked --version="$(printf 0.21.0)"',
    'cargo install cargo-deny --locked --version="`printf 0.21.0`"',
    'cargo install cargo-deny --locked --version="0.21.0"; another-command',
    'cargo install cargo-deny --locked --version="0.21.0',
    "cargo install cargo-deny --locked --version 0.20.2 --version 0.21.0",
  ]) {
    write(path, `on: push\njobs:\n  install:\n    steps:\n      - name: Install\n        run: |\n          ${command}\n`);
    assert.throws(() => workflowDependencies(context, path), errorCode("UNPINNED_WORKFLOW_TOOL"));
  }
});

test("informational maintenance notices are reported and cannot be hidden by audit filters", async (t) => {
  const { check, run } = fixture(t);
  const warning = { advisory: { id: "RUSTSEC-2026-0001" }, package: { name: "example", version: "1.0.0" } };
  const report = await check({ run: (command, args, options) => args[0] === "audit" ? {
    stdout: JSON.stringify({ settings: auditSettings, vulnerabilities: { found: false, list: [] }, warnings: { unmaintained: [warning] } }),
  } : run(command, args, options) });
  assert.deepEqual(report.notices, [{ path: "Cargo.lock", kind: "unmaintained", id: "RUSTSEC-2026-0001", name: "example", version: "1.0.0" }]);
});
