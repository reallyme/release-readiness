#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDocumentationArtifactContent, assertDocumentationArtifactPaths, assertDocumentationPolicy,
  assertDocumentationPublicationFile, DocumentationPolicyError, isDocumentationPath, DOCUMENTATION_POLICY,
} from "./documentation-policy.mjs";

const MAX_OUTPUT = 16 * 1024 * 1024;
const MAX_IGNORE = 1024 * 1024;
const MAX_COMMITS = 10_000;
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
export const LOCAL_ONLY_RULES = Object.freeze(["AGENTS.md", ".claude/", ".codex/", ".local/", ".build/"]);
const localNames = new Set([...LOCAL_ONLY_RULES.map((rule) => rule.replace(/\/$/u, "").toLowerCase()), ".git"]);

export class RepositoryPrivacyError extends Error {
  constructor(code, paths = []) {
    super(code);
    this.name = "RepositoryPrivacyError";
    this.code = code;
    this.paths = Object.freeze([...paths]);
  }
}

function git(root, args, { env = process.env, input, limit = MAX_OUTPUT } = {}) {
  const result = spawnSync("git", ["-C", root, ...args], {
    env, input, encoding: null, maxBuffer: limit, timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new RepositoryPrivacyError("GIT_CHECK_FAILED");
  }
  return result.stdout;
}

function decode(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RepositoryPrivacyError("INVALID_PATH_ENCODING");
  }
}

function validPath(path) {
  return typeof path === "string" && path.length > 0 && !isAbsolute(path) &&
    !path.includes("\\") && !path.includes("\0") && !/^[A-Za-z]:/u.test(path) &&
    Buffer.from(path, "utf8").toString("utf8") === path &&
    path.replace(/\/$/u, "").split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function assertPaths(paths) {
  if (!Array.isArray(paths) || paths.length > 100_000 || paths.some((path) => !validPath(path))) {
    throw new RepositoryPrivacyError("INVALID_PUBLICATION_PATH");
  }
  const forbidden = paths.filter((path) => path.split("/").some((part) => localNames.has(part.toLowerCase())));
  if (forbidden.length > 0) throw new RepositoryPrivacyError("LOCAL_ONLY_PATH", forbidden);
}

function assertPublicationPrivacy(paths) {
  assertPaths(paths);
  assertDocumentationArtifactPaths(paths);
  const privatePaths = paths.filter((path) => path.split("/").some((part) =>
    part === ".secrets" || part === ".env" || (part.startsWith(".env.") && part !== ".env.example")));
  if (privatePaths.length > 0) throw new RepositoryPrivacyError("PRIVATE_PUBLICATION_PATH", privatePaths);
}

function indexEntries(root, env) {
  return decode(git(root, ["ls-files", "--stage", "-z"], { env })).split("\0").filter(Boolean).map((entry) => {
    const match = /^([0-7]{6}) ((?:[a-f0-9]{40}|[a-f0-9]{64})) ([0-3])\t([\s\S]+)$/u.exec(entry);
    if (match === null || match[3] !== "0" || !validPath(match[4])) {
      throw new RepositoryPrivacyError("INVALID_OR_UNMERGED_INDEX");
    }
    return { mode: match[1], oid: match[2], path: match[4] };
  });
}

// Evaluate staged rules in an isolated worktree. The real index remains read
// only, including an alternate index supplied by a partial-commit hook. Git's
// own matcher handles nested rules and negations without global/local excludes.
export function assertRepositoryPrivacy({ root = process.cwd(), revision, policyRevision, requireRules = true, env = process.env } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "reallyme-privacy-check-"));
  try {
    let selectedEnv = env;
    if (revision !== undefined) {
      if (!OBJECT_ID.test(revision)) throw new RepositoryPrivacyError("INVALID_REVISION");
      selectedEnv = { ...env, GIT_INDEX_FILE: join(scratch, "index") };
      git(root, ["read-tree", revision], { env: selectedEnv });
    }
    const entries = indexEntries(root, selectedEnv);
    assertPaths(entries.map(({ path }) => path));
    let ruleEntries = entries;
    if (policyRevision !== undefined) {
      if (!OBJECT_ID.test(policyRevision)) throw new RepositoryPrivacyError("INVALID_REVISION");
      const policyEnv = { ...env, GIT_INDEX_FILE: join(scratch, "policy-index") };
      git(root, ["read-tree", policyRevision], { env: policyEnv });
      ruleEntries = indexEntries(root, policyEnv);
    }
    const rulesRoot = join(scratch, "rules");
    mkdirSync(rulesRoot);
    let rootRules;
    for (const entry of ruleEntries.filter(({ path }) => path === ".gitignore" || path.endsWith("/.gitignore"))) {
      if (!["100644", "100755"].includes(entry.mode)) {
        throw new RepositoryPrivacyError("IGNORE_FILE_MUST_BE_REGULAR", [entry.path]);
      }
      const contents = git(root, ["cat-file", "blob", entry.oid], { env: selectedEnv, limit: MAX_IGNORE });
      if (entry.path === ".gitignore") rootRules = decode(contents).split(/\r?\n/u);
      const destination = resolve(rulesRoot, entry.path);
      if (!destination.startsWith(`${rulesRoot}${sep}`)) throw new RepositoryPrivacyError("INVALID_IGNORE_PATH");
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, contents, { flag: "wx", mode: 0o600 });
    }
    if (requireRules && (rootRules === undefined || LOCAL_ONLY_RULES.some((rule) => !rootRules.includes(rule)))) {
      throw new RepositoryPrivacyError("MISSING_REPOSITORY_WIDE_LOCAL_RULES");
    }
    const args = [`--work-tree=${rulesRoot}`, "ls-files", "--cached", "--ignored", "--exclude-per-directory=.gitignore", "-z"];
    const ignored = decode(git(root, args, { env: selectedEnv })).split("\0").filter(Boolean);
    if (ignored.length > 0) throw new RepositoryPrivacyError("TRACKED_IGNORED_FILES", ignored);
    return Object.freeze({ trackedFiles: entries.length });
  } finally {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      throw new RepositoryPrivacyError("CHECK_CLEANUP_FAILED");
    }
  }
}

export function assertPushPrivacy({ root = process.cwd(), updates, env = process.env } = {}) {
  const commits = new Map();
  const trees = new Map();
  const checked = new Set();
  const documentationChecked = new Set();
  const fingerprint = (revision) => {
    if (trees.has(revision)) return trees.get(revision);
    const names = createHash("sha256");
    const rules = createHash("sha256");
    const documentation = createHash("sha256");
    for (const record of decode(git(root, ["ls-tree", "-r", "--full-tree", "-z", revision], { env })).split("\0").filter(Boolean)) {
      const entry = /^([0-7]{6}) (?:blob|commit) ((?:[a-f0-9]{40}|[a-f0-9]{64}))\t([\s\S]+)$/u.exec(record);
      if (entry === null) throw new RepositoryPrivacyError("INVALID_OR_UNMERGED_INDEX");
      names.update(`${entry[1]}\0${entry[3]}\0`);
      if (entry[3] === ".gitignore" || entry[3].endsWith("/.gitignore")) rules.update(record).update("\0");
      if (isDocumentationPath(entry[3]) || entry[3] === DOCUMENTATION_POLICY) documentation.update(record).update("\0");
    }
    const value = { names: names.digest("hex"), rules: rules.digest("hex"), documentation: documentation.digest("hex") };
    trees.set(revision, value);
    return value;
  };
  const checkDocumentation = (revision, requirePurposes) => {
    const key = `${fingerprint(revision).documentation}:${requirePurposes}`;
    if (documentationChecked.has(key)) return;
    assertDocumentationPolicy({ root, revision, requirePurposes, env });
    documentationChecked.add(key);
  };
  const check = (revision, policyRevision, requireRules = true) => {
    const source = fingerprint(revision);
    const policy = fingerprint(policyRevision ?? revision);
    const key = `${source.names}:${policy.rules}:${requireRules}`;
    // Source tracking depends on paths, modes and ignore blobs, not ordinary
    // source-file bytes. Reuse that exact proof within this one push so a tag
    // does not repeat it for every version-only commit in the same history.
    if (checked.has(key)) return;
    assertRepositoryPrivacy({ root, revision, policyRevision, requireRules, env });
    checked.add(key);
  };
  if (typeof updates !== "string" || updates.length > MAX_OUTPUT) throw new RepositoryPrivacyError("INVALID_PUSH_UPDATES");
  for (const line of updates.split("\n").filter(Boolean)) {
    const fields = line.split(" ");
    if (fields.length !== 4 || !OBJECT_ID.test(fields[1]) || !OBJECT_ID.test(fields[3])) {
      throw new RepositoryPrivacyError("INVALID_PUSH_UPDATES");
    }
    const [, local, , remote] = fields;
    if (/^0+$/u.test(local)) continue;
    const candidate = decode(git(root, ["rev-parse", "--verify", `${local}^{commit}`], { env })).trim();
    // Check the tip as well as outgoing commits. A new tag or branch must not
    // make an old unsafe tree reachable again. Unknown remote baselines fail.
    check(candidate);
    checkDocumentation(candidate, true);
    const range = /^0+$/u.test(remote) ? [candidate] : [candidate, `^${remote}`];
    const outgoing = decode(git(root, ["rev-list", ...range, "--"], { env })).trim();
    for (const oid of outgoing.split("\n").filter(Boolean)) {
      if (!commits.has(oid)) commits.set(oid, new Set());
      commits.get(oid).add(candidate);
    }
    if (commits.size > MAX_COMMITS) throw new RepositoryPrivacyError("PUSH_REQUIRES_SEPARATE_HISTORY_AUDIT");
  }
  for (const [revision, policies] of commits) {
    // Old commits need not predate this policy's literal baseline, but their
    // contents must satisfy both their own ignores and the outgoing tip's rules.
    check(revision, undefined, false);
    checkDocumentation(revision, false);
    for (const policyRevision of policies) check(revision, policyRevision);
  }
  return commits.size;
}

function hookSource(script, mode) {
  const quoted = `'${script.replaceAll("'", "'\\''")}'`;
  return `#!/bin/sh\n# Check the exact staged tree or outgoing commits before Git sends them.\nexec node ${quoted} ${mode}\n`;
}

export function installPrivacyHooks({ root = process.cwd(), env = process.env } = {}) {
  const configured = spawnSync("git", ["-C", root, "config", "--get", "core.hooksPath"], { env, encoding: "utf8", timeout: 30_000 });
  if (configured.error !== undefined || ![0, 1].includes(configured.status)) throw new RepositoryPrivacyError("GIT_CHECK_FAILED");
  if (configured.status === 0) throw new RepositoryPrivacyError("EXISTING_HOOK_REQUIRES_INTEGRATION");
  const script = realpathSync(fileURLToPath(import.meta.url));
  const hooks = decode(git(root, ["rev-parse", "--git-path", "hooks"], { env })).trim();
  const directory = resolve(root, hooks);
  const definitions = [["pre-commit", "--staged"], ["pre-push", "--pre-push"]];
  // Do not silently replace an existing hook manager or a user's executable
  // hook. Refuse the whole installation before changing either entry point.
  for (const [name, mode] of definitions) {
    const path = join(directory, name);
    if (existsSync(path) && (lstatSync(path).isSymbolicLink() || readFileSync(path, "utf8") !== hookSource(script, mode))) {
      throw new RepositoryPrivacyError("EXISTING_HOOK_REQUIRES_INTEGRATION", [name]);
    }
  }
  mkdirSync(directory, { recursive: true });
  for (const [name, mode] of definitions) {
    const path = join(directory, name);
    if (!existsSync(path)) writeFileSync(path, hookSource(script, mode), { flag: "wx", mode: 0o755 });
    chmodSync(path, 0o755);
  }
}

export function checkPublication({ root = process.cwd(), artifact, stripComponents = 0 } = {}) {
  if (!Number.isSafeInteger(stripComponents) || stripComponents < 0 || stripComponents > 16) {
    throw new RepositoryPrivacyError("INVALID_STRIP_COMPONENTS");
  }
  if (typeof artifact !== "string" || artifact.length === 0 || artifact.includes("\0") || /[*?\[\]{}]/u.test(artifact)) {
    throw new RepositoryPrivacyError("PUBLICATION_REQUIRES_LITERAL_PATHS");
  }
  const artifacts = artifact.split(/\r?\n/u).map((path) => path.trim()).filter(Boolean);
  if (artifacts.length === 0 || artifacts.some((path) => path.startsWith("!"))) {
    throw new RepositoryPrivacyError("PUBLICATION_REQUIRES_LITERAL_PATHS");
  }
  const source = assertRepositoryPrivacy({ root });
  assertDocumentationPolicy({ root });
  const worker = fileURLToPath(new URL("./publication-paths.py", import.meta.url));
  for (const selected of new Set(artifacts)) {
    const result = spawnSync("python3", [worker, resolve(root, selected), String(stripComponents)], {
      encoding: null, maxBuffer: MAX_OUTPUT, timeout: 60_000, stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error !== undefined || result.status !== 0) throw new RepositoryPrivacyError("ARTIFACT_INSPECTION_FAILED");
    let manifest;
    try {
      manifest = JSON.parse(decode(result.stdout));
    } catch {
      throw new RepositoryPrivacyError("INVALID_ARTIFACT_MANIFEST");
    }
    // Ignore rules govern source tracking. A CI-produced dist file, JAR or
    // XCFramework remains publishable even when its build path is Git-ignored.
    if (manifest === null || typeof manifest !== "object" || !Array.isArray(manifest.documents)) {
      throw new RepositoryPrivacyError("INVALID_ARTIFACT_MANIFEST");
    }
    assertPublicationPrivacy(manifest.paths);
    const paths = new Set(manifest.paths);
    for (const document of manifest.documents) {
      if (document === null || typeof document !== "object" || !paths.has(document.path)) {
        throw new RepositoryPrivacyError("INVALID_ARTIFACT_MANIFEST");
      }
      assertDocumentationArtifactContent(document.path, document.text);
    }
  }
  return source;
}

export function checkNpmPublication({ root = process.cwd() } = {}) {
  const source = assertRepositoryPrivacy({ root });
  assertDocumentationPolicy({ root });
  const scratch = mkdtempSync(join(tmpdir(), "reallyme-npm-privacy-"));
  try {
    // Ask npm for its real packlist. --ignore-scripts prevents this prepack
    // guard from calling itself, and the private cache leaves no repo output.
    const parentCli = process.env.npm_execpath;
    const npmCli = typeof parentCli === "string" && basename(parentCli) === "npm-cli.js" ? parentCli :
      process.platform === "win32" ? join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js") : undefined;
    // Windows ships npm as a command wrapper. Invoke its JavaScript CLI with
    // Node directly instead of adding a shell around filesystem arguments.
    const executable = npmCli === undefined ? "npm" : process.execPath;
    const args = [...(npmCli === undefined ? [] : [npmCli]), "pack", "--dry-run", "--json", "--ignore-scripts", "--cache", scratch];
    const result = spawnSync(executable, args, {
      cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: MAX_OUTPUT, stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error !== undefined || result.status !== 0) throw new RepositoryPrivacyError("NPM_PACKLIST_FAILED");
    let packages;
    try { packages = JSON.parse(result.stdout); } catch { throw new RepositoryPrivacyError("INVALID_ARTIFACT_MANIFEST"); }
    if (!Array.isArray(packages) || packages.length !== 1 || !Array.isArray(packages[0]?.files)) {
      throw new RepositoryPrivacyError("INVALID_ARTIFACT_MANIFEST");
    }
    const paths = packages[0].files.map((file) => file?.path);
    assertPublicationPrivacy(paths);
    const canonicalRoot = realpathSync(root);
    let documentBytes = 0;
    for (const path of paths) {
      documentBytes += assertDocumentationPublicationFile(canonicalRoot, path);
      if (documentBytes > 8_388_608) throw new DocumentationPolicyError("DOCUMENTATION_TOO_LARGE");
    }
    return source;
  } finally {
    try { rmSync(scratch, { recursive: true, force: true }); } catch { throw new RepositoryPrivacyError("CHECK_CLEANUP_FAILED"); }
  }
}

function main(args) {
  try {
    if (args.length === 0 || (args.length === 1 && args[0] === "--staged")) {
      assertRepositoryPrivacy();
      assertDocumentationPolicy({ staged: true });
    } else if (args.length === 1 && args[0] === "--install-hooks") {
      installPrivacyHooks();
    } else if (args.length === 1 && args[0] === "--pre-push") {
      assertPushPrivacy({ updates: readFileSync(0, "utf8") });
    } else if (args.length === 1 && args[0] === "--npm-package") {
      checkNpmPublication();
    } else if ((args.length === 2 || args.length === 4) && args[0] === "--artifact" &&
               (args.length === 2 || args[2] === "--strip-components")) {
      checkPublication({ artifact: args[1], stripComponents: args.length === 4 ? Number(args[3]) : 0 });
    } else {
      throw new RepositoryPrivacyError("UNSUPPORTED_ARGUMENTS");
    }
  } catch (error) {
    const known = error instanceof RepositoryPrivacyError || error instanceof DocumentationPolicyError;
    console.error(`repository privacy check failed: ${known ? error.code : "CHECK_FAILED"}`);
    if (known) for (const path of error.paths) console.error(JSON.stringify(path));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined) {
  // A symlinked CLI entry point must execute the guard too. Imports from a
  // different program keep the module free of command-line side effects.
  let entry;
  try { entry = realpathSync(process.argv[1]); } catch { entry = undefined; }
  if (entry === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
}
