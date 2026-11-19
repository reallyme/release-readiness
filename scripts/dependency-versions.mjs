// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

export const stableVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const sha = /^[a-f0-9]{40}$/u;
const crateName = /^[A-Za-z0-9_-]+$/u;
const actionName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const maxResponseBytes = 16_777_216;

export class DependencyMaintenanceError extends Error {
  constructor(code, operation) {
    super(code);
    this.name = "DependencyMaintenanceError";
    this.code = code;
    this.operation = operation;
  }
}

export const reject = (code, operation) => { throw new DependencyMaintenanceError(code, operation); };
export const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function gitDependency(source, path) {
  let url;
  try { url = new URL(source.replace(/^git\+/u, "")); } catch { reject("UNSUPPORTED_CARGO_SOURCE"); }
  const name = url.pathname.replace(/^\//u, "").replace(/\.git$/u, "");
  if (url.origin !== "https://github.com" || url.username !== "" || url.password !== "" ||
      !actionName.test(name) || !sha.test(url.hash.slice(1))) reject("UNSUPPORTED_CARGO_SOURCE");
  return { kind: "git", path, name, current: url.hash.slice(1) };
}

export function compareVersions(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length > 256 || right.length > 256 ||
      !stableVersion.test(left) || !stableVersion.test(right)) reject("INVALID_STABLE_VERSION");
  const first = left.split("+")[0].split(".").map(BigInt);
  const second = right.split("+")[0].split(".").map(BigInt);
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return first[index] > second[index] ? 1 : -1;
  }
  return 0;
}

export function selectStableCrate(value) {
  if (!record(value) || !Array.isArray(value.versions) || value.versions.length === 0 ||
      value.versions.some((entry) => !record(entry) || typeof entry.num !== "string" || entry.num.length > 256 || typeof entry.yanked !== "boolean")) {
    reject("INVALID_CRATE_REGISTRY_RESPONSE");
  }
  const versions = value.versions.filter((entry) => !entry.yanked && stableVersion.test(entry.num));
  if (versions.length === 0) reject("NO_STABLE_CRATE_RELEASE");
  return versions.map((entry) => entry.num).reduce((best, version) => compareVersions(version, best) > 0 ? version : best);
}

// Tags include projects that publish stable versions without creating GitHub
// releases. A single advertisement also avoids paginating thousands of tags.
export function selectStableAction(output) {
  const refs = new Map();
  for (const line of output.trim().split(/\r?\n/u)) {
    const match = /^([a-f0-9]{40})\trefs\/tags\/(v?(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))(\^\{\})?$/u.exec(line);
    if (match === null) continue;
    const entry = refs.get(match[2]) ?? {};
    const field = match[3] === undefined ? "object" : "commit";
    if (entry[field] !== undefined) reject("INVALID_ACTION_TAGS");
    entry[field] = match[1];
    refs.set(match[2], entry);
  }
  const versions = [...refs].filter(([, entry]) => entry.object !== undefined)
    .map(([tag, entry]) => ({ version: tag.replace(/^v/u, ""), sha: entry.commit ?? entry.object }));
  if (versions.length === 0) reject("NO_STABLE_ACTION_RELEASE");
  versions.sort((left, right) => compareVersions(left.version, right.version));
  const latest = versions.at(-1);
  if (versions.some((entry) => entry.version === latest.version && entry.sha !== latest.sha)) reject("AMBIGUOUS_ACTION_RELEASE");
  return latest;
}

export function createVersionLookup(run, { fetchRegistry = fetch } = {}) {
  const requests = new Map();
  return async (kind, name) => {
    if (!["crate", "action"].includes(kind)) reject("INVALID_DEPENDENCY_KIND");
    if (!(kind === "crate" ? crateName : actionName).test(name)) reject("INVALID_DEPENDENCY_NAME");
    const key = `${kind}:${name.toLowerCase()}`;
    if (!requests.has(key)) {
      requests.set(key, (async () => {
        if (kind === "action") {
          const result = run("git", ["ls-remote", "--tags", `https://github.com/${name}.git`]);
          return selectStableAction(result.stdout);
        }
        let response;
        try {
          response = await fetchRegistry(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, {
            signal: AbortSignal.timeout(30_000),
            headers: { "User-Agent": "reallyme-release-readiness (https://github.com/reallyme/release-readiness)" },
          });
          if (!response.ok || response.body === null) reject("CRATE_REGISTRY_UNAVAILABLE");
          const chunks = [];
          let size = 0;
          for await (const chunk of response.body) {
            size += chunk.byteLength;
            if (size > maxResponseBytes) reject("CRATE_REGISTRY_RESPONSE_TOO_LARGE");
            chunks.push(Buffer.from(chunk));
          }
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const version = selectStableCrate(data);
          return { version, yanked: data.versions.filter((entry) => entry.yanked).map((entry) => entry.num) };
        } catch (error) {
          if (error instanceof DependencyMaintenanceError) throw error;
          reject("CRATE_REGISTRY_UNAVAILABLE");
        }
      })());
    }
    return requests.get(key);
  };
}

function installedCargoDependency(command, environment, path, trackedFiles) {
  const words = [];
  // Adjacent quoted and unquoted fragments form one shell word, as in
  // --version="=0.21.0". Parse that syntax without evaluating shell input.
  const token = /(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"'\\`;&|<>()])+/gu;
  let end = 0;
  for (const match of command.matchAll(token)) {
    if (command.slice(end, match.index).trim().length !== 0) reject("UNPINNED_WORKFLOW_TOOL");
    if (match[0].startsWith("#")) { end = command.length; break; }
    if (/[`\\]|\$\(|\$\{/u.test(match[0]) || /'[^']*\$[^']*'/u.test(match[0])) reject("UNPINNED_WORKFLOW_TOOL");
    words.push(match[0].replace(/"([^"\r\n]*)"|'([^'\r\n]*)'/gu, (_fragment, double, single) => double ?? single));
    end = match.index + match[0].length;
  }
  if (command.slice(end).trim().length !== 0 || words.shift() !== "cargo") reject("UNPINNED_WORKFLOW_TOOL");
  if (words[0]?.startsWith("+")) words.shift();
  if (words.shift() !== "install") reject("UNPINNED_WORKFLOW_TOOL");
  const options = new Map();
  const flags = new Set(["--locked", "--force", "--no-default-features", "--all-features", "--debug", "--offline", "--quiet", "--verbose", "-q", "-v"]);
  const values = new Set(["--version", "--git", "--rev", "--path", "--features", "--target", "--root", "--bin", "--jobs", "--target-dir", "--profile"]);
  let name;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (flags.has(word)) { options.set(word, true); continue; }
    const equals = word.indexOf("=");
    const key = equals < 0 ? word : word.slice(0, equals);
    if (values.has(key)) {
      const value = equals < 0 ? words[++index] : word.slice(equals + 1);
      if ((options.has(key) && !["--features", "--bin"].includes(key)) ||
          value === undefined || value.length === 0 || value.startsWith("--")) reject("UNPINNED_WORKFLOW_TOOL");
      options.set(key, value);
    } else {
      if (!crateName.test(word) || name !== undefined) reject("UNPINNED_WORKFLOW_TOOL");
      name = word;
    }
  }
  if (!options.has("--locked")) reject("UNPINNED_WORKFLOW_TOOL");
  if (options.has("--path")) {
    const directory = options.get("--path").replace(/\/$/u, "");
    const manifest = directory === "." ? "Cargo.toml" : `${directory}/Cargo.toml`;
    if (options.has("--git") || options.has("--version") || !trackedFiles?.has(manifest) ||
        directory.split("/").includes("..")) reject("UNPINNED_WORKFLOW_TOOL");
    return null;
  }
  if (name === undefined) reject("UNPINNED_WORKFLOW_TOOL");
  if (options.has("--git")) {
    if (options.has("--version") || !sha.test(options.get("--rev") ?? "")) reject("UNPINNED_WORKFLOW_TOOL");
    return gitDependency(`${options.get("--git")}#${options.get("--rev")}`, path);
  }
  let version = options.get("--version")?.replace(/^=/u, "");
  const variable = /^\$([A-Z][A-Z0-9_]*)$/u.exec(version ?? "");
  if (variable !== null) version = environment(variable[1]);
  if (version === undefined || !stableVersion.test(version) || options.has("--rev")) reject("UNPINNED_WORKFLOW_TOOL");
  return { kind: "crate", path, name, current: version };
}

export function workflowDependencies(context, path, { trackedFiles } = {}) {
  const dependencies = [];
  const workflow = context.readPublicWorkflow(path);
  const source = context.readText(path);
  const steps = context.extractWorkflowSteps(path, { includeUnnamed: true });
  // Unsupported YAML must fail instead of silently dropping dependency
  // installs. The public workflow policy already uses explicit block syntax.
  for (const [name, job] of workflow.jobs) {
    const field = job.get("steps");
    if (field === undefined) continue;
    if (field.value !== "") reject("UNSUPPORTED_WORKFLOW_STEPS");
    const headers = [];
    for (let index = field.index + 1; index < field.end; index += 1) {
      const line = workflow.lines[index];
      if (/^\s*(?:#|$)/u.test(line)) continue;
      if (/^ {6}- [A-Za-z][A-Za-z0-9-]*:/u.test(line)) headers.push(index);
      else if (/^ {0,6}\S/u.test(line)) reject("UNSUPPORTED_WORKFLOW_STEPS");
    }
    const found = steps.filter((step) => step.job === name);
    if (headers.length === 0 || headers.length !== found.length ||
        headers.some((index, position) => index !== found[position].index)) reject("UNSUPPORTED_WORKFLOW_STEPS");
    for (const step of found) {
      const fields = workflow.block({ value: "", index: step.index, end: step.end }, step.indent + 2);
      if (["uses", "run"].some((key) => fields.has(key) && step[key] === null)) reject("UNSUPPORTED_WORKFLOW_STEPS");
      const firstKey = /^ {6}- ([A-Za-z][A-Za-z0-9-]*):/u.exec(workflow.lines[step.index])[1];
      if (fields.has(firstKey)) reject("UNSUPPORTED_WORKFLOW_STEPS");
    }
  }
  const add = (kind, name, current) => dependencies.push({ kind, path, name, current });
  const action = (uses) => {
    if (uses.startsWith("./")) return null;
    const match = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\/[A-Za-z0-9_./-]+)?@([a-f0-9]{40})$/u.exec(uses);
    if (match === null) reject("UNPINNED_WORKFLOW_ACTION");
    add("action", match[1], match[2]);
    return match[1];
  };
  for (const job of workflow.jobs.values()) {
    const uses = workflow.value(job.get("uses"));
    if (typeof uses === "string") action(uses);
  }
  const environment = (name) => {
    const matches = [...source.matchAll(new RegExp(`^ +${name}: +["']?([0-9]+\\.[0-9]+\\.[0-9]+)["']? *(?:#.*)?$`, "gmu"))];
    if (matches.length !== 1 || !stableVersion.test(matches[0][1])) reject("AMBIGUOUS_TOOL_VERSION");
    return matches[0][1];
  };
  for (const step of steps) {
    if (step.uses !== null && !step.uses.startsWith("./")) {
      if (action(step.uses) === "taiki-e/install-action") {
        const properties = workflow.block({ value: "", index: step.index, end: step.end }, step.indent + 2);
        const tools = workflow.value(workflow.block(properties.get("with"), step.indent + 4).get("tool"));
        if (typeof tools !== "string") reject("UNPINNED_WORKFLOW_TOOL");
        for (const tool of tools.split(/[ ,]+/u).filter(Boolean)) {
          const pin = /^(cargo-[A-Za-z0-9_-]+)@(\d+\.\d+\.\d+)$/u.exec(tool);
          if (pin !== null) add("crate", pin[1], pin[2]);
          else if (tool.startsWith("cargo-")) reject("UNPINNED_WORKFLOW_TOOL");
        }
      }
    }
    const script = (step.run ?? "").replace(/\\\r?\n[ \t]*/gu, " ");
    for (const command of script.split(/\r?\n/u).map((line) => line.trim())) {
      if (command.startsWith("#") || !/\bcargo(?: +\+[^ ]+)? +install\b/u.test(command)) continue;
      const dependency = installedCargoDependency(command, environment, path, trackedFiles);
      if (dependency !== null) dependencies.push(dependency);
    }
  }
  if (/^ +BUF_VERSION:/mu.test(source)) add("action-version", "bufbuild/buf", environment("BUF_VERSION"));
  // These values may feed scripts rather than a literal cargo-install step.
  for (const [name, crates] of [
    ["CARGO_DENY_VERSION", ["cargo-deny"]], ["CARGO_AUDIT_VERSION", ["cargo-audit"]],
    ["CARGO_OUTDATED_VERSION", ["cargo-outdated"]], ["CARGO_FUZZ_VERSION", ["cargo-fuzz"]],
    ["BUFFA_VERSION", ["reallyme-buffa", "reallyme-protoc-gen-buffa", "reallyme-protoc-gen-buffa-packaging"]],
  ]) {
    if (new RegExp(`^ +${name}:`, "mu").test(source)) {
      for (const crate of crates) add("crate", crate, environment(name));
    }
  }
  return dependencies;
}

export const validDependency = (value) => record(value) &&
  ["crate", "requirement", "git", "action", "action-version"].includes(value.kind) &&
  typeof value.name === "string" && (["crate", "requirement"].includes(value.kind) ? crateName : actionName).test(value.name) &&
  typeof value.current === "string" && (["action", "git"].includes(value.kind) ? sha : value.kind === "requirement"
    ? /^[0-9A-Za-z.,<>=~^*+ -]{1,160}$/u : stableVersion).test(value.current);
