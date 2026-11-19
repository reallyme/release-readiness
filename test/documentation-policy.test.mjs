// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertDocumentationArtifactPaths, assertDocumentationPolicy, DOCUMENTATION_POLICY, DocumentationPolicyError } from "../scripts/documentation-policy.mjs";
import { checkNpmPublication, checkPublication, installPrivacyHooks, LOCAL_ONLY_RULES } from "../scripts/repository-privacy.mjs";

const cli = fileURLToPath(new URL("../scripts/documentation-policy.mjs", import.meta.url));
const code = (expected) => (error) => error instanceof DocumentationPolicyError && error.code === expected;
const entry = (path, overrides = {}) => ({ path, kind: "reference", purpose: "Describe the supported public API and compatibility guarantees.", ...overrides });

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "reallyme-documentation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GITHUB_ACTIONS: "", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(root, "no-global-config") };
  for (const key of ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX"]) delete env[key];
  const run = (...args) => spawnSync("git", ["-c", "user.name=ReallyMe Test", "-c", "user.email=test@really.me", ...args], {
    cwd: root, env, encoding: "utf8", timeout: 15_000,
  });
  const git = (...args) => { const result = run(...args); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  const write = (path, contents) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), contents); };
  const policy = (...documents) => write(DOCUMENTATION_POLICY, JSON.stringify({ schema: 1, documents }));
  const check = (options = {}) => assertDocumentationPolicy({ root, env, ...options });
  git("init", "--quiet", "--initial-branch=main");
  write(".gitignore", `${LOCAL_ONLY_RULES.join("\n")}\ndist/\n`);
  git("add", ".gitignore");
  return { root, env, run, git, write, policy, check };
}

test("conventional public documents pass and custom guides need a concrete declared purpose", (t) => {
  const { write, check, policy } = fixture(t);
  for (const path of ["README.md", "packages/swift/README.md", "SECURITY.md", "CONTRIBUTING.md", "CHANGELOG.md", "LICENSE-MIT"]) {
    write(path, "# Public library\n\nSupported interfaces and usage.\n");
  }
  write("CMakeLists.txt", "project(example)\n");
  assert.equal(check(), 6);
  write("docs/api.md", "# Public API\n\nSupported operations.\n");
  assert.throws(check, code("PUBLIC_DOCUMENTATION_PURPOSE_REQUIRED"));
  policy(entry("docs/api.md"));
  assert.equal(check(), 7);
});

test("untracked, nested, dated and case-varied task artifacts are rejected", (t) => {
  const { write, check, root } = fixture(t);
  for (const path of ["docs/dependency-security.md", "nested/TASK_SUMMARY.md", "docs/2026-11-19-audit-report.md", "notes/handoff.txt"]) {
    write(path, "# Temporary findings\n");
    assert.throws(check, code("TRANSIENT_DOCUMENTATION_ARTIFACT"));
    rmSync(join(root, path));
  }
});

test("a guide declaration cannot relabel a task report or dependency security dump", (t) => {
  const { write, check, policy, root } = fixture(t);
  write("docs/dependency-security.md", "# Dependency security review\n");
  policy(entry("docs/dependency-security.md", { kind: "guide" }));
  assert.throws(check, code("TRANSIENT_DOCUMENTATION_ARTIFACT"));
  rmSync(join(root, "docs/dependency-security.md"));
  policy(entry("docs/overview.md"));
  for (const contents of [
    "# Dependency security review\n",
    "\uFEFF<!-- copyright -->\n\n# Task summary\n",
    "Review findings\n===============\n",
    "<h1>Implementation notes</h1>\n",
    "= Dependency security review\n",
    "---\ntitle: API reference\n---\n# Dependency security review\n",
    "---\ntitle: 'Task summary'\n---\n# Public API\n",
  ]) {
    write("docs/overview.md", contents);
    assert.throws(check, code("TRANSIENT_DOCUMENTATION_CONTENT"));
  }
});

test("normal guides, later audit sections and fenced report examples are preserved", (t) => {
  const { write, check, policy } = fixture(t);
  policy(entry("docs/api.md"));
  for (const contents of [
    "# Public API\n\n## Audit findings\nExplain how consumers read diagnostics.\n",
    "```md\n# Task summary\n```\n\n# Public API\n",
    "~~~md\n# Dependency security review\n~~~\n\n# Public API\n",
    "---\ntitle: API reference\n---\n# Public API\n",
    "<!-- SPDX notice -->\n# Public API\n\nUse the documented operations.\n",
  ]) { write("docs/api.md", contents); assert.equal(check(), 1); }
});

test("declarations reject wildcards, stale paths, duplicates, vague purposes and unknown roles", (t) => {
  const { write, policy, check } = fixture(t);
  write("docs/api.md", "# Public API\n");
  for (const [documents, expected] of [
    [[entry("docs/*.md")], "STALE_DOCUMENTATION_DECLARATION"],
    [[entry("../outside.md")], "INVALID_DOCUMENTATION_DECLARATION"],
    [[entry("docs/missing.md")], "STALE_DOCUMENTATION_DECLARATION"],
    [[entry("docs/api.md"), entry("docs/api.md")], "DUPLICATE_DOCUMENTATION_DECLARATION"],
    [[entry("docs/api.md", { purpose: "documentation" })], "INVALID_DOCUMENTATION_DECLARATION"],
    [[entry("docs/api.md", { kind: "task-report" })], "INVALID_DOCUMENTATION_DECLARATION"],
    [[entry("docs/api.md", { skip: true })], "INVALID_DOCUMENTATION_DECLARATION"],
  ]) { policy(...documents); assert.throws(check, code(expected)); }
  write(DOCUMENTATION_POLICY, "{invalid");
  assert.throws(check, code("INVALID_DOCUMENTATION_POLICY"));
  write(DOCUMENTATION_POLICY, JSON.stringify({ schema: 1, documents: [], skip: true }));
  assert.throws(check, code("INVALID_DOCUMENTATION_POLICY"));
});

test("malformed comment input preserves title checks without repeated delimiter scans", (t) => {
  const { write, check } = fixture(t);
  const malformed = "<!--".repeat(100_000);
  write("README.md", `# Public API\n\n${malformed}`);
  assert.equal(check(), 1);
  write("README.md", `# Task summary\n\n${malformed}`);
  assert.throws(check, code("TRANSIENT_DOCUMENTATION_CONTENT"));
});

test("Git-ignored local notes remain local and do not need public documentation declarations", (t) => {
  const { write, check } = fixture(t);
  write(".local/task-report.md", "# Task summary\n");
  write(".build/handoff-notes.md", "# Handoff notes\n");
  assert.equal(check(), 0);
});

test("commit checks read staged document and policy bytes rather than unstaged replacements", (t) => {
  const { write, policy, check, git } = fixture(t);
  write("docs/api.md", "# Public API\n");
  policy(entry("docs/api.md"));
  git("add", ".");
  write("docs/api.md", "# Task summary\n");
  assert.equal(check({ staged: true }), 1);
  assert.throws(check, code("TRANSIENT_DOCUMENTATION_CONTENT"));
  git("add", "docs/api.md");
  write("docs/api.md", "# Public API\n");
  assert.throws(() => check({ staged: true }), code("TRANSIENT_DOCUMENTATION_CONTENT"));
  git("add", "docs/api.md");
  policy();
  assert.equal(check({ staged: true }), 1);
  assert.throws(check, code("PUBLIC_DOCUMENTATION_PURPOSE_REQUIRED"));
});

test("partial commit indexes are respected and CI cannot inject an untracked approval policy", (t) => {
  const { root, env, write, check, policy, git } = fixture(t);
  write("README.md", "# Library\n");
  git("add", ".");
  const alternate = join(root, ".git/partial-index");
  copyFileSync(join(root, ".git/index"), alternate);
  write("task-summary.md", "# Task summary\n");
  git("add", "task-summary.md");
  assert.equal(check({ staged: true, env: { ...env, GIT_INDEX_FILE: alternate } }), 1);
  rmSync(join(root, "task-summary.md")); git("rm", "--cached", "task-summary.md");
  write("docs/api.md", "# Public API\n"); policy(entry("docs/api.md"));
  git("add", "docs/api.md");
  assert.throws(() => check({ env: { ...env, GITHUB_ACTIONS: "true" } }), code("DOCUMENTATION_POLICY_MUST_BE_TRACKED"));
  git("add", DOCUMENTATION_POLICY);
  assert.equal(check({ env: { ...env, GITHUB_ACTIONS: "true" } }), 2);
});

test("symlinks, invalid UTF-8 and oversized documents fail without leaking document bodies", (t) => {
  const { root, write, check, git } = fixture(t);
  write("data.bin", "private fixture content\n");
  symlinkSync(join(root, "data.bin"), join(root, "README.md"));
  assert.throws(check, code("DOCUMENTATION_MUST_BE_REGULAR"));
  git("add", "README.md");
  assert.throws(() => check({ staged: true }), code("DOCUMENTATION_MUST_BE_REGULAR"));
  rmSync(join(root, "README.md"));
  write("README.md", Buffer.from([0xff, 0xfe]));
  assert.throws(check, code("INVALID_DOCUMENTATION_ENCODING"));
  write("README.md", Buffer.alloc(4_194_305, 65));
  assert.throws(check, code("DOCUMENTATION_TOO_LARGE"));
});

test("the real installed pre-commit hook blocks force-added reports and renamed README reports", (t) => {
  const { root, env, write, git, run } = fixture(t);
  git("commit", "--quiet", "-m", "Public baseline");
  installPrivacyHooks({ root, env });
  write("task-report.md", "# Task summary\n"); git("add", "-f", "task-report.md");
  const report = run("commit", "--quiet", "-m", "Attempt report commit");
  assert.notEqual(report.status, 0); assert.match(report.stderr, /TRANSIENT_DOCUMENTATION_ARTIFACT/u);
  git("rm", "--cached", "task-report.md"); rmSync(join(root, "task-report.md"));
  write("README.md", "# Task summary\n"); git("add", "README.md");
  const renamed = run("commit", "--quiet", "-m", "Attempt renamed report commit");
  assert.notEqual(renamed.status, 0); assert.match(renamed.stderr, /TRANSIENT_DOCUMENTATION_CONTENT/u);
  assert.equal(git("log", "-1", "--format=%s"), "Public baseline");
});

test("the real pre-push hook rejects a report added then removed from an existing README", (t) => {
  const { root, env, write, git, run } = fixture(t);
  write("README.md", "# Library\n"); git("add", "README.md"); git("commit", "--quiet", "-m", "Public baseline");
  installPrivacyHooks({ root, env });
  write("README.md", "# Task summary\n"); git("add", "README.md");
  git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "Bypass local check");
  write("README.md", "# Library\n"); git("add", "README.md"); git("commit", "--quiet", "-m", "Restore public guide");
  const remote = join(root, ".git/test-remote.git"); git("init", "--bare", "--quiet", remote);
  const pushed = run("push", remote, "HEAD:refs/heads/main");
  assert.notEqual(pushed.status, 0); assert.match(pushed.stderr, /TRANSIENT_DOCUMENTATION_CONTENT/u);
  const refs = spawnSync("git", ["--git-dir", remote, "show-ref"], { env, encoding: "utf8" });
  assert.equal(refs.status, 1);
});

test("publication blocks report filenames even inside ignored generated npm and ZIP contents", (t) => {
  const { root, write, git } = fixture(t);
  write("package.json", JSON.stringify({ name: "documentation-fixture", version: "1.0.0", files: ["dist/"] }));
  write("dist/task-summary.md", "# Task summary\n"); git("add", "package.json");
  assert.throws(() => checkNpmPublication({ root }), code("TRANSIENT_DOCUMENTATION_ARTIFACT"));
  const archive = join(root, "publication.zip");
  const zip = spawnSync("python3", ["-c", "import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1], 'w') as archive: archive.writestr('package/task-report.md', '# Task summary')", archive], { encoding: "utf8" });
  assert.equal(zip.status, 0, zip.stderr);
  assert.throws(() => checkPublication({ root, artifact: archive }), code("TRANSIENT_DOCUMENTATION_ARTIFACT"));
  assert.doesNotThrow(() => assertDocumentationArtifactPaths(["README.md", "dist/api.js", "META-INF/LICENSE.txt"]));
  assert.throws(() => assertDocumentationArtifactPaths([null]), code("INVALID_DOCUMENTATION_PATH"));
});

test("publication checks opening titles in generated documents and nested archives", (t) => {
  const { root, write, git } = fixture(t);
  write("package.json", JSON.stringify({ name: "documentation-fixture", version: "1.0.0", files: ["dist/"] }));
  git("add", "package.json");
  write("dist/README.md", "# Task summary\n\nPrivate fixture body.\n");
  assert.throws(() => checkNpmPublication({ root }), code("TRANSIENT_DOCUMENTATION_CONTENT"));
  assert.throws(() => checkPublication({ root, artifact: "dist" }), code("TRANSIENT_DOCUMENTATION_CONTENT"));
  write("dist/README.md", "# Library API\n\nSupported operations.\n");
  assert.doesNotThrow(() => checkNpmPublication({ root }));
  assert.doesNotThrow(() => checkPublication({ root, artifact: "dist" }));
  const archive = join(root, "dist/publication.zip");
  const zip = spawnSync("python3", ["-c", `import io,sys,tarfile,zipfile
data=b'# Task summary\\nPrivate fixture body.\\n'
inner=io.BytesIO()
with tarfile.open(fileobj=inner, mode='w:gz') as archive:
    item=tarfile.TarInfo('package/README.md'); item.size=len(data)
    archive.addfile(item, io.BytesIO(data))
with zipfile.ZipFile(sys.argv[1], 'w') as archive:
    archive.writestr('package.tgz', inner.getvalue())`, archive], { encoding: "utf8" });
  assert.equal(zip.status, 0, zip.stderr);
  assert.throws(() => checkPublication({ root, artifact: archive }), code("TRANSIENT_DOCUMENTATION_CONTENT"));
  rmSync(archive);
  write("dist/README.md", Buffer.alloc(4_194_305, 65));
  assert.throws(() => checkNpmPublication({ root }), code("DOCUMENTATION_TOO_LARGE"));
  assert.throws(() => checkPublication({ root, artifact: "dist" }), (error) => error.code === "ARTIFACT_INSPECTION_FAILED");
});

test("standalone and symlinked CLI entry points reject reports with fixed codes and paths only", (t) => {
  const { root, env, write } = fixture(t);
  write("README.md", "# Task summary\n\nPrivate fixture body must stay out of diagnostics.\n");
  const link = join(root, "documentation-check"); symlinkSync(cli, link);
  for (const path of [cli, link]) {
    const result = spawnSync(process.execPath, [path], { cwd: root, env, encoding: "utf8" });
    assert.equal(result.status, 1); assert.match(result.stderr, /TRANSIENT_DOCUMENTATION_CONTENT/u);
    assert.doesNotMatch(result.stderr, /Private fixture body/u);
  }
  const unsupported = spawnSync(process.execPath, [cli, "--skip"], { cwd: root, env, encoding: "utf8" });
  assert.equal(unsupported.status, 1); assert.match(unsupported.stderr, /UNSUPPORTED_ARGUMENTS/u);
});
