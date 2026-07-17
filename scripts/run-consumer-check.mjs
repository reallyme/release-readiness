#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright © 2026 ReallyMe LLC. All rights reserved
//
// SPDX-License-Identifier: Apache-2.0

import { createHash, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAX_CHECKER_BYTES = 524_288;
const MAX_SHARED_CORE_BYTES = 262_144;

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

const result = spawnSync(process.execPath, [checkerPath, ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit",
});
if (result.error !== undefined) {
  failure("consumer checker could not be started");
}
if (!Number.isInteger(result.status)) {
  failure("consumer checker ended without a deterministic exit status");
}
process.exit(result.status);
