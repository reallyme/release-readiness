// SPDX-FileCopyrightText: Copyright © 2026 ReallyMe LLC. All rights reserved
//
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createReleaseReadinessContext } from "../core.mjs";

const coreUrl = new URL("../core.mjs", import.meta.url).href;
const fullSha = "0123456789abcdef0123456789abcdef01234567";

const createFixture = () => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "reallyme-release-readiness-")),
  );
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, "policy.txt"), "required\nrequired\nsafe\n");
  writeFileSync(
    join(root, ".github", "workflows", "checks.yaml"),
    `name: Checks
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Install Node
        uses: actions/setup-node@${fullSha} # pinned
        with:
          node-version: "24"
      - run: echo unnamed-sibling
      - name: Run check
        run: |
          node scripts/check.mjs
`,
  );
  return root;
};

const createContext = (root) =>
  createReleaseReadinessContext({
    scriptUrl: pathToFileURL(join(root, "scripts", "check.mjs")).href,
    requireTrackedFiles: false,
  });

const createTrackedFixture = () => {
  const root = createFixture();
  mkdirSync(join(root, "scripts", "release-readiness"), { recursive: true });
  mkdirSync(join(root, "generated"), { recursive: true });
  copyFileSync(new URL("../core.mjs", import.meta.url), join(root, "scripts", "release-readiness", "core.mjs"));
  writeFileSync(join(root, "generated", "output.txt"), "generated\n");
  const gitInit = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const gitAdd = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  return root;
};

const runFixtureScript = (root, body) =>
  spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { createReleaseReadinessContext } from ${JSON.stringify(coreUrl)};
const context = createReleaseReadinessContext({
  scriptUrl: ${JSON.stringify(pathToFileURL(join(root, "scripts", "check.mjs")).href)},
  requireTrackedFiles: false,
});
${body}`,
    ],
    { encoding: "utf8" },
  );

test("workflow and text policies accept pinned, exact repository inputs", () => {
  const root = createFixture();
  const context = createContext(root);

  context.assertTextPolicy({
    files: [
      {
        path: "policy.txt",
        required: ["required"],
        forbidden: ["secret"],
        minimumOccurrences: [{ needle: "required", count: 2 }],
      },
    ],
  });
  context.assertWorkflowActionsPinned();
  context.assertNodeWorkflowJobsPinNode({ nodeVersion: "24" });
  context.assertWorkflowUsesStep(
    ".github/workflows/checks.yaml",
    "Install Node",
    `actions/setup-node@${fullSha}`,
  );
  context.assertWorkflowRunStep(
    ".github/workflows/checks.yaml",
    "Run check",
    "node scripts/check.mjs",
  );

  const steps = context.extractWorkflowSteps(".github/workflows/checks.yaml");
  assert.equal(steps.length, 2);
  assert.equal(steps[0].name, "Install Node");
  assert.equal(steps[0].run, null);
  assert.equal(steps[1].name, "Run check");
});

test("cargo metadata policy validates publish and dependency boundaries", () => {
  const root = createFixture();
  const context = createContext(root);
  const packages = context.assertCargoMetadataDocument(
    {
      packages: [
        {
          name: "reallyme-example",
          version: "1.2.3",
          publish: null,
          dependencies: [
            {
              name: "reallyme-crypto",
              req: "^0.2.1",
              source: "registry+https://github.com/rust-lang/crates.io-index",
              uses_default_features: false,
              optional: false,
              features: ["native"],
            },
          ],
        },
      ],
    },
    {
      packages: [
        {
          name: "reallyme-example",
          version: "1.2.3",
          publish: "public",
          dependencies: [
            {
              name: "reallyme-crypto",
              requirement: "^0.2.1",
              source: "registry",
              defaultFeatures: false,
              optional: false,
              features: ["native"],
            },
          ],
        },
      ],
    },
  );

  assert.equal(packages.get("reallyme-example").version, "1.2.3");
});

test("repository reads fail closed on paths outside the repository", () => {
  const root = createFixture();
  const result = runFixtureScript(root, 'context.readText("../outside.txt");');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /escapes the repository root/u);
});

test("repository reads reject absolute paths and symlink traversal", () => {
  const root = createFixture();
  const outsideRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "reallyme-release-readiness-outside-")),
  );
  writeFileSync(join(outsideRoot, "secret.txt"), "outside\n");
  symlinkSync(outsideRoot, join(root, "escape"));

  const absoluteResult = runFixtureScript(
    root,
    `context.readText(${JSON.stringify(join(root, "policy.txt"))});`,
  );
  assert.equal(absoluteResult.status, 1);
  assert.match(absoluteResult.stderr, /repository-relative path/u);

  const symlinkResult = runFixtureScript(
    root,
    'context.readText("escape/secret.txt");',
  );
  assert.equal(symlinkResult.status, 1);
  assert.match(symlinkResult.stderr, /resolves outside the repository root/u);
});

test("workflow action policy rejects floating action references", () => {
  const root = createFixture();
  writeFileSync(
    join(root, ".github", "workflows", "floating.yml"),
    `name: Floating
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
`,
  );
  const result = runFixtureScript(root, "context.assertWorkflowActionsPinned();");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /not pinned to a full commit SHA/u);
});

test("workflow action policy requires Docker digests and contained local paths", () => {
  const root = createFixture();
  writeFileSync(
    join(root, ".github", "workflows", "docker.yml"),
    `name: Docker
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: docker://alpine:3.22
`,
  );
  const dockerResult = runFixtureScript(
    root,
    "context.assertWorkflowActionsPinned({ allowDockerActions: true });",
  );
  assert.equal(dockerResult.status, 1);
  assert.match(dockerResult.stderr, /not pinned to a sha256 digest/u);

  writeFileSync(
    join(root, ".github", "workflows", "docker.yml"),
    `name: Local
on: push
jobs:
  test:
    uses: ./../../outside.yml
`,
  );
  const localResult = runFixtureScript(
    root,
    "context.assertWorkflowActionsPinned();",
  );
  assert.equal(localResult.status, 1);
  assert.match(localResult.stderr, /local workflow action escapes the repository root/u);
});

test("exact workflow checks reject folded run scalars", () => {
  const root = createFixture();
  writeFileSync(
    join(root, ".github", "workflows", "folded.yml"),
    `name: Folded
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Folded command
        run: >
          node scripts/check.mjs
`,
  );
  const result = runFixtureScript(
    root,
    'context.assertWorkflowRunStep(".github/workflows/folded.yml", "Folded command", "node scripts/check.mjs");',
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported folded run scalar/u);
});

test("exact workflow checks reject duplicate named steps", () => {
  const root = createFixture();
  writeFileSync(
    join(root, ".github", "workflows", "duplicate.yml"),
    `name: Duplicate
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Run check
        run: node scripts/check.mjs
      - name: Run check
        run: node scripts/other.mjs
`,
  );
  const result = runFixtureScript(
    root,
    'context.assertWorkflowRunStep(".github/workflows/duplicate.yml", "Run check", "node scripts/check.mjs");',
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /defines workflow step Run check more than once/u);
});

test("generated freshness rejects mutations outside declared generated paths", () => {
  const root = createTrackedFixture();
  const fixtureCoreUrl = pathToFileURL(
    join(root, "scripts", "release-readiness", "core.mjs"),
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { createReleaseReadinessContext } from ${JSON.stringify(fixtureCoreUrl)};
const context = createReleaseReadinessContext({
  scriptUrl: ${JSON.stringify(pathToFileURL(join(root, "scripts", "check.mjs")).href)},
  requireTrackedFiles: true,
});
context.assertGeneratedArtifactsFresh({
  generatedPaths: ["generated"],
  commands: [
    [
      process.execPath,
      ["--input-type=module", "--eval", "import { appendFileSync } from 'node:fs'; appendFileSync('policy.txt', 'changed\\\\n');"],
    ],
  ],
});`,
    ],
    { cwd: root, encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /modified policy\.txt outside the declared generated paths/u);
});

test("generated freshness rejects repository-root and overlapping paths", () => {
  const root = createFixture();
  const rootResult = runFixtureScript(
    root,
    `context.assertGeneratedArtifactsFresh({
  generatedPaths: ["."],
  commands: [["node", ["--version"]]],
});`,
  );
  assert.equal(rootResult.status, 1);
  assert.match(rootResult.stderr, /must not include the repository root/u);

  mkdirSync(join(root, "generated", "rust"), { recursive: true });
  const overlapResult = runFixtureScript(
    root,
    `context.assertGeneratedArtifactsFresh({
  generatedPaths: ["generated", "generated/rust"],
  commands: [["node", ["--version"]]],
});`,
  );
  assert.equal(overlapResult.status, 1);
  assert.match(overlapResult.stderr, /must not overlap/u);
});

test("cargo metadata policy rejects ambiguous dependency matches", () => {
  const root = createFixture();
  const result = runFixtureScript(
    root,
    `context.assertCargoMetadataDocument(
  {
    packages: [
      {
        name: "reallyme-example",
        version: "1.2.3",
        publish: null,
        dependencies: [
          {
            name: "reallyme-crypto",
            req: "^0.2.1",
            source: "registry+https://github.com/rust-lang/crates.io-index",
            uses_default_features: false,
            optional: false,
            features: [],
            kind: null,
            target: null,
            rename: null,
          },
          {
            name: "reallyme-crypto",
            req: "^0.2.1",
            source: "registry+https://github.com/rust-lang/crates.io-index",
            uses_default_features: false,
            optional: false,
            features: [],
            kind: "dev",
            target: null,
            rename: null,
          },
        ],
      },
    ],
  },
  {
    packages: [
      {
        name: "reallyme-example",
        dependencies: [{ name: "reallyme-crypto" }],
      },
    ],
  },
);`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /dependency reallyme-crypto is ambiguous/u);
});
