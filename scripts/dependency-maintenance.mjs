// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  compareVersions, createVersionLookup, DependencyMaintenanceError, gitDependency, record, reject,
  stableVersion, validDependency, workflowDependencies,
} from "./dependency-versions.mjs";

export { DependencyMaintenanceError } from "./dependency-versions.mjs";
export const DEPENDENCY_POLICY = ".github/dependency-maintenance.json";
const policyKeys = ["kind", "path", "name", "current", "latest", "reason", "expires"];
const onlyKeys = (value, keys) => record(value) && Object.keys(value).every((key) => keys.includes(key));
const safePath = (path) => typeof path === "string" && path.length > 0 && !path.includes("\\") &&
  !isAbsolute(path) && !path.split("/").some((part) => ["", ".", ".."].includes(part));

export function readDependencyExceptions(context, trackedFiles, today = new Date().toISOString().slice(0, 10)) {
  if (!trackedFiles.has(DEPENDENCY_POLICY)) return [];
  const policy = context.readJson(DEPENDENCY_POLICY);
  if (!onlyKeys(policy, ["schema", "exceptions"]) || policy.schema !== 1 || !Array.isArray(policy.exceptions)) {
    reject("INVALID_DEPENDENCY_POLICY");
  }
  const keys = new Set();
  for (const entry of policy.exceptions) {
    if (!onlyKeys(entry, policyKeys) || policyKeys.some((key) => !Object.hasOwn(entry, key)) || !validDependency(entry) ||
        !safePath(entry.path) || !trackedFiles.has(entry.path) ||
        typeof entry.latest !== "string" || !stableVersion.test(entry.latest) ||
        typeof entry.reason !== "string" || entry.reason.trim().length < 12 || entry.reason.length > 1000 ||
        /[\x00-\x1f\x7f]/u.test(entry.reason) || typeof entry.expires !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(entry.expires) ||
        !Number.isFinite(Date.parse(entry.expires)) || new Date(entry.expires).toISOString().slice(0, 10) !== entry.expires) {
      reject("INVALID_DEPENDENCY_EXCEPTION");
    }
    if (entry.expires < today) reject("EXPIRED_DEPENDENCY_EXCEPTION");
    const key = JSON.stringify([entry.kind, entry.path, entry.name, entry.current]);
    if (keys.has(key)) reject("DUPLICATE_DEPENDENCY_EXCEPTION");
    keys.add(key);
  }
  return policy.exceptions;
}

export function reviewDependencyVersions(dependencies, latest, exceptions) {
  const used = new Set();
  const updates = [];
  const held = [];
  for (const dependency of dependencies) {
    if (!validDependency(dependency) || !safePath(dependency.path)) reject("INVALID_DEPENDENCY_INVENTORY");
    const release = latest.get(`${["crate", "requirement"].includes(dependency.kind) ? "crate" : "action"}:${dependency.name.toLowerCase()}`);
    if (!record(release) || !stableVersion.test(release.version) ||
        (["action", "git"].includes(dependency.kind) && !/^[a-f0-9]{40}$/u.test(release.sha ?? ""))) reject("INVALID_RELEASE_INVENTORY");
    if (dependency.kind === "crate" && release.yanked?.includes(dependency.current)) reject("YANKED_CARGO_DEPENDENCY");
    const lowerBound = dependency.current.replace(/^[=^]/u, "");
    if (["action", "git"].includes(dependency.kind) ? dependency.current === release.sha : dependency.kind === "requirement"
      ? stableVersion.test(lowerBound) && compareVersions(lowerBound, release.version) === 0
      : compareVersions(dependency.current, release.version) >= 0) continue;
    const hold = exceptions.find((entry) => policyKeys.slice(0, 4).every((key) => entry[key] === dependency[key]) &&
      entry.latest === release.version);
    const issue = { ...dependency, latest: release.version };
    if (hold === undefined) updates.push(issue);
    else { used.add(hold); held.push({ ...issue, reason: hold.reason, expires: hold.expires }); }
  }
  if (exceptions.some((entry) => !used.has(entry))) reject("UNUSED_DEPENDENCY_EXCEPTION");
  return { updates, held };
}

export function dependencyCommand(root) {
  return (command, args, { cwd = root, timeout = 120_000 } = {}) => {
    const result = spawnSync(command, args, {
      cwd, encoding: "utf8", timeout, maxBuffer: 33_554_432,
    });
    if (result.error !== undefined || result.status !== 0) {
      const operation = command === "cargo" ? {
        metadata: "CARGO_METADATA", update: "CARGO_UPDATE", outdated: "CARGO_OUTDATED", audit: "CARGO_AUDIT",
        fmt: "CARGO_FMT", clippy: "CARGO_CLIPPY", test: "CARGO_TEST",
      }[args[0]] : "GIT_TAGS";
      if (command === "cargo" && args[0] === "audit") reject("SECURITY_AUDIT_FAILED", operation);
      reject("DEPENDENCY_COMMAND_FAILED", operation);
    }
    return { stdout: result.stdout, stderr: result.stderr };
  };
}

const jsonResult = (result) => {
  try { return JSON.parse(result.stdout); } catch { reject("INVALID_DEPENDENCY_COMMAND_JSON"); }
};

function repositoryPath(root, absolute, trackedFiles) {
  if (typeof absolute !== "string" || !isAbsolute(absolute)) reject("INVALID_CARGO_METADATA");
  let canonical;
  try { canonical = realpathSync(absolute); } catch { reject("UNTRACKED_CARGO_INPUT"); }
  const path = relative(root, canonical).replaceAll("\\", "/");
  if (!safePath(path) || !trackedFiles.has(path)) reject("UNTRACKED_CARGO_INPUT");
  return path;
}

function cargoInventory(context, trackedFiles, root, run, { validate }) {
  const manifests = [...trackedFiles].filter((path) => /(?:^|\/)Cargo\.toml$/u.test(path)).sort();
  const covered = new Set();
  const workspaces = new Map();
  const dependencies = [];
  const notices = [];
  for (const manifest of manifests) {
    if (covered.has(manifest)) continue;
    const metadata = jsonResult(run("cargo", ["metadata", "--locked", "--all-features", "--format-version", "1", "--manifest-path", manifest]));
    if (!record(metadata) || !Array.isArray(metadata.packages) || !Array.isArray(metadata.workspace_members) ||
        metadata.workspace_members.length === 0 || typeof metadata.workspace_root !== "string") reject("INVALID_CARGO_METADATA");
    const workspace = repositoryPath(root, resolve(metadata.workspace_root, "Cargo.toml"), trackedFiles);
    const lock = repositoryPath(root, resolve(metadata.workspace_root, "Cargo.lock"), trackedFiles);
    covered.add(workspace);
    const members = new Set(metadata.workspace_members);
    for (const pkg of metadata.packages) {
      if (!record(pkg) || typeof pkg.id !== "string" || typeof pkg.name !== "string" || typeof pkg.version !== "string") reject("INVALID_CARGO_METADATA");
      if (members.has(pkg.id)) {
        const path = repositoryPath(root, pkg.manifest_path, trackedFiles);
        covered.add(path);
        if (!Array.isArray(pkg.dependencies)) reject("INVALID_CARGO_METADATA");
        for (const dependency of pkg.dependencies) {
          if (!record(dependency)) reject("INVALID_CARGO_METADATA");
          if (dependency.source === null) continue;
          if (typeof dependency.source === "string" && dependency.source.startsWith("git+")) continue;
          if (typeof dependency.name !== "string" || typeof dependency.req !== "string") reject("INVALID_CARGO_METADATA");
          dependencies.push({ kind: "requirement", path, name: dependency.name, current: dependency.req });
        }
      }
      if (pkg.source === null) continue;
      if (typeof pkg.source === "string" && pkg.source.startsWith("git+")) {
        dependencies.push(gitDependency(pkg.source, lock));
        continue;
      }
      if (typeof pkg.source !== "string" || !/^(?:registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index|sparse\+https:\/\/index\.crates\.io\/)$/u.test(pkg.source)) {
        reject("UNSUPPORTED_CARGO_SOURCE");
      }
      if (!stableVersion.test(pkg.version)) reject("UNSTABLE_CARGO_DEPENDENCY");
      dependencies.push({ kind: "crate", path: lock, name: pkg.name, current: pkg.version });
    }
    if (members.size !== metadata.packages.filter((pkg) => members.has(pkg.id)).length) reject("INVALID_CARGO_METADATA");
    if (workspaces.has(workspace)) continue;
    workspaces.set(workspace, lock);
    const before = context.readText(lock);
    run("cargo", ["update", "--dry-run", "--manifest-path", workspace]);
    run("cargo", ["outdated", "--workspace", "--format", "json", "--manifest-path", workspace]);
    // Overrides apply only to version freshness. A real audit failure can never
    // be converted into a successful release by a dependency exception.
    const audit = jsonResult(run("cargo", ["audit", "--json", "--file", lock]));
    if (!record(audit?.vulnerabilities) || audit.vulnerabilities.found !== false ||
        !Array.isArray(audit.vulnerabilities.list) || audit.vulnerabilities.list.length !== 0 ||
        !record(audit.settings) || audit.settings.severity !== null ||
        !["ignore", "target_arch", "target_os"].every((key) => Array.isArray(audit.settings[key]) && audit.settings[key].length === 0) ||
        !Array.isArray(audit.settings.informational_warnings) ||
        ["unmaintained", "unsound", "notice"].some((kind) => !audit.settings.informational_warnings.includes(kind)) ||
        !record(audit.warnings) || Object.values(audit.warnings).some((warnings) => !Array.isArray(warnings))) {
      reject("SECURITY_AUDIT_FAILED");
    }
    for (const [kind, warnings] of Object.entries(audit.warnings)) {
      if (warnings.length === 0) continue;
      if (!["unmaintained", "notice"].includes(kind)) reject("SECURITY_AUDIT_FAILED");
      for (const warning of warnings) {
        if (!record(warning) || !/^RUSTSEC-\d{4}-\d{4}$/u.test(warning.advisory?.id ?? "") ||
            !/^[A-Za-z0-9_-]+$/u.test(warning.package?.name ?? "") || !stableVersion.test(warning.package?.version ?? "")) {
          reject("SECURITY_AUDIT_FAILED");
        }
        notices.push({ path: lock, kind, id: warning.advisory.id, name: warning.package.name, version: warning.package.version });
      }
    }
    if (context.readText(lock) !== before) reject("DEPENDENCY_CHECK_CHANGED_LOCKFILE");
    if (validate) {
      const cwd = resolve(root, dirname(workspace));
      const options = { cwd, timeout: 1_800_000 };
      run("cargo", ["fmt", "--all", "--check"], options);
      run("cargo", ["clippy", "--locked", "--workspace", "--all-targets", "--all-features", "--", "-D", "warnings"], options);
      run("cargo", ["test", "--locked", "--workspace", "--all-features"], options);
    }
  }
  if ([...trackedFiles].some((path) => /(?:^|\/)Cargo\.lock$/u.test(path) && ![...workspaces.values()].includes(path))) {
    reject("UNREVIEWED_CARGO_LOCKFILE");
  }
  return { dependencies, workspaces: [...workspaces.keys()], notices };
}

export async function checkDependencyMaintenance({ context, trackedFiles, root, validate = false,
  run = dependencyCommand(root), lookup = createVersionLookup(run), today } = {}) {
  const exceptions = readDependencyExceptions(context, trackedFiles, today);
  const inputs = [...trackedFiles].filter((path) => /(?:^|\/)(?:Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?)$/u.test(path) ||
    path === DEPENDENCY_POLICY || /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path));
  const fingerprint = () => createHash("sha256").update(JSON.stringify(inputs.map((path) => [path, context.readText(path)]))).digest("hex");
  const before = fingerprint();
  const { dependencies, workspaces, notices } = cargoInventory(context, trackedFiles, root, run, { validate });
  for (const path of inputs.filter((path) => /^\.github\/workflows\/.+\.ya?ml$/u.test(path))) {
    dependencies.push(...workflowDependencies(context, path, { trackedFiles }));
  }
  const latest = new Map();
  const requests = [...new Map(dependencies.map(({ kind, name }) =>
    [`${["crate", "requirement"].includes(kind) ? "crate" : "action"}:${name.toLowerCase()}`,
      { kind: ["crate", "requirement"].includes(kind) ? "crate" : "action", name }])).entries()];
  // Limit concurrency for crates.io's rate limits; deduplicate every lookup
  // across all workspaces and CI installation lanes in this invocation.
  // Git tag advertisements use synchronous subprocesses. Finish those before
  // starting HTTP requests so they cannot stall the registry timeout clock.
  for (const kind of ["action", "crate"]) {
    const selected = requests.filter(([, request]) => request.kind === kind);
    for (let offset = 0; offset < selected.length; offset += 4) {
      await Promise.all(selected.slice(offset, offset + 4).map(async ([key, request]) => latest.set(key, await lookup(request.kind, request.name))));
    }
  }
  const result = reviewDependencyVersions(dependencies, latest, exceptions);
  if (fingerprint() !== before) reject("DEPENDENCY_CHECK_CHANGED_INPUTS");
  return { ...result, workspaces, checked: requests.length, notices };
}
