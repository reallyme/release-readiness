#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DOCUMENTATION_POLICY = ".github/documentation-policy.json";
const MAX_OUTPUT_BYTES = 16_777_216;
const MAX_DOCUMENT_BYTES = 4_194_304;
const kinds = new Set(["guide", "reference", "contract", "architecture", "contributing", "legal", "changelog", "decision"]);
const conventional = /^(?:readme|contributing|security|code_of_conduct|changelog|changes|licen[cs]e(?:[-.][a-z0-9-]+)?|notice)(?:\.(?:md|mdx|markdown|rst|adoc|txt))?$/iu;
const artifact = /(?:^|-)(?:dependency-security|dependency-audit-report|audit-report|audit-findings|review-findings|task-report|task-summary|session-notes|session-summary|progress-report|implementation-notes|review-notes|handoff(?:-notes)?|cleanup-report|ci-inventory|work-log|working-notes)(?:-|$)/u;
const reportTitle = /^(?:dependency-security-review|dependency-audit(?:-report)?|release-readiness-audit|audit-findings|review-findings|code-review-findings|task-summary|task-report|session-notes|session-summary|progress-report|progress-update|implementation-notes|review-notes|handoff(?:-notes)?|cleanup-report|ci-inventory|work-log|working-notes)(?:-(?:\d.*|as-of-.*))?$/u;
const normalize = (text) => text.toLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, "-").replaceAll(/^-|-$/gu, "");
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export class DocumentationPolicyError extends Error {
  constructor(code, paths = []) {
    super(code);
    this.name = "DocumentationPolicyError";
    this.code = code;
    this.paths = Object.freeze([...paths]);
  }
}

const reject = (code, paths) => { throw new DocumentationPolicyError(code, paths); };
const validPath = (path) => typeof path === "string" && path.length > 0 && !isAbsolute(path) &&
  !/[\x00-\x1f\x7f\\]/u.test(path) && !/^[A-Za-z]:/u.test(path) &&
  path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");

function decode(bytes) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { reject("INVALID_DOCUMENTATION_ENCODING"); }
}

function git(root, args, env, maxBuffer = MAX_OUTPUT_BYTES) {
  const result = spawnSync("git", ["-C", root, ...args], { env, encoding: null, maxBuffer, timeout: 30_000 });
  if (result.error !== undefined || result.status !== 0) reject("DOCUMENTATION_GIT_CHECK_FAILED");
  return result.stdout;
}

function inventory(root, staged, env, revision) {
  const entries = new Map();
  if (revision !== undefined) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(revision)) reject("INVALID_DOCUMENTATION_REVISION");
    for (const entry of decode(git(root, ["ls-tree", "-r", "--full-tree", "-z", revision], env)).split("\0").filter(Boolean)) {
      const match = /^([0-7]{6}) (?:blob|commit) ([a-f0-9]{40}|[a-f0-9]{64})\t([\s\S]+)$/u.exec(entry);
      if (match === null || !validPath(match[3])) reject("INVALID_DOCUMENTATION_INDEX");
      entries.set(match[3], { mode: match[1], oid: match[2] });
    }
    return entries;
  }
  if (!staged) {
    for (const path of decode(git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], env)).split("\0").filter(Boolean)) {
      if (!validPath(path)) reject("INVALID_DOCUMENTATION_PATH");
      entries.set(path, null);
    }
    return entries;
  }
  for (const entry of decode(git(root, ["ls-files", "--stage", "-z"], env)).split("\0").filter(Boolean)) {
    const match = /^([0-7]{6}) ([a-f0-9]{40}|[a-f0-9]{64}) 0\t([\s\S]+)$/u.exec(entry);
    if (match === null || !validPath(match[3])) reject("INVALID_DOCUMENTATION_INDEX");
    entries.set(match[3], { mode: match[1], oid: match[2] });
  }
  return entries;
}

function readDocument(root, path, entry, staged, env) {
  if (staged) {
    if (!["100644", "100755"].includes(entry.mode)) reject("DOCUMENTATION_MUST_BE_REGULAR", [path]);
    return decode(git(root, ["cat-file", "blob", entry.oid], env, MAX_DOCUMENT_BYTES));
  }
  try {
    const absolute = resolve(root, path);
    const status = lstatSync(absolute);
    if (!status.isFile() || status.isSymbolicLink() || realpathSync(absolute) !== absolute) reject("DOCUMENTATION_MUST_BE_REGULAR", [path]);
    if (status.size > MAX_DOCUMENT_BYTES) reject("DOCUMENTATION_TOO_LARGE", [path]);
    return decode(readFileSync(absolute));
  } catch (error) {
    if (error instanceof DocumentationPolicyError) throw error;
    reject("DOCUMENTATION_UNREADABLE", [path]);
  }
}

function openingTitles(source) {
  // A failed unbounded comment regex can rescan every unmatched opener.
  // Walk delimiters once so malformed input stays linear in document size.
  const visible = [];
  let cursor = 0;
  for (;;) {
    const start = source.indexOf("<!--", cursor);
    const end = start < 0 ? -1 : source.indexOf("-->", start + 4);
    if (end < 0) { visible.push(source.slice(cursor)); break; }
    visible.push(source.slice(cursor, start));
    cursor = end + 3;
  }
  const lines = visible.join("").replace(/^\uFEFF/u, "").split(/\r?\n/u);
  const titles = [];
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line));
    if (end > 0) {
      const title = lines.slice(1, end).find((line) => /^title:\s*/u.test(line));
      if (title !== undefined) titles.push(title.replace(/^title:\s*/u, "").replace(/^['"]|['"]$/gu, ""));
      start = end + 1;
    }
  }
  let fence;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const delimiter = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (delimiter !== undefined) {
      if (fence === undefined) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)?.[1] ??
      /^\s*<h1[^>]*>(.*?)<\/h1>\s*$/iu.exec(line)?.[1] ?? /^={1,6}\s+(.+)$/u.exec(line)?.[1];
    if (heading !== undefined) { titles.push(heading); break; }
    if (line.trim().length > 0 && /^ {0,3}(?:=+|-+)\s*$/u.test(lines[index + 1] ?? "")) { titles.push(line.trim()); break; }
  }
  return titles;
}

export function isDocumentationPath(path) {
  const name = basename(path);
  return conventional.test(name) || /\.(?:md|mdx|markdown|rst|adoc)$/iu.test(name) ||
    (/\.txt$/iu.test(name) && (conventional.test(name) || artifact.test(normalize(name.replace(/\.txt$/iu, "")))));
}

export function assertDocumentationArtifactPaths(paths) {
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string")) reject("INVALID_DOCUMENTATION_PATH");
  const forbidden = paths.filter((path) => isDocumentationPath(path) &&
    artifact.test(normalize(basename(path).replace(/\.[^.]+$/u, ""))));
  if (forbidden.length > 0) reject("TRANSIENT_DOCUMENTATION_ARTIFACT", forbidden);
}

export function assertDocumentationArtifactContent(path, source) {
  if (!validPath(path) || !isDocumentationPath(path) || typeof source !== "string") reject("INVALID_DOCUMENTATION_CONTENT");
  assertDocumentationArtifactPaths([path]);
  if (Buffer.byteLength(source, "utf8") > MAX_DOCUMENT_BYTES) reject("DOCUMENTATION_TOO_LARGE", [path]);
  if (openingTitles(source).some((title) => reportTitle.test(normalize(title)))) reject("TRANSIENT_DOCUMENTATION_CONTENT", [path]);
}

export function assertDocumentationPublicationFile(root, path) {
  if (!validPath(path)) reject("INVALID_DOCUMENTATION_PATH");
  if (!isDocumentationPath(path)) return 0;
  const source = readDocument(root, path, null, false);
  assertDocumentationArtifactContent(path, source);
  return Buffer.byteLength(source, "utf8");
}

function declarations(source, documents) {
  let policy;
  try { policy = JSON.parse(source); } catch { reject("INVALID_DOCUMENTATION_POLICY"); }
  if (!record(policy) || Object.keys(policy).some((key) => !["schema", "documents"].includes(key)) ||
      policy.schema !== 1 || !Array.isArray(policy.documents)) reject("INVALID_DOCUMENTATION_POLICY");
  const entries = new Map();
  for (const entry of policy.documents) {
    if (!record(entry) || Object.keys(entry).some((key) => !["path", "kind", "purpose"].includes(key)) ||
        !validPath(entry.path) || !isDocumentationPath(entry.path) || !kinds.has(entry.kind) ||
        typeof entry.purpose !== "string" || entry.purpose.trim().length < 24 || entry.purpose.length > 500 ||
        /[\x00-\x1f\x7f]/u.test(entry.purpose)) reject("INVALID_DOCUMENTATION_DECLARATION");
    if (entries.has(entry.path)) reject("DUPLICATE_DOCUMENTATION_DECLARATION", [entry.path]);
    if (!documents.has(entry.path)) reject("STALE_DOCUMENTATION_DECLARATION", [entry.path]);
    entries.set(entry.path, entry);
  }
  return entries;
}

// The inventory makes each additional document's public purpose reviewable.
// Artifact checks remain independent so a purpose label cannot authorize a
// transient work report. No classifier attempts to infer prose authorship.
export function assertDocumentationPolicy({ root = process.cwd(), staged = false, revision, requirePurposes = true, env = process.env } = {}) {
  try { root = realpathSync(root); } catch { reject("DOCUMENTATION_ROOT_UNAVAILABLE"); }
  staged ||= revision !== undefined;
  const entries = inventory(root, staged, env, revision);
  const documents = new Map([...entries].filter(([path]) => isDocumentationPath(path)));
  assertDocumentationArtifactPaths([...documents.keys()]);
  let approved = new Map();
  if (entries.has(DOCUMENTATION_POLICY)) {
    if (!staged && env.GITHUB_ACTIONS === "true") {
      const tracked = decode(git(root, ["ls-files", "-z", "--", DOCUMENTATION_POLICY], env)).split("\0");
      if (!tracked.includes(DOCUMENTATION_POLICY)) reject("DOCUMENTATION_POLICY_MUST_BE_TRACKED");
    }
    approved = declarations(readDocument(root, DOCUMENTATION_POLICY, entries.get(DOCUMENTATION_POLICY), staged, env), documents);
  }
  const undeclared = [];
  for (const [path, entry] of documents) {
    assertDocumentationArtifactContent(path, readDocument(root, path, entry, staged, env));
    if (requirePurposes && !conventional.test(basename(path)) && !approved.has(path)) undeclared.push(path);
  }
  if (undeclared.length > 0) reject("PUBLIC_DOCUMENTATION_PURPOSE_REQUIRED", undeclared);
  return documents.size;
}

if (process.argv[1] !== undefined) {
  let entry;
  try { entry = realpathSync(process.argv[1]); } catch { entry = undefined; }
  if (entry === fileURLToPath(import.meta.url)) {
    try {
      const args = process.argv.slice(2);
      if (args.length > 1 || (args.length === 1 && args[0] !== "--staged")) reject("UNSUPPORTED_ARGUMENTS");
      assertDocumentationPolicy({ staged: args[0] === "--staged" });
    } catch (error) {
      const known = error instanceof DocumentationPolicyError;
      console.error(`documentation policy failed: ${known ? error.code : "CHECK_FAILED"}`);
      if (known) for (const path of error.paths) console.error(JSON.stringify(path));
      process.exitCode = 1;
    }
  }
}
