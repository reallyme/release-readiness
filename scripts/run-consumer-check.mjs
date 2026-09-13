#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ReallyMe LLC
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { createHash, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { RELEASE_READINESS_VERSION } from "../core.mjs";

const MAX_CHECKER_BYTES = 524_288;
const MAX_SHARED_CORE_BYTES = 262_144;
const MAX_TRACKED_FILES_BYTES = 16_777_216;

const failure = (message) => {
  console.error(`release readiness runner failed: ${message}`);
  process.exit(1);
};

let repositoryRoot;
let checkerPath;
let vendoredCorePath;
let upstreamCorePath;
try {
  repositoryRoot = realpathSync(process.cwd());
  checkerPath = resolve(repositoryRoot, "scripts/check_release_readiness.mjs");
  vendoredCorePath = resolve(repositoryRoot, "scripts/release-readiness/core.mjs");
  upstreamCorePath = fileURLToPath(new URL("../core.mjs", import.meta.url));

  for (const [description, path, maximumBytes] of [
    ["consumer checker", checkerPath, MAX_CHECKER_BYTES],
    ["vendored core", vendoredCorePath, MAX_SHARED_CORE_BYTES],
  ]) {
    const repositoryRelativePath = relative(repositoryRoot, path);
    if (
      repositoryRelativePath === ".." ||
      repositoryRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(repositoryRelativePath)
    ) {
      failure(`${description} path escapes the repository root`);
    }
    const status = lstatSync(path);
    if (status.isSymbolicLink() || !status.isFile()) {
      failure(`${description} must be a regular file`);
    }
    if (status.size === 0 || status.size > maximumBytes) {
      failure(`${description} size is outside the accepted boundary`);
    }
  }

  const upstreamStatus = lstatSync(upstreamCorePath);
  if (upstreamStatus.isSymbolicLink() || !upstreamStatus.isFile()) {
    failure("pinned package core must be a regular file");
  }
  if (upstreamStatus.size === 0 || upstreamStatus.size > MAX_SHARED_CORE_BYTES) {
    failure("pinned package core size is outside the accepted boundary");
  }
  upstreamCorePath = realpathSync(upstreamCorePath);
} catch {
  failure("consumer repository or shared core is missing or inaccessible");
}

const digest = (value) => createHash("sha256").update(value).digest();
const vendoredDigest = digest(readFileSync(vendoredCorePath));
const upstreamDigest = digest(readFileSync(upstreamCorePath));
if (!timingSafeEqual(vendoredDigest, upstreamDigest)) {
  failure("shared core does not match the pinned package");
}

const trackedFilesResult = spawnSync("git", ["ls-files", "-z"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  maxBuffer: MAX_TRACKED_FILES_BYTES,
});
if (trackedFilesResult.error !== undefined || trackedFilesResult.status !== 0) {
  failure("could not enumerate Git-tracked source files");
}
const trackedFiles = trackedFilesResult.stdout.split("\0").filter((path) => path.length !== 0);
const requiredSourcePolicies = new Set();
for (const path of trackedFiles) {
  if (path.endsWith(".rs")) {
    requiredSourcePolicies.add("rust");
  } else if (/\.(?:cts|mts|tsx?|ts)$/u.test(path)) {
    requiredSourcePolicies.add("typescript");
  } else if (path.endsWith(".swift") && !/(?:^|\/)Package\.swift$/u.test(path)) {
    requiredSourcePolicies.add("swift");
  } else if (path.endsWith(".kt")) {
    requiredSourcePolicies.add("kotlin");
  }
}

const result = spawnSync(process.execPath, [checkerPath, ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    RELEASE_READINESS_ENFORCED_VERSION: RELEASE_READINESS_VERSION,
    RELEASE_READINESS_SOURCE_POLICY_FD: "3",
  },
  stdio: ["inherit", "inherit", "inherit", "pipe"],
});
if (result.error !== undefined) {
  failure("consumer checker could not be started");
}
if (!Number.isInteger(result.status)) {
  failure("consumer checker ended without a deterministic exit status");
}
if (result.status === 0) {
  const reportedSourcePolicies = new Set(
    (result.output[3]?.toString("utf8") ?? "")
      .split("\n")
      .filter((language) => language.length !== 0),
  );
  for (const language of requiredSourcePolicies) {
    if (!reportedSourcePolicies.has(language)) {
      failure(`consumer checker did not enforce the shared ${language} source policy`);
    }
  }
}
process.exit(result.status);
