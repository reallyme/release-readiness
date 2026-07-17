// SPDX-FileCopyrightText: Copyright © 2026 ReallyMe LLC. All rights reserved
//
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runnerPath = fileURLToPath(new URL("../scripts/run-consumer-check.mjs", import.meta.url));
const corePath = fileURLToPath(new URL("../core.mjs", import.meta.url));

const createConsumer = () => {
  const root = mkdtempSync(join(tmpdir(), "reallyme-release-runner-"));
  mkdirSync(join(root, "scripts", "release-readiness"), { recursive: true });
  copyFileSync(corePath, join(root, "scripts", "release-readiness", "core.mjs"));
  writeFileSync(
    join(root, "scripts", "check_release_readiness.mjs"),
    "process.exit(0);\n",
  );
  return root;
};

const runConsumer = (root) =>
  spawnSync(process.execPath, [runnerPath], {
    cwd: root,
    encoding: "utf8",
  });

test("runner accepts an identical vendored core", () => {
  const root = createConsumer();
  const result = runConsumer(root);
  assert.equal(result.status, 0, result.stderr);
});

test("runner rejects a modified vendored core", () => {
  const root = createConsumer();
  writeFileSync(join(root, "scripts", "release-readiness", "core.mjs"), "modified\n");
  const result = runConsumer(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /shared core does not match the pinned package/u);
});

test("runner rejects a symlinked consumer checker", () => {
  const root = createConsumer();
  const checkerPath = join(root, "scripts", "check_release_readiness.mjs");
  const targetPath = join(root, "scripts", "checker-target.mjs");
  writeFileSync(targetPath, "process.exit(0);\n");
  // Replacing the fixture file with a symlink models a checkout containing a
  // redirected gate; the runner must fail before executing the target.
  unlinkSync(checkerPath);
  symlinkSync(targetPath, checkerPath);
  const result = runConsumer(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /consumer checker must be a regular file/u);
});
