// SPDX-FileCopyrightText: Copyright © 2026 ReallyMe LLC. All rights reserved
//
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

test("tracked file listing fails closed for missing directories", () => {
  const root = createTrackedFixture();
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { createReleaseReadinessContext } from ${JSON.stringify(coreUrl)};
const context = createReleaseReadinessContext({
  scriptUrl: ${JSON.stringify(pathToFileURL(join(root, "scripts", "check.mjs")).href)},
  requireTrackedFiles: true,
});
context.listFiles("generated-missing");`,
    ],
    { cwd: root, encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /release readiness check failed:/u);
  assert.doesNotMatch(result.stderr, /has no tracked files/u);
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

test("cargo-fuzz workflow policy requires locked exact-version installs", () => {
  const root = createFixture();
  const context = createContext(root);
  writeFileSync(
    join(root, ".github", "workflows", "fuzz.yml"),
    `name: Fuzz
env:
  CARGO_FUZZ_VERSION: "0.13.2"
jobs:
  immediate:
    steps:
      - name: Install cargo-fuzz
        run: cargo install cargo-fuzz --version 0.13.2 --locked
  scheduled:
    steps:
      - name: Install cargo-fuzz
        run: cargo install cargo-fuzz --version "$CARGO_FUZZ_VERSION" --locked
`,
  );
  context.assertCargoFuzzWorkflowPolicy({
    version: "0.13.2",
    requiredInstallSteps: [
      { job: "immediate", name: "Install cargo-fuzz" },
      { job: "scheduled", name: "Install cargo-fuzz" },
    ],
  });

  writeFileSync(
    join(root, ".github", "workflows", "fuzz.yml"),
    `name: Fuzz
jobs:
  immediate:
    steps:
      - name: Install cargo-fuzz
        run: cargo install cargo-fuzz --version 0.13.2
      - name: Install cargo-fuzz again
        run: cargo install cargo-fuzz --version 0.13.2 --locked
`,
  );
  const result = runFixtureScript(
    root,
    'context.assertCargoFuzzWorkflowPolicy({ version: "0.13.2" });',
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must use --locked/u);
});

test("cargo-fuzz workflow policy ignores comments and requires configured lanes", () => {
  const root = createFixture();
  writeFileSync(
    join(root, ".github", "workflows", "fuzz.yml"),
    `name: Fuzz
jobs:
  immediate:
    steps:
      - name: Install cargo-fuzz
        run: cargo install cargo-fuzz --version 0.13.2 --locked
      - name: Explain scheduled fuzz
        run: echo "scheduled lane installs cargo install cargo-fuzz --version 0.13.2 --locked elsewhere"
# cargo install cargo-fuzz --version 0.13.2 --locked
`,
  );
  const result = runFixtureScript(
    root,
    `context.assertCargoFuzzWorkflowPolicy({
  version: "0.13.2",
  requiredInstallSteps: [
    { job: "immediate", name: "Install cargo-fuzz" },
    { job: "scheduled", name: "Install cargo-fuzz" },
  ],
});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must install cargo-fuzz at least 2 times/u);
});

test("cargo-fuzz workflow policy accepts only the configured immutable Git source", () => {
  const root = createFixture();
  const revision = "9".repeat(40);
  writeFileSync(
    join(root, ".github", "workflows", "fuzz.yml"),
    `name: Fuzz
jobs:
  immediate:
    steps:
      - name: Install cargo-fuzz
        run: cargo install --git https://github.com/rust-fuzz/cargo-fuzz.git --rev ${revision} --locked cargo-fuzz
  scheduled:
    steps:
      - name: Install cargo-fuzz
        run: cargo install --git https://github.com/rust-fuzz/cargo-fuzz.git --rev ${revision} --locked cargo-fuzz
`,
  );
  const context = createContext(root);
  context.assertCargoFuzzWorkflowPolicy({
    gitSource: {
      url: "https://github.com/rust-fuzz/cargo-fuzz.git",
      revision,
    },
  });

  const result = runFixtureScript(
    root,
    `context.assertCargoFuzzWorkflowPolicy({
  gitSource: {
    url: "https://github.com/rust-fuzz/cargo-fuzz.git",
    revision: "${"8".repeat(40)}",
  },
});`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /configured exact Git revision/u);
});

test("cargo-fuzz workflow policy rejects ambiguous or prefix-matched sources", () => {
  const root = createFixture();
  writeFileSync(
    join(root, ".github", "workflows", "fuzz.yml"),
    `name: Fuzz
jobs:
  immediate:
    steps:
      - name: Install cargo-fuzz
        run: cargo install cargo-fuzz --version 0.13.20 --locked
  scheduled:
    steps:
      - name: Install cargo-fuzz
        run: cargo install cargo-fuzz --version 0.13.20 --locked
`,
  );
  const prefixResult = runFixtureScript(
    root,
    'context.assertCargoFuzzWorkflowPolicy({ version: "0.13.2" });',
  );
  assert.equal(prefixResult.status, 1);
  assert.match(prefixResult.stderr, /must pin version 0\.13\.2/u);

  writeFileSync(
    join(root, ".github", "workflows", "fuzz.yml"),
    `name: Fuzz
jobs:
  immediate:
    steps:
      - name: Install cargo-fuzz
        run: cargo install cargo-fuzz --version 0.13.2 --locked
  scheduled:
    steps:
      - name: Install cargo-fuzz
        run: cargo install cargo-fuzz --version 0.13.2 --locked
`,
  );
  const ambiguousResult = runFixtureScript(
    root,
    `context.assertCargoFuzzWorkflowPolicy({
  version: "0.13.2",
  gitSource: { url: "not-a-github-url", revision: "not-a-sha" },
});`,
  );
  assert.equal(ambiguousResult.status, 1);
  assert.match(ambiguousResult.stderr, /exactly one exact version or Git revision/u);
});

test("workflow permissions policy validates exact scopes by structural location", () => {
  const root = createFixture();
  const workflow = join(root, ".github", "workflows", "release.yml");
  writeFileSync(
    workflow,
    `name: Release
permissions:
  contents: read
jobs:
  verify:
    permissions:
      actions: read
      contents: read
    steps:
      - name: Note
        run: echo "permissions: contents write"
  publish:
    permissions:
      actions: read
      contents: write
    steps:
      - name: Publish
        run: true
`,
  );
  const context = createContext(root);
  const policy = {
    path: ".github/workflows/release.yml",
    workflow: { contents: "read" },
    jobs: {
      verify: { actions: "read", contents: "read" },
      publish: { actions: "read", contents: "write" },
    },
  };
  context.assertWorkflowPermissionsPolicy(policy);

  writeFileSync(
    workflow,
    readFileSync(workflow, "utf8").replace("      contents: write", "      packages: write"),
  );
  const result = runFixtureScript(
    root,
    `context.assertWorkflowPermissionsPolicy(${JSON.stringify(policy)});`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /permissions changed/u);
});

test("Node workflow policy detects corepack-based Node tooling", () => {
  const root = createFixture();
  writeFileSync(
    join(root, ".github", "workflows", "corepack.yml"),
    `name: Corepack
on: push
jobs:
  package:
    runs-on: ubuntu-latest
    steps:
      - name: Use pnpm through corepack
        run: corepack pnpm install --frozen-lockfile
`,
  );
  const result = runFixtureScript(root, "context.assertNodeWorkflowJobsPinNode();");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /uses Node tooling without actions\/setup-node/u);
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

test("SPDX policy rejects tracked source files without headers", () => {
  const root = createTrackedFixture();
  writeFileSync(join(root, "missing.rs"), "pub fn missing() {}\n");
  const gitAdd = spawnSync("git", ["add", "missing.rs"], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
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
context.assertSpdxHeaders({ excludedPrefixes: [".github"] });`,
    ],
    { cwd: root, encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing\.rs is missing the ReallyMe SPDX/u);
});

test("protobuf contract accepts sparse stable identifiers and rejects reserved reuse", () => {
  const root = createFixture();
  const context = createContext(root);
  writeFileSync(
    join(root, "contract.proto"),
    `syntax = "proto3";
enum SignatureAlgorithm {
  SIGNATURE_ALGORITHM_UNSPECIFIED = 0;
  reserved 1 to 99;
  reserved "SIGNATURE_ALGORITHM_RETIRED";
  SIGNATURE_ALGORITHM_ED25519 = 100;
  SIGNATURE_ALGORITHM_ML_DSA_44 = 1000;
}
message Request {
  reserved 2;
  reserved "retired";
  bytes payload = 1;
  bytes context = 100;
}
`,
  );

  context.assertProtoContract("contract.proto");

  writeFileSync(
    join(root, "contract.proto"),
    `syntax = "proto3";
enum SignatureAlgorithm {
  SIGNATURE_ALGORITHM_UNSPECIFIED = 0;
  reserved 100;
  SIGNATURE_ALGORITHM_ED25519 = 100;
}
`,
  );
  const result = runFixtureScript(
    root,
    'context.assertProtoContract("contract.proto");',
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /reuses reserved number 100/u);
});

test("ReallyMe protobuf boundary contract requires typed request and result envelopes", () => {
  const root = createFixture();
  const context = createContext(root);
  writeFileSync(
    join(root, "contract.proto"),
    `syntax = "proto3";
enum ResultStatus {
  RESULT_STATUS_UNSPECIFIED = 0;
  RESULT_STATUS_RESULT = 1;
  RESULT_STATUS_ERROR = 2;
}
message ResultEnvelope {
  ResultStatus status = 1;
  bytes payload = 2;
}
message OperationRequest {
  oneof operation {
    SignRequest sign = 1;
  }
}
message SignRequest {
  bytes payload = 1;
}
`,
  );
  writeFileSync(
    join(root, "README.md"),
    `This crate defines messages only; it intentionally declares no protobuf service.
JSON is a generated ProtoJSON request convenience. Results remain a binary protobuf result envelope.
`,
  );
  writeFileSync(
    join(root, "buf.gen.yaml"),
    `version: v2
plugins:
  - local: protoc-gen-buffa
    out: generated
    opt: [views=true,json=true]
`,
  );
  writeFileSync(
    join(root, "Cargo.toml"),
    '[features]\ngenerated = ["buffa/json", "zeroize"]\n',
  );
  writeFileSync(
    join(root, "wire.rs"),
    `use zeroize::Zeroizing;
type Output = Zeroizing<Vec<u8>>;
fn check(_: OperationRequest, _: ResultEnvelope) {
    let _ = DecodeOptions::new();
}
fn decode_json() { serde_json::from_slice(bytes); }
pub fn process_proto() {}
pub fn process_proto_json() {}
fn encode_proto_result_envelope() {}
`,
  );
  writeFileSync(
    join(root, "swift.swift"),
    `// CodecProtoResultEnvelope
// ZEROIZING_OUTPUT
public func processProto(_ request: [UInt8]) {}
public func processProtoJson(_ requestJson: [UInt8]) {}
`,
  );

  context.assertReallyMeProtoBoundaryContract({
    protoPath: "contract.proto",
    operationRequest: "OperationRequest",
    resultEnvelope: "ResultEnvelope",
    resultStatus: "ResultStatus",
    protoReadme: "README.md",
    protoCargo: "Cargo.toml",
    wirePath: "wire.rs",
    requiredCodecNeedles: ["serde_json::from_slice(bytes)"],
    forbiddenCodecNeedles: ["serde_json::Value"],
    sdkAdapters: [
      {
        path: "swift.swift",
        processProtoNeedle: "public func processProto(_ request: [UInt8])",
        processProtoJsonNeedle:
          "public func processProtoJson(_ requestJson: [UInt8])",
        requiredNeedles: ["// ZEROIZING_OUTPUT"],
      },
    ],
  });

  writeFileSync(
    join(root, "swift.swift"),
    `// CodecProtoResultEnvelope
public func processProto(_ request: [UInt8]) {}
public func processProtoJson(_ requestJson: [UInt8]) {}
`,
  );
  const missingRequiredNeedle = runFixtureScript(
    root,
    `context.assertReallyMeProtoBoundaryContract({
  protoPath: "contract.proto",
  operationRequest: "OperationRequest",
  resultEnvelope: "ResultEnvelope",
  resultStatus: "ResultStatus",
  protoReadme: "README.md",
  protoCargo: "Cargo.toml",
  wirePath: "wire.rs",
  sdkAdapters: [{
    path: "swift.swift",
    processProtoNeedle: "public func processProto(_ request: [UInt8])",
    processProtoJsonNeedle: "public func processProtoJson(_ requestJson: [UInt8])",
    requiredNeedles: ["// ZEROIZING_OUTPUT"],
  }],
});`,
  );
  assert.equal(missingRequiredNeedle.status, 1);
  assert.match(
    missingRequiredNeedle.stderr,
    /swift\.swift does not contain \/\/ ZEROIZING_OUTPUT/u,
  );
});

test("ReallyMe protobuf boundary contract rejects incomplete SDK adapters", () => {
  const root = createFixture();
  writeFileSync(
    join(root, "contract.proto"),
    `syntax = "proto3";
enum ResultStatus {
  RESULT_STATUS_UNSPECIFIED = 0;
  RESULT_STATUS_RESULT = 1;
}
message ResultEnvelope {
  ResultStatus status = 1;
  bytes payload = 2;
}
message OperationRequest {
  oneof operation {
    SignRequest sign = 1;
  }
}
message SignRequest {
  bytes payload = 1;
}
`,
  );
  writeFileSync(
    join(root, "README.md"),
    `This crate defines messages only; it intentionally declares no protobuf service.
JSON is a generated ProtoJSON request convenience. Results remain a binary protobuf result envelope.
`,
  );
  writeFileSync(
    join(root, "buf.gen.yaml"),
    `plugins:
  - local: protoc-gen-buffa
    opt: [views=true,json=true]
`,
  );
  writeFileSync(
    join(root, "Cargo.toml"),
    '[features]\ngenerated = ["buffa/json", "zeroize"]\n',
  );
  writeFileSync(
    join(root, "wire.rs"),
    `use zeroize::Zeroizing;
type Output = Zeroizing<Vec<u8>>;
fn check(_: OperationRequest, _: ResultEnvelope) {
    let _ = DecodeOptions::new();
}
pub fn process_proto() {}
pub fn process_proto_json() {}
fn encode_proto_result_envelope() {}
`,
  );
  writeFileSync(
    join(root, "swift.swift"),
    `// ResultEnvelope
public func processProto(_ request: [UInt8]) {}
`,
  );
  const result = runFixtureScript(
    root,
    `context.assertReallyMeProtoBoundaryContract({
  protoPath: "contract.proto",
  operationRequest: "OperationRequest",
  resultEnvelope: "ResultEnvelope",
  resultStatus: "ResultStatus",
  protoReadme: "README.md",
  protoCargo: "Cargo.toml",
  wirePath: "wire.rs",
  sdkAdapters: [{
    path: "swift.swift",
    processProtoNeedle: "public func processProto(",
    processProtoJsonNeedle: "public func processProtoJson(",
  }],
});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /swift\.swift does not contain public func processProtoJson\(/u);
});

test("ReallyMe operation boundary contract requires generated response outcomes", () => {
  const root = createFixture();
  const context = createContext(root);
  writeFileSync(
    join(root, "contract.proto"),
    `syntax = "proto3";
message OperationRequest {
  oneof operation {
    SignRequest sign = 1;
  }
}
message OperationResult {
  oneof result {
    SignResult sign = 1;
  }
}
message OperationResponse {
  oneof outcome {
    OperationResult result = 1;
    CodecError error = 2;
  }
}
service OperationService {
  rpc Process(OperationRequest) returns (OperationResponse);
}
message CodecError {
  uint32 reason = 1;
}
message SignRequest {
  bytes payload = 1;
}
message SignResult {
  bytes signature = 1;
}
`,
  );
  writeFileSync(
    join(root, "README.md"),
    `This crate defines messages only; it intentionally declares no protobuf service.
JSON is a generated ProtoJSON request convenience. Results remain one fully discriminated operation response.
`,
  );
  writeFileSync(
    join(root, "buf.gen.yaml"),
    `version: v2
plugins:
  - local: protoc-gen-buffa
    out: generated
    opt: [views=true,json=true]
`,
  );
  writeFileSync(
    join(root, "Cargo.toml"),
    '[features]\ngenerated = ["buffa/json", "zeroize"]\n',
  );
  writeFileSync(
    join(root, "wire.rs"),
    `use zeroize::Zeroizing;
type Output = Zeroizing<Vec<u8>>;
fn check(_: OperationRequest, _: OperationResponse) {
    let _ = DecodeOptions::new();
}
pub fn process_operation_response() {}
pub fn process_operation_response_json() {}
fn codec_error() {}
`,
  );
  writeFileSync(
    join(root, "swift.swift"),
    `// OperationResponse
// ZEROIZING_OUTPUT
public func processOperation(_ request: [UInt8]) {}
public func processOperationJson(_ requestJson: [UInt8]) {}
`,
  );

  context.assertReallyMeOperationBoundaryContract({
    protoPath: "contract.proto",
    operationRequest: "OperationRequest",
    operationResponse: "OperationResponse",
    operationResult: "OperationResult",
    protoReadme: "README.md",
    protoCargo: "Cargo.toml",
    wirePath: "wire.rs",
    codecPath: "wire.rs",
    binaryResponseNeedle: "codec_error",
    forbiddenCodecNeedles: ["CodecProtoResultEnvelope"],
    sdkAdapters: [
      {
        path: "swift.swift",
        processOperationNeedle: "public func processOperation(_ request: [UInt8])",
        processOperationJsonNeedle:
          "public func processOperationJson(_ requestJson: [UInt8])",
        requiredNeedles: ["// ZEROIZING_OUTPUT"],
      },
    ],
  });

  const serviceRejected = runFixtureScript(
    root,
    `context.assertReallyMeOperationBoundaryContract({
  protoPath: "contract.proto",
  operationRequest: "OperationRequest",
  operationResponse: "OperationResponse",
  operationResult: "OperationResult",
  protoReadme: "README.md",
  protoCargo: "Cargo.toml",
  wirePath: "wire.rs",
  allowServices: false,
});`,
  );
  assert.equal(serviceRejected.status, 1);
  assert.match(serviceRejected.stderr, /must define messages only and no protobuf service/u);

  writeFileSync(
    join(root, "contract.proto"),
    `syntax = "proto3";
message OperationRequest {
  oneof operation {
    SignRequest sign = 1;
  }
}
message OperationResult {
  oneof result {
    SignResult sign = 1;
  }
}
message OperationResponse {
  OperationResult result = 1;
}
message CodecError {
  uint32 reason = 1;
}
message SignRequest {
  bytes payload = 1;
}
message SignResult {
  bytes signature = 1;
}
`,
  );
  const result = runFixtureScript(
    root,
    `context.assertReallyMeOperationBoundaryContract({
  protoPath: "contract.proto",
  operationRequest: "OperationRequest",
  operationResponse: "OperationResponse",
  operationResult: "OperationResult",
  protoReadme: "README.md",
  protoCargo: "Cargo.toml",
  wirePath: "wire.rs",
});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /OperationResponse must contain a generated result\/error outcome oneof/u);
});

test("aggregate Rust protobuf policy rejects duplicate freshness configuration", () => {
  const root = createFixture();
  const result = runFixtureScript(
    root,
    `context.assertReallyMeRustProtoRepositoryPolicy({
  generatedFreshnessMode: false,
  vendoredCore: {},
  workflowActions: {},
  nodeWorkflows: {},
  cargoFuzz: {},
  cargoWorkspace: {},
  spdx: {},
  protobufBoundary: {},
  protobufRelease: { generatedFreshnessMode: false },
});`,
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /generatedFreshnessMode must be configured once at the repository-policy level/u,
  );
});

test("local checker template is syntactically valid and fails closed by construction", () => {
  const templatePath = fileURLToPath(
    new URL("../templates/check_release_readiness.mjs", import.meta.url),
  );
  const syntax = spawnSync(process.execPath, ["--check", templatePath], {
    encoding: "utf8",
  });
  assert.equal(syntax.status, 0, syntax.stderr);

  const template = readFileSync(templatePath, "utf8");
  assert.match(template, /requireTrackedFiles: true/u);
  assert.match(template, /assertReallyMeRustProtoRepositoryPolicy/u);
  assert.match(template, /assertNoTemplateMarkers\(repositoryPolicy\)/u);
  assert.match(template, /validatePublishablePathDependencies: true/u);
  assert.match(template, /version: "0\.13\.2"/u);
  assert.match(template, /REPLACE_SECRET_BYTE_FIELD/u);
  assert.doesNotMatch(template, /requireTrackedFiles: false/u);
});

test("generated hardening supports message-scoped sensitive field names", () => {
  const root = createFixture();
  const context = createContext(root);
  writeFileSync(
    join(root, "schema.proto"),
    `syntax = "proto3";
message SensitiveBytes {
  bytes value = 1;
}
`,
  );
  writeFileSync(
    join(root, "harden.mjs"),
    'const option = "--check-idempotent";\ndeserialize_zeroizing_bytes\n',
  );
  writeFileSync(
    join(root, "generated.rs"),
    `#[derive(Clone, PartialEq, Default)]
pub struct SensitiveBytes {
    pub value: ::buffa::alloc::vec::Vec<u8>,
}
impl ::core::fmt::Debug for SensitiveBytes {
    fn fmt(&self, f: &mut ::core::fmt::Formatter<'_>) -> ::core::fmt::Result {
        f.debug_struct("SensitiveBytes").field("value", &"<redacted>").finish()
    }
}
impl ::core::ops::Drop for SensitiveBytes {
    fn drop(&mut self) {
        ::zeroize::Zeroize::zeroize(&mut self.value);
    }
}
struct Wire {
    value: ::zeroize::Zeroizing<::buffa::alloc::vec::Vec<u8>>,
}
#[derive(Clone, PartialEq, Default)]
pub struct PublicValue {
    pub value: u32,
}
impl ::core::fmt::Debug for PublicValue {
    fn fmt(&self, f: &mut ::core::fmt::Formatter<'_>) -> ::core::fmt::Result {
        f.debug_struct("PublicValue").field("value", &self.value).finish()
    }
}
`,
  );

  context.assertGeneratedProtoHardeningPolicy({
    hardeningScript: "harden.mjs",
    protoSchema: "schema.proto",
    generatedRust: "generated.rs",
    requiredScriptNeedles: ["deserialize_zeroizing_bytes"],
    scalarFieldClassifications: [
      {
        message: "SensitiveBytes",
        field: "value",
        kind: "bytes",
        sensitivity: "sensitive",
      },
    ],
    requiredGeneratedNeedles: ["pub struct SensitiveBytes"],
    forbiddenGeneratedNeedles: ["::buffa::alloc::format!("],
    requireStrictJson: false,
    requireUnknownFieldZeroization: false,
  });

  writeFileSync(join(root, "harden.mjs"), "deserialize_zeroizing_bytes\n");
  const result = runFixtureScript(
    root,
    `context.assertGeneratedProtoHardeningPolicy({
  hardeningScript: "harden.mjs",
  protoSchema: "schema.proto",
  generatedRust: "generated.rs",
  requiredScriptNeedles: ["deserialize_zeroizing_bytes"],
  scalarFieldClassifications: [{
    message: "SensitiveBytes",
    field: "value",
    kind: "bytes",
    sensitivity: "sensitive",
  }],
  requiredGeneratedNeedles: ["pub struct SensitiveBytes"],
  forbiddenGeneratedNeedles: ["::buffa::alloc::format!("],
  requireStrictJson: false,
  requireUnknownFieldZeroization: false,
});`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not contain "--check-idempotent"/u);
});

test("generated hardening requires recursive unknown-field zeroization", () => {
  const root = createFixture();
  writeFileSync(
    join(root, "schema.proto"),
    `syntax = "proto3";
message SensitiveBytes {
  bytes value = 1;
}
`,
  );
  writeFileSync(
    join(root, "harden.mjs"),
    `deserialize_zeroizing_bytes
const option = "--check-idempotent";
::buffa::UnknownFieldData::LengthDelimited(bytes)
`,
  );
  writeFileSync(
    join(root, "generated.rs"),
    `fn __reallyme_zeroize_unknown_fields(fields: &mut ::buffa::UnknownFields) {
    for mut field in ::core::mem::take(fields) {
        if let ::buffa::UnknownFieldData::LengthDelimited(bytes) = &mut field.data {
            ::zeroize::Zeroize::zeroize(bytes);
        }
    }
}
#[derive(Clone, PartialEq, Default)]
pub struct SensitiveBytes {
    pub value: ::buffa::alloc::vec::Vec<u8>,
}
impl ::core::fmt::Debug for SensitiveBytes {
    fn fmt(&self, f: &mut ::core::fmt::Formatter<'_>) -> ::core::fmt::Result {
        f.debug_struct("SensitiveBytes").field("value", &"<redacted>").finish()
    }
}
impl ::core::ops::Drop for SensitiveBytes {
    fn drop(&mut self) {
        ::zeroize::Zeroize::zeroize(&mut self.value);
        __reallyme_zeroize_unknown_fields(&mut self.__buffa_unknown_fields);
    }
}
struct Wire {
    value: ::zeroize::Zeroizing<::buffa::alloc::vec::Vec<u8>>,
}
`,
  );

  const result = runFixtureScript(
    root,
    `context.assertGeneratedProtoHardeningPolicy({
  hardeningScript: "harden.mjs",
  protoSchema: "schema.proto",
  generatedRust: "generated.rs",
  requiredScriptNeedles: ["deserialize_zeroizing_bytes"],
  scalarFieldClassifications: [{
    message: "SensitiveBytes",
    field: "value",
    kind: "bytes",
    sensitivity: "sensitive",
  }],
  requiredGeneratedNeedles: ["pub struct SensitiveBytes"],
  forbiddenGeneratedNeedles: ["::buffa::alloc::format!("],
  requireStrictJson: false,
});`,
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /harden\.mjs does not contain ::buffa::UnknownFieldData::Group\(fields\)/u,
  );
});

test("generated hardening rejects every unclassified bytes or string field", () => {
  const root = createFixture();
  writeFileSync(join(root, "harden.mjs"), 'const option = "--check-idempotent";\nredact\n');
  writeFileSync(
    join(root, "generated.rs"),
    `pub struct SensitiveBytes {
    pub value: ::buffa::alloc::vec::Vec<u8>,
}
impl ::core::fmt::Debug for SensitiveBytes {
    fn fmt(&self, f: &mut ::core::fmt::Formatter<'_>) -> ::core::fmt::Result {
        f.debug_struct("SensitiveBytes").field("value", &"<redacted>").finish()
    }
}
impl ::core::ops::Drop for SensitiveBytes {
    fn drop(&mut self) {
        ::zeroize::Zeroize::zeroize(&mut self.value);
    }
}
struct Wire {
    value: ::zeroize::Zeroizing<::buffa::alloc::vec::Vec<u8>>,
}
`,
  );

  for (const kind of ["bytes", "string"]) {
    writeFileSync(
      join(root, "schema.proto"),
      `syntax = "proto3";
message SensitiveBytes { bytes value = 1; optional ${kind} newly_added_secret = 2 [deprecated = true]; }
`,
    );
    const result = runFixtureScript(
      root,
      `context.assertGeneratedProtoHardeningPolicy({
  hardeningScript: "harden.mjs",
  protoSchema: "schema.proto",
  generatedRust: "generated.rs",
  requiredScriptNeedles: ["redact"],
  scalarFieldClassifications: [{
    message: "SensitiveBytes",
    field: "value",
    kind: "bytes",
    sensitivity: "sensitive",
  }],
  requiredGeneratedNeedles: ["pub struct SensitiveBytes"],
  forbiddenGeneratedNeedles: ["::buffa::alloc::format!("],
  requireStrictJson: false,
  requireUnknownFieldZeroization: false,
});`,
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      new RegExp(
        `schema\\.proto has unclassified protobuf scalar field SensitiveBytes\\.newly_added_secret:${kind}`,
        "u",
      ),
    );
  }
});

test("generated hardening rejects legal non-style protobuf scalar identifiers", () => {
  const root = createFixture();
  writeFileSync(join(root, "harden.mjs"), 'const option = "--check-idempotent";\nredact\n');
  writeFileSync(
    join(root, "schema.proto"),
    `syntax = "proto3";
message Codec_Secret {
  bytes sessionToken = 1;
  string displayName = 2;
}
`,
  );
  writeFileSync(
    join(root, "generated.rs"),
    `pub struct Codec_Secret {
    pub sessionToken: ::buffa::alloc::vec::Vec<u8>,
    pub displayName: ::buffa::alloc::string::String,
}
`,
  );

  const result = runFixtureScript(
    root,
    `context.assertGeneratedProtoHardeningPolicy({
  hardeningScript: "harden.mjs",
  protoSchema: "schema.proto",
  generatedRust: "generated.rs",
  requiredScriptNeedles: ["redact"],
  scalarFieldClassifications: [{
    message: "Codec_Secret",
    field: "displayName",
    kind: "string",
    sensitivity: "public",
  }],
  requiredGeneratedNeedles: ["pub struct Codec_Secret"],
  forbiddenGeneratedNeedles: ["::buffa::alloc::format!("],
  requireStrictJson: false,
  requireUnknownFieldZeroization: false,
});`,
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /schema\.proto has unclassified protobuf scalar field Codec_Secret\.sessionToken:bytes/u,
  );
});

test("vendored core policy rejects assertions hidden in strings", () => {
  const root = createTrackedFixture();
  writeFileSync(
    join(root, "scripts", "release-readiness", "core.mjs"),
    `export const RELEASE_READINESS_CORE_CONTRACT_VERSION = 8;
const assertReallyMeVendoredCorePolicy = () => {
  "assertGeneratedArtifactsFresh";
  "assertGeneratedProtoHardeningPolicy";
  "assertReallyMeProtobufReleasePolicy";
  "assertReallyMeVendoredCorePolicy";
  "assertReallyMeRustProtoRepositoryPolicy";
  "assertCargoMetadataPolicy";
  "assertCargoWorkspacePolicy";
  "assertTextPolicy";
  "assertSpdxHeaders";
  "assertWorkflowActionsPinned";
  "assertWorkflowPolicy";
  "runCommands";
  "assertProtoContract";
  "assertReallyMeProtoBoundaryContract";
  "assertReallyMeOperationBoundaryContract";
  "assertWorkflowRunStep";
  "assertWorkflowUsesStep";
  "scalarFieldClassifications";
};
export { assertReallyMeVendoredCorePolicy };
`,
  );

  const result = runFixtureScript(
    root,
    `context.assertReallyMeVendoredCorePolicy({
  scriptPath: "scripts/release-readiness/core.mjs",
  corePath: "scripts/release-readiness/core.mjs",
});`,
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /scripts\/release-readiness\/core\.mjs must define assertGeneratedArtifactsFresh/u,
  );
});

test("generated hardening handles indented messages and single-quoted options", () => {
  const root = createFixture();
  const context = createContext(root);
  writeFileSync(join(root, "harden.mjs"), 'const option = "--check-idempotent";\nredact\n');
  writeFileSync(
    join(root, "schema.proto"),
    `syntax = "proto3";
  message SensitiveBytes {
    bytes value = 1 [json_name = 'value]alias'];
    string display_label = 2 [json_name = 'display_label'];
  }
`,
  );
  writeFileSync(
    join(root, "generated.rs"),
    `pub struct SensitiveBytes {
    pub value: ::buffa::alloc::vec::Vec<u8>,
    pub display_label: ::buffa::alloc::string::String,
}
impl ::core::fmt::Debug for SensitiveBytes {
    fn fmt(&self, f: &mut ::core::fmt::Formatter<'_>) -> ::core::fmt::Result {
        f.debug_struct("SensitiveBytes")
            .field("value", &"<redacted>")
            .field("display_label", &self.display_label)
            .finish()
    }
}
impl ::core::ops::Drop for SensitiveBytes {
    fn drop(&mut self) {
        ::zeroize::Zeroize::zeroize(&mut self.value);
    }
}
struct Wire {
    value: ::zeroize::Zeroizing<::buffa::alloc::vec::Vec<u8>>,
}
`,
  );

  context.assertGeneratedProtoHardeningPolicy({
    hardeningScript: "harden.mjs",
    protoSchema: "schema.proto",
    generatedRust: "generated.rs",
    requiredScriptNeedles: ["redact"],
    scalarFieldClassifications: [
      {
        message: "SensitiveBytes",
        field: "value",
        kind: "bytes",
        sensitivity: "sensitive",
      },
      {
        message: "SensitiveBytes",
        field: "display_label",
        kind: "string",
        sensitivity: "public",
      },
    ],
    requiredGeneratedNeedles: ["pub struct SensitiveBytes"],
    forbiddenGeneratedNeedles: ["::buffa::alloc::format!("],
    requireStrictJson: false,
    requireUnknownFieldZeroization: false,
  });
});
