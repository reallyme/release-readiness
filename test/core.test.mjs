// SPDX-FileCopyrightText: 2026 ReallyMe LLC
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
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

const createProtocolShapeFixture = () => {
  const root = createFixture();
  for (const directory of [
    "conformance",
    "contracts",
    "crates/openid4vci",
    "crates/proto",
    "crates/proto-codec",
    "docs",
    "scripts/release-readiness",
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  copyFileSync(
    new URL("../core.mjs", import.meta.url),
    join(root, "scripts", "release-readiness", "core.mjs"),
  );
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\nmembers = []\n");
  writeFileSync(join(root, "conformance", "README.md"), "conformance\n");
  writeFileSync(join(root, "contracts", "api.md"), "contract\n");
  writeFileSync(join(root, "crates", "openid4vci", "Cargo.toml"), "[package]\nname = \"openid4vci\"\n");
  writeFileSync(join(root, "crates", "proto", "Cargo.toml"), "[package]\nname = \"proto\"\n");
  writeFileSync(join(root, "crates", "proto", "openid4vci.proto"), "syntax = \"proto3\";\n");
  writeFileSync(
    join(root, "crates", "proto-codec", "Cargo.toml"),
    "[package]\nname = \"proto-codec\"\n",
  );
  writeFileSync(join(root, "docs", "architecture.md"), "architecture\n");
  writeFileSync(join(root, "scripts", "check_release_readiness.mjs"), "export {};\n");
  const gitInit = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const gitAdd = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  return root;
};

const protocolShapePolicy = {
  archetype: "protocol-engine",
  requiredLanes: ["crates", "contracts", "conformance", "docs", "scripts", ".github"],
  optionalLanes: [],
  exceptions: [],
  crates: [
    { path: "crates/openid4vci", role: "domain" },
    { path: "crates/proto", role: "proto" },
    { path: "crates/proto-codec", role: "proto-codec" },
  ],
  subLanes: {},
  forbiddenPaths: [],
  requireReleaseReadiness: true,
};

const createApplicationShapeFixture = () => {
  const root = createFixture();
  for (const directory of [
    "conformance",
    "contracts",
    "crates/identity",
    "crates/proto/proto",
    "docs",
    "scripts/release-readiness",
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  copyFileSync(
    new URL("../core.mjs", import.meta.url),
    join(root, "scripts", "release-readiness", "core.mjs"),
  );
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\nmembers = []\n");
  writeFileSync(join(root, "conformance", "README.md"), "conformance\n");
  writeFileSync(join(root, "contracts", "public-api.md"), "contract\n");
  writeFileSync(join(root, "crates", "identity", "Cargo.toml"), '[package]\nname = "identity"\n');
  writeFileSync(join(root, "crates", "proto", "Cargo.toml"), '[package]\nname = "proto"\n');
  writeFileSync(
    join(root, "crates", "proto", "proto", "identity.proto"),
    'syntax = "proto3";\n',
  );
  writeFileSync(join(root, "docs", "architecture.md"), "architecture\n");
  writeFileSync(join(root, "scripts", "check_release_readiness.mjs"), "export {};\n");
  const gitInit = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const gitAdd = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  return root;
};

const applicationShapePolicy = {
  archetype: "application",
  requiredLanes: ["crates", "contracts", "conformance", "docs", "scripts", ".github"],
  optionalLanes: [],
  exceptions: [],
  crates: [
    { path: "crates/identity", role: "domain" },
    { path: "crates/proto", role: "proto" },
  ],
  subLanes: {},
  forbiddenPaths: [],
  requireReleaseReadiness: true,
};

const createTypeScriptApplicationShapeFixture = () => {
  const root = createFixture();
  for (const directory of [
    "app/contract/proto",
    "app/src",
    "app/tests",
    "conformance",
    "contracts",
    "docs",
    "scripts/release-readiness",
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  copyFileSync(
    new URL("../core.mjs", import.meta.url),
    join(root, "scripts", "release-readiness", "core.mjs"),
  );
  writeFileSync(
    join(root, "app", "contract", "proto", "application.proto"),
    'syntax = "proto3";\n',
  );
  writeFileSync(join(root, "app", "package.json"), '{"type":"module"}\n');
  writeFileSync(join(root, "app", "src", "main.ts"), "export {};\n");
  writeFileSync(join(root, "app", "tests", "main.test.ts"), "export {};\n");
  writeFileSync(join(root, "conformance", "README.md"), "conformance\n");
  writeFileSync(join(root, "contracts", "public-api.md"), "contract\n");
  writeFileSync(join(root, "docs", "architecture.md"), "architecture\n");
  writeFileSync(join(root, "scripts", "check_release_readiness.mjs"), "export {};\n");
  const gitInit = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const gitAdd = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  return root;
};

const typeScriptApplicationShapePolicy = {
  archetype: "application",
  requiredLanes: ["app", "contracts", "conformance", "docs", "scripts", ".github"],
  optionalLanes: [],
  exceptions: [],
  crates: [],
  subLanes: {},
  forbiddenPaths: [],
  requireReleaseReadiness: true,
};

const createApplicationCollectionShapeFixture = () => {
  const root = createFixture();
  for (const directory of [
    "apps/catalog/contract/proto",
    "apps/messaging",
    "conformance",
    "docs",
    "scripts/release-readiness",
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  copyFileSync(
    new URL("../core.mjs", import.meta.url),
    join(root, "scripts", "release-readiness", "core.mjs"),
  );
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\nmembers = []\n");
  writeFileSync(join(root, "apps", "catalog", "README.md"), "catalog application\n");
  writeFileSync(
    join(root, "apps", "catalog", "contract", "proto", "catalog.proto"),
    'syntax = "proto3";\n',
  );
  writeFileSync(join(root, "apps", "messaging", "README.md"), "messaging application\n");
  writeFileSync(join(root, "conformance", "README.md"), "conformance\n");
  writeFileSync(join(root, "docs", "architecture.md"), "architecture\n");
  writeFileSync(join(root, "scripts", "check_release_readiness.mjs"), "export {};\n");
  const gitInit = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const gitAdd = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  return root;
};

const applicationCollectionShapePolicy = {
  archetype: "application-collection",
  requiredLanes: ["apps", "conformance", "docs", "scripts", ".github"],
  optionalLanes: [],
  exceptions: [],
  crates: [],
  subLanes: { apps: ["catalog", "messaging"] },
  forbiddenPaths: [],
  requireReleaseReadiness: true,
};

const createProductWorkspaceShapeFixture = ({ includeFacade = true } = {}) => {
  const root = createFixture();
  for (const directory of [
    "apps/agent",
    "apps/controller",
    "apps/web",
    "conformance",
    "crates/client",
    "crates/domain",
    "crates/proto/proto",
    "crates/proto-codec",
    "deploy",
    "docs",
    "gen/typescript",
    "packages/ts-client",
    "scripts/release-readiness",
    ...(includeFacade ? ["crates/product"] : []),
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  copyFileSync(
    new URL("../core.mjs", import.meta.url),
    join(root, "scripts", "release-readiness", "core.mjs"),
  );
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\nmembers = []\n");
  for (const application of ["agent", "controller", "web"]) {
    writeFileSync(join(root, "apps", application, "README.md"), `${application}\n`);
  }
  for (const crate of ["client", "domain", "proto", "proto-codec"]) {
    writeFileSync(
      join(root, "crates", crate, "Cargo.toml"),
      `[package]\nname = "${crate}"\n`,
    );
  }
  if (includeFacade) {
    writeFileSync(
      join(root, "crates", "product", "Cargo.toml"),
      '[package]\nname = "product"\n',
    );
  }
  writeFileSync(
    join(root, "crates", "proto", "proto", "product.proto"),
    'syntax = "proto3";\n',
  );
  for (const directory of [
    "conformance",
    "deploy",
    "docs",
    "gen/typescript",
    "packages/ts-client",
  ]) {
    writeFileSync(join(root, directory, "README.md"), `${directory}\n`);
  }
  writeFileSync(join(root, "scripts", "check_release_readiness.mjs"), "export {};\n");
  const gitInit = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const gitAdd = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  return root;
};

const productWorkspaceShapePolicy = ({ includeFacade = true } = {}) => ({
  archetype: "product-workspace",
  requiredLanes: ["apps", "crates", "conformance", "docs", "scripts", ".github"],
  optionalLanes: ["deploy", "gen", "packages"],
  exceptions: [],
  crates: [
    { path: "crates/client", role: "transport" },
    { path: "crates/domain", role: "domain" },
    { path: "crates/proto", role: "proto" },
    { path: "crates/proto-codec", role: "proto-codec" },
    ...(includeFacade ? [{ path: "crates/product", role: "facade" }] : []),
  ],
  subLanes: {
    apps: ["agent", "controller", "web"],
    gen: ["typescript"],
    packages: ["ts-client"],
  },
  forbiddenPaths: [],
  requireReleaseReadiness: true,
});

const createDirectoryShapeFixture = ({ directories, files = [] }) => {
  const root = createFixture();
  for (const directory of directories) {
    mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, directory, "README.md"), `${directory}\n`);
  }
  mkdirSync(join(root, "scripts", "release-readiness"), { recursive: true });
  copyFileSync(
    new URL("../core.mjs", import.meta.url),
    join(root, "scripts", "release-readiness", "core.mjs"),
  );
  writeFileSync(join(root, "scripts", "check_release_readiness.mjs"), "export {};\n");
  for (const [path, contents] of files) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  const gitInit = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const gitAdd = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  return root;
};

const taxonomyShapePolicy = {
  archetype: "taxonomy",
  requiredLanes: [
    "taxonomy",
    "schema",
    "views",
    "consumers",
    "conformance",
    "tests",
    "docs",
    "scripts",
    ".github",
  ],
  optionalLanes: [],
  exceptions: [],
  crates: [],
  subLanes: { views: ["identity", "ssi"] },
  forbiddenPaths: [],
  requireReleaseReadiness: true,
};

const conformanceSuiteShapePolicy = {
  archetype: "conformance-suite",
  requiredLanes: [
    "upstream",
    "plans",
    "adapters",
    "schemas",
    "tests",
    "results",
    "evidence",
    "docs",
    "scripts",
    ".github",
  ],
  optionalLanes: [],
  exceptions: [],
  crates: [],
  subLanes: {},
  forbiddenPaths: [],
  requireReleaseReadiness: true,
};

const documentationSiteShapePolicy = {
  archetype: "documentation-site",
  requiredLanes: ["content", "contracts", "tests", "scripts", ".github"],
  optionalLanes: [
    "assets",
    "components",
    "conformance",
    "examples",
    "localization",
    "snippets",
  ],
  exceptions: [],
  crates: [],
  subLanes: { content: ["guides", "reference"] },
  forbiddenPaths: [],
  requireReleaseReadiness: true,
};

const createPlatformWorkspaceShapeFixture = () => {
  const root = createFixture();
  for (const directory of [
    "apps/example/contract/proto",
    "conformance",
    "crates/platform",
    "docs",
    "kits/app",
    "scripts/release-readiness",
    "servers/example",
    "workers/example",
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  copyFileSync(
    new URL("../core.mjs", import.meta.url),
    join(root, "scripts", "release-readiness", "core.mjs"),
  );
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\nmembers = []\n");
  writeFileSync(join(root, "apps", "example", "README.md"), "example app\n");
  writeFileSync(
    join(root, "apps", "example", "Cargo.toml"),
    '[package]\nname = "example-app"\n',
  );
  writeFileSync(
    join(root, "apps", "example", "contract", "proto", "example.proto"),
    "syntax = \"proto3\";\n",
  );
  writeFileSync(join(root, "conformance", "README.md"), "conformance\n");
  writeFileSync(
    join(root, "crates", "platform", "Cargo.toml"),
    "[package]\nname = \"platform\"\n",
  );
  writeFileSync(join(root, "docs", "architecture.md"), "architecture\n");
  writeFileSync(join(root, "kits", "app", "README.md"), "app kit\n");
  writeFileSync(join(root, "scripts", "check_release_readiness.mjs"), "export {};\n");
  writeFileSync(join(root, "servers", "example", "README.md"), "example server\n");
  writeFileSync(join(root, "workers", "example", "README.md"), "example worker\n");
  const gitInit = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const gitAdd = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  return root;
};

const platformWorkspaceShapePolicy = {
  archetype: "platform-workspace",
  requiredLanes: [
    "crates",
    "kits",
    "apps",
    "servers",
    "workers",
    "conformance",
    "docs",
    "scripts",
    ".github",
  ],
  optionalLanes: [],
  exceptions: [],
  crates: [{ path: "crates/platform", role: "facade" }],
  subLanes: {
    apps: ["example"],
    kits: ["app"],
    servers: ["example"],
    workers: ["example"],
  },
  forbiddenPaths: [],
  requireReleaseReadiness: true,
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

const runTrackedFixtureScript = (root, body) => {
  const fixtureCoreUrl = pathToFileURL(
    join(root, "scripts", "release-readiness", "core.mjs"),
  ).href;
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { createReleaseReadinessContext } from ${JSON.stringify(fixtureCoreUrl)};
const context = createReleaseReadinessContext({
  scriptUrl: ${JSON.stringify(pathToFileURL(join(root, "scripts", "check.mjs")).href)},
  requireTrackedFiles: true,
});
${body}`,
    ],
    { cwd: root, encoding: "utf8" },
  );
};

const verificationPolicy = (roles) => [
  {
    roles,
    command: process.execPath,
    args: ["--version"],
    options: { capture: true },
  },
];

const typeScriptConfiguration = {
  compilerOptions: {
    strict: true,
    noImplicitAny: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    useUnknownInCatchVariables: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
  },
};

const typeScriptStaticAnalysis = {
  files: [{ path: "tsconfig.json", required: ["strict"] }],
};

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

test("cargo metadata policy enforces latest stable ReallyMe registry dependencies", () => {
  const root = createFixture();
  const context = createContext(root);
  const metadata = {
    packages: [
      {
        name: "reallyme-example",
        version: "1.2.3",
        publish: null,
        dependencies: [
          {
            name: "reallyme-crypto",
            req: "^0.3.5",
            source: "registry+https://github.com/rust-lang/crates.io-index",
            uses_default_features: false,
            optional: false,
            features: [],
          },
          {
            name: "reallyme-codec",
            req: "^0.2.2",
            source: "registry+https://github.com/rust-lang/crates.io-index",
            uses_default_features: false,
            optional: false,
            features: [],
          },
        ],
      },
    ],
  };

  context.assertCargoMetadataDocument(metadata, {
    latestStableVersions: {
      "reallyme-crypto": "0.3.5",
      "reallyme-codec": "0.2.2",
    },
    reallyMeLatestStableDependencies: true,
  });

  metadata.packages[0].dependencies[0].req = "^0.3.4";
  const result = runFixtureScript(
    root,
    `context.assertCargoMetadataDocument(
  ${JSON.stringify(metadata)},
  {
    latestStableVersions: {
      "reallyme-crypto": "0.3.5",
      "reallyme-codec": "0.2.2",
    },
    reallyMeLatestStableDependencies: true,
  },
);`,
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /reallyme-example dependency reallyme-crypto requirement is \^0\.3\.4, expected latest stable \^0\.3\.5/u,
  );
});

test("cargo metadata dependency policies can require latest stable directly", () => {
  const root = createFixture();
  const context = createContext(root);
  context.assertCargoMetadataDocument(
    {
      packages: [
        {
          name: "reallyme-example",
          version: "1.2.3",
          publish: null,
          dependencies: [
            {
              name: "reallyme-cose",
              req: "^0.2.2",
              source: "registry+https://github.com/rust-lang/crates.io-index",
              uses_default_features: false,
              optional: false,
              features: [],
            },
            {
              name: "reallyme-jose",
              req: "0.3.1",
              source: "registry+https://github.com/rust-lang/crates.io-index",
              uses_default_features: false,
              optional: false,
              features: [],
            },
          ],
        },
      ],
    },
    {
      latestStableVersions: {
        "reallyme-cose": "0.2.2",
        "reallyme-jose": "0.3.1",
      },
      packages: [
        {
          name: "reallyme-example",
          dependencies: [
            { name: "reallyme-cose", latestStable: true },
            { name: "reallyme-jose", latestStable: "exact" },
          ],
        },
      ],
    },
  );
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

test("cargo-fuzz workflow policy inspects unnamed and multiline installs", () => {
  const root = createFixture();
  writeFileSync(
    join(root, ".github", "workflows", "fuzz.yml"),
    `name: Fuzz
on: push
jobs:
  immediate:
    runs-on: ubuntu-latest
    steps:
      - name: Install cargo-fuzz
        run: cargo install cargo-fuzz --version 0.13.2 --locked
      - run: cargo install cargo-fuzz --version 0.13.2
  scheduled:
    runs-on: ubuntu-latest
    steps:
      - name: Install cargo-fuzz
        run: |
          cargo install \\
            --version 0.13.2 \\
            --locked \\
            cargo-fuzz
`,
  );
  const result = runFixtureScript(
    root,
    `context.assertCargoFuzzWorkflowPolicy({
  workflow: ".github/workflows/fuzz.yml",
  version: "0.13.2",
  minimumInstallations: 2,
  requiredInstallSteps: [
    { job: "immediate", name: "Install cargo-fuzz" },
    { job: "scheduled", name: "Install cargo-fuzz" },
  ],
});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /cargo-fuzz installation must be in a named workflow step/u);
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

test("workflow permissions policy rejects job-level inline permissions syntax", () => {
  const root = createFixture();
  for (const inlinePermissions of ["write-all", "{contents: write}"]) {
    writeFileSync(
      join(root, ".github", "workflows", "release.yml"),
      `name: Release
permissions:
  contents: read
jobs:
  publish:
    permissions: ${inlinePermissions}
    steps:
      - name: Publish
        run: true
`,
    );
    const result = runFixtureScript(
      root,
      `context.assertWorkflowPermissionsPolicy({
  path: ".github/workflows/release.yml",
  workflow: { contents: "read" },
  jobs: {},
});`,
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /permissions must be a flat explicit mapping/u);
  }
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

test("exact workflow checks can disambiguate repeated step names by job", () => {
  const root = createFixture();
  writeFileSync(
    join(root, ".github", "workflows", "repeated.yml"),
    `name: Repeated
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@${fullSha}
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@${fullSha}
`,
  );
  const context = createContext(root);

  context.assertWorkflowPolicy({
    path: ".github/workflows/repeated.yml",
    usesSteps: [
      { job: "build", name: "Checkout", uses: `actions/checkout@${fullSha}` },
      { job: "release", name: "Checkout", uses: `actions/checkout@${fullSha}` },
    ],
  });
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
  assert.match(result.stderr, /missing\.rs is missing the configured SPDX/u);
});

test("SPDX policy defaults to ReallyMe's dual-license header", () => {
  const root = createTrackedFixture();
  writeFileSync(
    join(root, "reallyme.rs"),
    `// SPDX-FileCopyrightText: 2026 ReallyMe LLC
//
// SPDX-License-Identifier: MIT OR Apache-2.0

pub fn create() {}
`,
  );
  writeFileSync(join(root, "README.md"), "# Header-free documentation\n");
  writeFileSync(join(root, "NOTICE.txt"), "Header-free plain text\n");
  const gitAdd = spawnSync("git", ["add", "reallyme.rs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const gitAddDocumentation = spawnSync("git", ["add", "README.md", "NOTICE.txt"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAddDocumentation.status, 0, gitAddDocumentation.stderr);
  const result = runTrackedFixtureScript(
    root,
    `context.assertSpdxHeaders({
  exclusions: [{ path: ".github", reason: "third-party" }],
  requireExclusionsMatched: true,
  requireExclusionReasons: true,
});`,
  );

  assert.equal(result.status, 0, result.stderr);
});

test("SPDX policy supports a different copyright owner and license", () => {
  const root = createTrackedFixture();
  writeFileSync(
    join(root, "example-organization.rs"),
    `// SPDX-FileCopyrightText: 2026 Example Organization
//
// SPDX-License-Identifier: AGPL-3.0-only

pub fn owned_by_example_organization() {}
`,
  );
  const gitAdd = spawnSync("git", ["add", "example-organization.rs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const result = runTrackedFixtureScript(
    root,
    `context.assertSpdxHeaders({
  exclusions: [
    { path: ".github", reason: "third-party" },
    { path: "scripts/release-readiness", reason: "vendored" },
  ],
  requireExclusionsMatched: true,
  requireExclusionReasons: true,
  copyright: "SPDX-FileCopyrightText: 2026 Example Organization",
  license: "SPDX-License-Identifier: AGPL-3.0-only",
});`,
  );

  assert.equal(result.status, 0, result.stderr);
});

test("SPDX policy accepts typed exclusions and rejects stale exclusions", () => {
  const root = createTrackedFixture();
  writeFileSync(join(root, "generated", "output.rs"), "pub fn generated() {}\n");
  const gitAdd = spawnSync("git", ["add", "generated/output.rs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const policy = `{
  exclusions: [
    { path: ".github", reason: "third-party" },
    { path: "generated", reason: "generated" },
  ],
  requireExclusionsMatched: true,
  requireExclusionReasons: true,
}`;

  const accepted = runTrackedFixtureScript(
    root,
    `context.assertSpdxHeaders(${policy});`,
  );
  assert.equal(accepted.status, 0, accepted.stderr);

  const stale = runTrackedFixtureScript(
    root,
    `context.assertSpdxHeaders({
  ...${policy},
  exclusions: [
    { path: ".github", reason: "third-party" },
    { path: "generated", reason: "generated" },
    { path: "retired-generated", reason: "generated" },
  ],
});`,
  );
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /retired-generated does not match a governed tracked file/u);
});

test("SPDX policy can require typed reasons for every exclusion", () => {
  const root = createTrackedFixture();
  const result = runTrackedFixtureScript(
    root,
    `context.assertSpdxHeaders({
  excludedPrefixes: [".github"],
  requireExclusionReasons: true,
});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.github requires a typed reason/u);
});

test("repository shape policy accepts a declared protocol-engine layout", () => {
  const root = createProtocolShapeFixture();
  const context = createContext(root);

  context.assertRepositoryShapePolicy(protocolShapePolicy);
});

test("repository shape policy accepts a declared application layout", () => {
  const root = createApplicationShapeFixture();
  const context = createContext(root);

  context.assertRepositoryShapePolicy(applicationShapePolicy);
});

test("repository shape policy accepts a TypeScript application layout", () => {
  const root = createTypeScriptApplicationShapeFixture();
  const context = createContext(root);

  context.assertRepositoryShapePolicy(typeScriptApplicationShapePolicy);
});

test("application requires a Rust or app implementation lane", () => {
  const root = createDirectoryShapeFixture({
    directories: ["conformance", "contracts", "docs"],
  });
  const policy = {
    ...typeScriptApplicationShapePolicy,
    requiredLanes: ["contracts", "conformance", "docs", "scripts", ".github"],
  };
  const result = runFixtureScript(
    root,
    `context.assertRepositoryShapePolicy(${JSON.stringify(policy)});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires at least one implementation lane from app, crates/u);
});

test("repository shape policy accepts a declared application-collection layout", () => {
  const root = createApplicationCollectionShapeFixture();
  const context = createContext(root);

  context.assertRepositoryShapePolicy(applicationCollectionShapePolicy);
});

for (const languageLayout of ["rust", "typescript", "mixed"]) {
  test(`application-collection accepts a ${languageLayout} implementation selection`, () => {
    const root = createApplicationCollectionShapeFixture();
    const applications = ["catalog", "messaging"];
    for (const [index, application] of applications.entries()) {
      const usesRust =
        languageLayout === "rust" || (languageLayout === "mixed" && index === 0);
      if (usesRust) {
        mkdirSync(join(root, "apps", application, "src"), { recursive: true });
        writeFileSync(
          join(root, "apps", application, "Cargo.toml"),
          `[package]\nname = "${application}"\n`,
        );
        writeFileSync(join(root, "apps", application, "src", "lib.rs"), "pub struct App;\n");
      } else {
        mkdirSync(join(root, "apps", application, "src"), { recursive: true });
        writeFileSync(
          join(root, "apps", application, "package.json"),
          '{"type":"module"}\n',
        );
        writeFileSync(join(root, "apps", application, "src", "index.ts"), "export {};\n");
      }
    }
    const gitAdd = spawnSync("git", ["add", "apps"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(gitAdd.status, 0, gitAdd.stderr);
    const context = createContext(root);

    context.assertRepositoryShapePolicy(applicationCollectionShapePolicy);
  });
}

for (const archetype of ["application-collection", "product-workspace"]) {
  test(`${archetype} requires at least two declared applications`, () => {
    const root =
      archetype === "application-collection"
        ? createApplicationCollectionShapeFixture()
        : createProductWorkspaceShapeFixture();
    const policy =
      archetype === "application-collection"
        ? { ...applicationCollectionShapePolicy, subLanes: { apps: ["catalog"] } }
        : {
            ...productWorkspaceShapePolicy(),
            subLanes: {
              ...productWorkspaceShapePolicy().subLanes,
              apps: ["agent"],
            },
          };
    const result = runFixtureScript(
      root,
      `context.assertRepositoryShapePolicy(${JSON.stringify(policy)});`,
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires at least two application sublanes/u);
  });
}

test("repository shape policy accepts a product-workspace with a shared protocol and facade", () => {
  const root = createProductWorkspaceShapeFixture();
  const context = createContext(root);

  context.assertRepositoryShapePolicy(productWorkspaceShapePolicy());
});

test("product-workspace does not require a facade", () => {
  const root = createProductWorkspaceShapeFixture({ includeFacade: false });
  const context = createContext(root);

  context.assertRepositoryShapePolicy(
    productWorkspaceShapePolicy({ includeFacade: false }),
  );
});

test("repository shape policy permits at most one facade", () => {
  const root = createProductWorkspaceShapeFixture();
  mkdirSync(join(root, "crates", "alternate-facade"), { recursive: true });
  writeFileSync(
    join(root, "crates", "alternate-facade", "Cargo.toml"),
    '[package]\nname = "alternate-facade"\n',
  );
  const gitAdd = spawnSync("git", ["add", "crates/alternate-facade/Cargo.toml"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const policy = productWorkspaceShapePolicy();
  policy.crates.push({ path: "crates/alternate-facade", role: "facade" });
  const result = runFixtureScript(
    root,
    `context.assertRepositoryShapePolicy(${JSON.stringify(policy)});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /permits at most one facade crate/u);
});

test("repository shape policy rejects a facade with nothing to aggregate", () => {
  const root = createFixture();
  for (const directory of ["crates/product", "docs", "scripts/release-readiness"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  copyFileSync(
    new URL("../core.mjs", import.meta.url),
    join(root, "scripts", "release-readiness", "core.mjs"),
  );
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\nmembers = []\n");
  writeFileSync(
    join(root, "crates", "product", "Cargo.toml"),
    '[package]\nname = "product"\n',
  );
  writeFileSync(join(root, "docs", "README.md"), "docs\n");
  writeFileSync(join(root, "scripts", "check_release_readiness.mjs"), "export {};\n");
  const gitInit = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const gitAdd = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const policy = {
    archetype: "foundational-library",
    requiredLanes: ["crates", "docs", "scripts", ".github"],
    optionalLanes: [],
    exceptions: [],
    crates: [{ path: "crates/product", role: "facade" }],
    subLanes: {},
    forbiddenPaths: [],
    requireReleaseReadiness: true,
  };
  const result = runFixtureScript(
    root,
    `context.assertRepositoryShapePolicy(${JSON.stringify(policy)});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /facade crate requires at least one internal package/u);
});

test("application-collection accepts shared and application-owned protobuf schemas", () => {
  const root = createApplicationCollectionShapeFixture();
  for (const directory of ["crates/proto/proto", "crates/proto-codec"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(
    join(root, "crates", "proto", "Cargo.toml"),
    '[package]\nname = "shared-proto"\n',
  );
  writeFileSync(
    join(root, "crates", "proto", "proto", "shared.proto"),
    'syntax = "proto3";\n',
  );
  writeFileSync(
    join(root, "crates", "proto-codec", "Cargo.toml"),
    '[package]\nname = "shared-proto-codec"\n',
  );
  const gitAdd = spawnSync("git", ["add", "crates/proto", "crates/proto-codec"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const policy = {
    ...applicationCollectionShapePolicy,
    optionalLanes: ["crates"],
    crates: [
      { path: "crates/proto", role: "proto" },
      { path: "crates/proto-codec", role: "proto-codec" },
    ],
  };
  const context = createContext(root);

  context.assertRepositoryShapePolicy(policy);
});

test("application-collection requires a declared crate for shared protobuf schemas", () => {
  const root = createApplicationCollectionShapeFixture();
  for (const directory of ["crates/domain", "crates/proto/proto"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(
    join(root, "crates", "domain", "Cargo.toml"),
    '[package]\nname = "shared-domain"\n',
  );
  writeFileSync(
    join(root, "crates", "proto", "proto", "shared.proto"),
    'syntax = "proto3";\n',
  );
  const gitAdd = spawnSync(
    "git",
    ["add", "crates/domain/Cargo.toml", "crates/proto/proto/shared.proto"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const result = runFixtureScript(
    root,
    `context.assertRepositoryShapePolicy(${JSON.stringify({
      ...applicationCollectionShapePolicy,
      optionalLanes: ["crates"],
      crates: [{ path: "crates/domain", role: "domain" }],
    })});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /without a declared canonical proto crate/u);
});

test("repository shape policy accepts a canonical taxonomy layout", () => {
  const root = createDirectoryShapeFixture({
    directories: [
      "conformance",
      "consumers",
      "docs",
      "schema",
      "taxonomy",
      "tests",
      "views/identity",
      "views/ssi",
    ],
  });
  const context = createContext(root);

  context.assertRepositoryShapePolicy(taxonomyShapePolicy);
});

test("repository shape policy accepts an auditable conformance-suite layout", () => {
  const root = createDirectoryShapeFixture({
    directories: [
      "adapters",
      "docs",
      "evidence",
      "plans",
      "results",
      "schemas",
      "tests",
      "upstream",
    ],
  });
  const context = createContext(root);

  context.assertRepositoryShapePolicy(conformanceSuiteShapePolicy);
});

test("repository shape policy accepts a documentation-site layout", () => {
  const root = createDirectoryShapeFixture({
    directories: [
      "assets",
      "components",
      "conformance",
      "content/guides",
      "content/reference",
      "contracts",
      "examples",
      "localization",
      "snippets",
      "tests",
    ],
  });
  const context = createContext(root);

  context.assertRepositoryShapePolicy(documentationSiteShapePolicy);
});

test("documentation-site requires every content section to be declared", () => {
  const root = createDirectoryShapeFixture({
    directories: [
      "assets",
      "components",
      "conformance",
      "content/guides",
      "content/reference",
      "content/undeclared",
      "contracts",
      "examples",
      "localization",
      "snippets",
      "tests",
    ],
  });
  const result = runFixtureScript(
    root,
    `context.assertRepositoryShapePolicy(${JSON.stringify(documentationSiteShapePolicy)});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /undeclared content sublane undeclared/u);
});

test("hosted-service requires every service to be declared", () => {
  const root = createDirectoryShapeFixture({
    directories: [
      "conformance",
      "deploy",
      "docs",
      "operations",
      "services/api",
      "services/worker",
    ],
  });
  const acceptedPolicy = {
    archetype: "hosted-service",
    requiredLanes: [
      "services",
      "deploy",
      "operations",
      "conformance",
      "docs",
      "scripts",
      ".github",
    ],
    optionalLanes: [],
    exceptions: [],
    crates: [],
    subLanes: { services: ["api", "worker"] },
    forbiddenPaths: [],
    requireReleaseReadiness: true,
  };
  const context = createContext(root);
  context.assertRepositoryShapePolicy(acceptedPolicy);

  const policy = {
    ...acceptedPolicy,
    subLanes: { services: ["api"] },
  };
  const result = runFixtureScript(
    root,
    `context.assertRepositoryShapePolicy(${JSON.stringify(policy)});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /undeclared services sublane worker/u);
});

test("application-collection rejects protobuf schemas outside shared or application ownership", () => {
  const root = createApplicationCollectionShapeFixture();
  const misplacedPath = "apps/catalog/contracts/proto/legacy.proto";
  mkdirSync(join(root, misplacedPath, ".."), { recursive: true });
  writeFileSync(join(root, misplacedPath), 'syntax = "proto3";\n');
  const gitAdd = spawnSync("git", ["add", misplacedPath], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const result = runFixtureScript(
    root,
    `context.assertRepositoryShapePolicy(${JSON.stringify(applicationCollectionShapePolicy)});`,
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /requires shared protobuf schemas in crates\/proto and application-owned schemas in apps\/<app>\/contract\/proto/u,
  );
});

test("repository shape policy accepts a declared platform-workspace layout", () => {
  const root = createPlatformWorkspaceShapeFixture();
  const context = createContext(root);

  context.assertRepositoryShapePolicy(platformWorkspaceShapePolicy);
});

test("platform-workspace keeps protobuf schemas inside app-owned contracts", () => {
  const root = createPlatformWorkspaceShapeFixture();
  const misplacedPath = "apps/example/proto/example.proto";
  mkdirSync(join(root, misplacedPath, ".."), { recursive: true });
  writeFileSync(join(root, misplacedPath), "syntax = \"proto3\";\n");
  const gitAdd = spawnSync("git", ["add", misplacedPath], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const result = runFixtureScript(
    root,
    `context.assertRepositoryShapePolicy(${JSON.stringify(platformWorkspaceShapePolicy)});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires protobuf schemas in apps\/<app>\/contract\/proto/u);
});

test("repository shape policy rejects forbidden and undeclared root lanes", () => {
  for (const [path, expected] of [
    ["proto/schema.proto", /forbids root lane proto/u],
    ["tests/protocol.test.mjs", /forbids root lane tests/u],
    ["misc/notes.md", /undeclared root lane misc/u],
  ]) {
    const root = createProtocolShapeFixture();
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), "tracked\n");
    const gitAdd = spawnSync("git", ["add", path], { cwd: root, encoding: "utf8" });
    assert.equal(gitAdd.status, 0, gitAdd.stderr);
    const result = runFixtureScript(
      root,
      `context.assertRepositoryShapePolicy(${JSON.stringify(protocolShapePolicy)});`,
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  }
});

test("repository shape policy requires proto-codec to accompany canonical proto", () => {
  const root = createProtocolShapeFixture();
  const gitRemove = spawnSync("git", ["rm", "-r", "-f", "crates/proto"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitRemove.status, 0, gitRemove.stderr);
  const policy = {
    ...protocolShapePolicy,
    crates: [
      { path: "crates/openid4vci", role: "domain" },
      { path: "crates/proto-codec", role: "proto-codec" },
    ],
  };
  const result = runFixtureScript(
    root,
    `context.assertRepositoryShapePolicy(${JSON.stringify(policy)});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /proto-codec requires a canonical proto crate/u);
});

test("repository shape policy rejects compatibility proto packages regardless of role", () => {
  const root = createProtocolShapeFixture();
  const compatibilityPath = "crates/proto-credential";
  mkdirSync(join(root, compatibilityPath), { recursive: true });
  writeFileSync(
    join(root, compatibilityPath, "Cargo.toml"),
    '[package]\nname = "proto-credential"\n',
  );
  const gitAdd = spawnSync("git", ["add", compatibilityPath], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const policy = {
    ...protocolShapePolicy,
    crates: [
      ...protocolShapePolicy.crates,
      { path: compatibilityPath, role: "support" },
    ],
  };
  const result = runFixtureScript(
    root,
    `context.assertRepositoryShapePolicy(${JSON.stringify(policy)});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /forbids compatibility proto package crates\/proto-credential/u);
});

test("repository shape policy rejects schemas and nested crates outside the canonical boundary", () => {
  const cases = [
    {
      path: "crates/openid4vci/schema.proto",
      content: "syntax = \"proto3\";\n",
      expected: /every protobuf schema inside crates\/proto/u,
    },
    {
      path: "crates/proto/nested/Cargo.toml",
      content: "[package]\nname = \"nested\"\n",
      expected: /Cargo crate crates\/proto\/nested is undeclared/u,
    },
  ];
  for (const entry of cases) {
    const root = createProtocolShapeFixture();
    mkdirSync(join(root, entry.path, ".."), { recursive: true });
    writeFileSync(join(root, entry.path), entry.content);
    const gitAdd = spawnSync("git", ["add", entry.path], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(gitAdd.status, 0, gitAdd.stderr);
    const result = runFixtureScript(
      root,
      `context.assertRepositoryShapePolicy(${JSON.stringify(protocolShapePolicy)});`,
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, entry.expected);
  }
});

test("repository shape policy validates declared sublanes", () => {
  const root = createProtocolShapeFixture();
  mkdirSync(join(root, "bindings", "ffi"), { recursive: true });
  mkdirSync(join(root, "bindings", "internal"), { recursive: true });
  writeFileSync(join(root, "bindings", "ffi", "README.md"), "ffi\n");
  writeFileSync(join(root, "bindings", "internal", "README.md"), "internal\n");
  const gitAdd = spawnSync("git", ["add", "bindings"], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const policy = {
    ...protocolShapePolicy,
    optionalLanes: ["bindings"],
    subLanes: { bindings: ["ffi"] },
  };
  const result = runFixtureScript(
    root,
    `context.assertRepositoryShapePolicy(${JSON.stringify(policy)});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /undeclared bindings sublane internal/u);
});

test("repository shape policy accepts a fully declared developer-platform layout", () => {
  const root = createFixture();
  const subLanes = {
    bindings: ["ffi", "jni", "wasm"],
    gen: ["swift", "kotlin", "java", "typescript"],
    packages: ["swift", "kotlin", "kotlin-android", "ts"],
  };
  for (const [parent, children] of Object.entries(subLanes)) {
    for (const child of children) {
      mkdirSync(join(root, parent, child), { recursive: true });
      writeFileSync(join(root, parent, child, "README.md"), `${parent}/${child}\n`);
    }
  }
  for (const lane of ["examples", "contracts", "conformance", "docs"]) {
    mkdirSync(join(root, lane), { recursive: true });
    writeFileSync(join(root, lane, "README.md"), `${lane}\n`);
  }
  mkdirSync(join(root, "scripts", "release-readiness"), { recursive: true });
  copyFileSync(
    new URL("../core.mjs", import.meta.url),
    join(root, "scripts", "release-readiness", "core.mjs"),
  );
  writeFileSync(join(root, "scripts", "check_release_readiness.mjs"), "export {};\n");
  const gitInit = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const gitAdd = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const context = createContext(root);

  context.assertRepositoryShapePolicy({
    archetype: "developer-platform",
    requiredLanes: [
      "bindings",
      "gen",
      "packages",
      "examples",
      "contracts",
      "conformance",
      "docs",
      "scripts",
      ".github",
    ],
    optionalLanes: [],
    exceptions: [],
    crates: [],
    subLanes,
    forbiddenPaths: [],
    requireReleaseReadiness: true,
  });
});

test("repository shape policy accepts a runtime-composition layout", () => {
  const root = createFixture();
  for (const directory of [
    "configs",
    "contracts",
    "conformance",
    "crates/server",
    "deploy",
    "docs",
    "scripts/release-readiness",
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  copyFileSync(
    new URL("../core.mjs", import.meta.url),
    join(root, "scripts", "release-readiness", "core.mjs"),
  );
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\nmembers = []\n");
  writeFileSync(join(root, "configs", "server.jsonc"), "{}\n");
  writeFileSync(join(root, "contracts", "composition.md"), "contract\n");
  writeFileSync(join(root, "conformance", "README.md"), "conformance\n");
  writeFileSync(join(root, "crates", "server", "Cargo.toml"), "[package]\nname = \"server\"\n");
  writeFileSync(join(root, "deploy", "README.md"), "deployment\n");
  writeFileSync(join(root, "docs", "architecture.md"), "architecture\n");
  writeFileSync(join(root, "scripts", "check_release_readiness.mjs"), "export {};\n");
  const gitInit = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const gitAdd = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const context = createContext(root);

  context.assertRepositoryShapePolicy({
    archetype: "runtime-composition",
    requiredLanes: [
      "crates",
      "configs",
      "deploy",
      "contracts",
      "conformance",
      "docs",
      "scripts",
      ".github",
    ],
    optionalLanes: [],
    exceptions: [],
    crates: [{ path: "crates/server", role: "runtime" }],
    subLanes: {},
    forbiddenPaths: [],
    requireReleaseReadiness: true,
  });
});

test("repository shape policy accepts an organization-neutral infrastructure layout", () => {
  const root = createFixture();
  for (const directory of [
    "configuration/ansible",
    "deployments/containers",
    "docs",
    "networking/load-balancers",
    "observability/metrics",
    "operations/catalogs",
    "provisioning/tofu",
    "scripts/release-readiness",
    "topology",
    "tools",
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, directory, "README.md"), `${directory}\n`);
  }
  copyFileSync(
    new URL("../core.mjs", import.meta.url),
    join(root, "scripts", "release-readiness", "core.mjs"),
  );
  writeFileSync(join(root, "scripts", "check_release_readiness.mjs"), "export {};\n");
  const gitInit = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const gitAdd = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const context = createContext(root);

  context.assertRepositoryShapePolicy({
    archetype: "infrastructure",
    requiredLanes: ["deployments", "operations", "docs", "scripts", ".github"],
    optionalLanes: [
      "configuration",
      "networking",
      "observability",
      "provisioning",
      "topology",
      "tools",
    ],
    exceptions: [],
    crates: [],
    subLanes: {},
    forbiddenPaths: [],
    requireReleaseReadiness: true,
  });
});

test("repository shape policy accepts matched typed exceptions and rejects stale ones", () => {
  const root = createProtocolShapeFixture();
  mkdirSync(join(root, "vendor"), { recursive: true });
  writeFileSync(join(root, "vendor", "NOTICE"), "third-party\n");
  const gitAdd = spawnSync("git", ["add", "vendor/NOTICE"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const policy = {
    ...protocolShapePolicy,
    exceptions: [{ path: "vendor", reason: "vendored" }],
  };
  const context = createContext(root);
  context.assertRepositoryShapePolicy(policy);

  const stale = {
    ...policy,
    exceptions: [
      { path: "vendor", reason: "vendored" },
      { path: ".devcontainer", reason: "build-tool" },
    ],
  };
  const result = runFixtureScript(
    root,
    `context.assertRepositoryShapePolicy(${JSON.stringify(stale)});`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exception \.devcontainer does not match a tracked root lane/u);
});

test("repository shape policy keeps reusable vectors out of conformance fixtures", () => {
  const root = createProtocolShapeFixture();
  mkdirSync(join(root, "conformance", "vectors"), { recursive: true });
  writeFileSync(join(root, "conformance", "vectors", "credential.json"), "{}\n");
  const gitAdd = spawnSync("git", ["add", "conformance/vectors/credential.json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const result = runFixtureScript(
    root,
    `context.assertRepositoryShapePolicy(${JSON.stringify(protocolShapePolicy)});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /reusable vectors at root vectors/u);
});

test("repository shape policy allows only tooling to omit release readiness", () => {
  const root = createProtocolShapeFixture();
  const policy = {
    ...protocolShapePolicy,
    requireReleaseReadiness: false,
  };
  const result = runFixtureScript(
    root,
    `context.assertRepositoryShapePolicy(${JSON.stringify(policy)});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /disabling release readiness only for tooling/u);
});

test("Rust source policy enforces a shrinking-only source-size baseline", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "crates", "example", "src"), { recursive: true });
  mkdirSync(join(root, "scripts", "policy"), { recursive: true });
  const sourcePath = "crates/example/src/worker.rs";
  writeFileSync(join(root, sourcePath), "one\ntwo\nthree\nfour\nfive\nsix\nseven\n");
  writeFileSync(
    join(root, "scripts", "policy", "source-size-baseline.tsv"),
    `${sourcePath}\t7\n`,
  );
  const gitAdd = spawnSync(
    "git",
    ["add", sourcePath, "scripts/policy/source-size-baseline.tsv"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const context = createContext(root);
  const policy = {
    roots: ["crates"],
    baselinePath: "scripts/policy/source-size-baseline.tsv",
    productionTargetLines: 5,
    productionHardLines: 10,
    testTargetLines: 8,
    testHardLines: 12,
    moduleHardLines: 4,
  };

  context.assertRustSourcePolicy(policy);

  writeFileSync(
    join(root, sourcePath),
    "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n",
  );
  const result = runFixtureScript(
    root,
    `context.assertRustSourcePolicy(${JSON.stringify(policy)});`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /grew from its baseline 7 to 8 lines/u);
});

test("Rust source policy rejects wildcard imports", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "crates", "example", "src"), { recursive: true });
  writeFileSync(
    join(root, "crates", "example", "src", "worker.rs"),
    `use crate::internal::{
    Item,
    *,
};

pub fn work() {}
`,
  );
  const gitAdd = spawnSync("git", ["add", "crates/example/src/worker.rs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const result = runFixtureScript(
    root,
    `context.assertRustSourcePolicy({
  roots: ["crates"],
  productionTargetLines: 10,
  productionHardLines: 20,
  testTargetLines: 20,
  testHardLines: 30,
  moduleHardLines: 10,
});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /worker\.rs must not use a wildcard import/u);
});

test("Rust source policy governs tracked Rust outside crates by default", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "bindings", "ffi", "src"), { recursive: true });
  writeFileSync(
    join(root, "bindings", "ffi", "src", "create.rs"),
    "pub fn create() {}\n",
  );
  const gitAdd = spawnSync("git", ["add", "bindings/ffi/src/create.rs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const context = createContext(root);

  context.assertRustSourcePolicy();
});

test("Rust source policy caps production and example files at 500 lines by default", () => {
  for (const sourcePath of [
    "crates/example/src/implementation.rs",
    "crates/example/examples/issuer.rs",
  ]) {
    const root = createTrackedFixture();
    mkdirSync(join(root, sourcePath, ".."), { recursive: true });
    writeFileSync(join(root, sourcePath), `${"line\n".repeat(501)}`);
    const gitAdd = spawnSync("git", ["add", sourcePath], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(gitAdd.status, 0, gitAdd.stderr);
    const result = runFixtureScript(
      root,
      "context.assertRustSourcePolicy({ roots: [\"crates\"] });",
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /501 lines, exceeding its hard limit 500/u);
  }
});

test("Rust source policy does not allow a consumer to raise hard ceilings", () => {
  const root = createTrackedFixture();
  const sourcePath = "crates/example/src/create.rs";
  mkdirSync(join(root, "crates", "example", "src"), { recursive: true });
  writeFileSync(join(root, sourcePath), "pub fn create() {}\n");
  const gitAdd = spawnSync("git", ["add", sourcePath], { cwd: root, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);

  let result = runFixtureScript(
    root,
    `context.assertRustSourcePolicy({
  roots: ["crates"],
  productionHardLines: 501,
});`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /production hard limit cannot exceed 500 lines/u);

  result = runFixtureScript(
    root,
    `context.assertRustSourcePolicy({
  roots: ["crates"],
  testHardLines: 801,
});`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /separate-test hard limit cannot exceed 800 lines/u);
});

test("Rust source policy rejects uncovered source and untyped generated exclusions", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "crates", "example", "src"), { recursive: true });
  mkdirSync(join(root, "outside"), { recursive: true });
  writeFileSync(join(root, "crates", "example", "src", "create.rs"), "pub fn create() {}\n");
  writeFileSync(join(root, "outside", "create.rs"), "pub fn create() {}\n");
  const gitAdd = spawnSync("git", ["add", "crates", "outside"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);

  let result = runFixtureScript(
    root,
    'context.assertRustSourcePolicy({ roots: ["crates"] });',
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /source roots do not govern tracked source outside\/create.rs/u);

  result = runFixtureScript(
    root,
    `context.assertRustSourcePolicy({
  roots: ["crates"],
  generatedPrefixes: ["outside"],
});`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must identify a gen or generated path/u);
});

test("Rust source policy allows 800 lines only in separate test files", () => {
  const root = createTrackedFixture();
  const sourcePath = "crates/example/tests/integration.rs";
  mkdirSync(join(root, sourcePath, ".."), { recursive: true });
  writeFileSync(join(root, sourcePath), "line\n".repeat(800));
  let gitAdd = spawnSync("git", ["add", sourcePath], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  let result = runFixtureScript(
    root,
    "context.assertRustSourcePolicy({ roots: [\"crates\"] });",
  );
  assert.equal(result.status, 0, result.stderr);

  writeFileSync(join(root, sourcePath), "line\n".repeat(801));
  gitAdd = spawnSync("git", ["add", sourcePath], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  result = runFixtureScript(
    root,
    "context.assertRustSourcePolicy({ roots: [\"crates\"] });",
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /801 lines, exceeding its hard limit 800/u);
});

test("Rust source policy requires test implementations to live in separate files", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "crates", "example", "src"), { recursive: true });
  writeFileSync(
    join(root, "crates", "example", "src", "implementation.rs"),
    `pub fn implementation() {}

#[cfg(test)]
mod tests {
    #[test]
    fn implementation_works() {}
}
`,
  );
  let gitAdd = spawnSync("git", ["add", "crates/example/src/implementation.rs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  let result = runFixtureScript(
    root,
    "context.assertRustSourcePolicy({ roots: [\"crates\"] });",
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must keep test implementations in a separate test file/u);

  writeFileSync(
    join(root, "crates", "example", "src", "implementation.rs"),
    `const POLICY_EXAMPLE: &str = r#"#[test] use crate::internal::*; panic!(); Result<(), String>"#;

/*
#[cfg(test)]
mod commented_out_tests {
    use crate::internal::*;
    panic!("commented out");
}
*/

pub fn implementation() {}

#[cfg(test)]
mod tests;
`,
  );
  writeFileSync(
    join(root, "crates", "example", "src", "tests.rs"),
    `#[test]
fn implementation_works() {}
`,
  );
  gitAdd = spawnSync(
    "git",
    ["add", "crates/example/src/implementation.rs", "crates/example/src/tests.rs"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  result = runFixtureScript(
    root,
    "context.assertRustSourcePolicy({ roots: [\"crates\"] });",
  );
  assert.equal(result.status, 0, result.stderr);

  writeFileSync(
    join(root, "crates", "example", "src", "implementation.rs"),
    `pub fn implementation() {}

#[cfg(test)]
#[path = "implementation_tests.rs"]
mod tests;
`,
  );
  writeFileSync(
    join(root, "crates", "example", "src", "implementation_tests.rs"),
    `#[test]
fn implementation_works_from_sibling_file() {}
`,
  );
  gitAdd = spawnSync(
    "git",
    [
      "add",
      "crates/example/src/implementation.rs",
      "crates/example/src/implementation_tests.rs",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  result = runFixtureScript(
    root,
    "context.assertRustSourcePolicy({ roots: [\"crates\"] });",
  );
  assert.equal(result.status, 0, result.stderr);
});

test("Rust source policy keeps lib.rs and mod.rs as thin facades", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "crates", "example", "src"), { recursive: true });
  writeFileSync(
    join(root, "crates", "example", "src", "lib.rs"),
    "pub fn create() {}\n",
  );
  let gitAdd = spawnSync("git", ["add", "crates/example/src/lib.rs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  let result = runFixtureScript(
    root,
    "context.assertRustSourcePolicy({ roots: [\"crates\"] });",
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lib\.rs must remain a declaration-and-re-export-only facade/u);

  writeFileSync(
    join(root, "crates", "example", "src", "lib.rs"),
    "pub mod create;\npub use create::create;\n",
  );
  writeFileSync(
    join(root, "crates", "example", "src", "create.rs"),
    "pub fn create() {}\n",
  );
  gitAdd = spawnSync(
    "git",
    ["add", "crates/example/src/lib.rs", "crates/example/src/create.rs"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  result = runFixtureScript(
    root,
    "context.assertRustSourcePolicy({ roots: [\"crates\"] });",
  );
  assert.equal(result.status, 0, result.stderr);
});

test("Rust source policy rejects panic shortcuts and dynamic error surfaces", () => {
  for (const [source, expected] of [
    ["pub fn create() { panic!(\"failed\"); }\n", /forbidden production panic macro/u],
    [
      "pub fn create() -> Result<(), String> { Err(String::new()) }\n",
      /forbidden string Result error/u,
    ],
    [
      "pub enum CreateError { Invalid(String) }\n",
      /error definition CreateError contains a dynamic or string field/u,
    ],
  ]) {
    const root = createTrackedFixture();
    mkdirSync(join(root, "crates", "example", "src"), { recursive: true });
    writeFileSync(join(root, "crates", "example", "src", "create.rs"), source);
    const gitAdd = spawnSync("git", ["add", "crates/example/src/create.rs"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(gitAdd.status, 0, gitAdd.stderr);
    const result = runFixtureScript(
      root,
      "context.assertRustSourcePolicy({ roots: [\"crates\"] });",
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  }
});

test("TypeScript source policy accepts strict, typed, separately tested code", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "tsconfig.json"),
    `${JSON.stringify(typeScriptConfiguration, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "src", "create.ts"),
    `export type CreateErrorCode = "invalid-input";

export class CreateError extends Error {
  public readonly code: CreateErrorCode;

  public constructor(code: CreateErrorCode) {
    super(code);
    this.code = code;
  }
}

export const create = (input: unknown): Readonly<{ value: unknown }> => ({ value: input });
`,
  );
  writeFileSync(
    join(root, "src", "create.test.ts"),
    `test("create", () => {
  // @ts-expect-error -- malicious input must remain rejected by the type surface
  const invalid: never = "invalid";
  void invalid;
});
`,
  );
  const gitAdd = spawnSync("git", ["add", "tsconfig.json", "src"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const context = createContext(root);

  context.assertTypeScriptSourcePolicy({
    roots: ["src"],
    tsconfigPaths: ["tsconfig.json"],
    staticAnalysis: typeScriptStaticAnalysis,
    verification: verificationPolicy(["typecheck", "lint", "test"]),
  });
});

test("TypeScript source policy rejects unsafe and structurally weak production code", () => {
  const cases = [
    ["export const value: any = 1;\n", /forbidden TypeScript any/u],
    ['export * from "./internal.js";\n', /wildcard import or export/u],
    ["test(\"embedded\", () => undefined);\n", /separate test file/u],
    ["export const value = candidate!;\n", /unsafe TypeScript assertion/u],
    ["export const value = candidate as unknown;\n", /unsafe TypeScript assertion/u],
    ["export const create = () => { throw new Error(\"failed\"); };\n", /untyped TypeScript failure/u],
    ["// @ts-ignore\nexport const value = 1;\n", /forbidden TypeScript or ESLint suppression/u],
  ];
  for (const [source, expected] of cases) {
    const root = createTrackedFixture();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "tsconfig.json"), `${JSON.stringify(typeScriptConfiguration)}\n`);
    writeFileSync(join(root, "src", "create.ts"), source);
    const gitAdd = spawnSync("git", ["add", "tsconfig.json", "src/create.ts"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(gitAdd.status, 0, gitAdd.stderr);
    const result = runFixtureScript(
      root,
      `context.assertTypeScriptSourcePolicy(${JSON.stringify({
        roots: ["src"],
        tsconfigPaths: ["tsconfig.json"],
        staticAnalysis: typeScriptStaticAnalysis,
        verification: verificationPolicy(["typecheck", "lint", "test"]),
      })});`,
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  }
});

test("TypeScript source policy requires explicit strict compiler options and thin facades", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "src"), { recursive: true });
  const incompleteConfiguration = structuredClone(typeScriptConfiguration);
  delete incompleteConfiguration.compilerOptions.noUncheckedIndexedAccess;
  writeFileSync(join(root, "tsconfig.json"), `${JSON.stringify(incompleteConfiguration)}\n`);
  writeFileSync(join(root, "src", "index.ts"), "export const create = () => 1;\n");
  const gitAdd = spawnSync("git", ["add", "tsconfig.json", "src/index.ts"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const policy = {
    roots: ["src"],
    tsconfigPaths: ["tsconfig.json"],
    staticAnalysis: typeScriptStaticAnalysis,
    verification: verificationPolicy(["typecheck", "lint", "test"]),
  };
  let result = runFixtureScript(
    root,
    `context.assertTypeScriptSourcePolicy(${JSON.stringify(policy)});`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /noUncheckedIndexedAccess must be explicitly true/u);

  writeFileSync(join(root, "tsconfig.json"), `${JSON.stringify(typeScriptConfiguration)}\n`);
  result = runFixtureScript(
    root,
    `context.assertTypeScriptSourcePolicy(${JSON.stringify(policy)});`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /index\.ts must remain an explicit import, export, and type-only facade/u);
});

test("Swift source policy accepts typed throws and separately located tests", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "Sources", "Identity"), { recursive: true });
  mkdirSync(join(root, "Tests", "IdentityTests"), { recursive: true });
  writeFileSync(
    join(root, "Package.swift"),
    "// StrictConcurrency\n// warnings-as-errors\n",
  );
  writeFileSync(
    join(root, "Sources", "Identity", "create.swift"),
    `enum CreateError: Error { case invalidInput }

func create() throws(CreateError) {}
`,
  );
  writeFileSync(
    join(root, "Tests", "IdentityTests", "CreateTests.swift"),
    "final class CreateTests: XCTestCase {}\n",
  );
  const gitAdd = spawnSync("git", ["add", "Package.swift", "Sources", "Tests"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const context = createContext(root);

  context.assertSwiftSourcePolicy({
    roots: ["Sources", "Tests"],
    configuration: {
      files: [{ path: "Package.swift", required: ["StrictConcurrency", "warnings-as-errors"] }],
    },
    verification: verificationPolicy(["format", "lint", "build", "test"]),
  });
});

test("Swift source policy rejects unsafe operations, untyped errors, and escape hatches", () => {
  const cases = [
    ["func create() { _ = try! operation() }\n", /unsafe or terminating Swift operation/u],
    ["func create() throws {}\n", /typed throws or a typed Result/u],
    ["func create() { fatalError() }\n", /unsafe or terminating Swift operation/u],
    ["final class EmbeddedTests: XCTestCase {}\n", /separate test file/u],
    ["struct Value: @unchecked Sendable {}\n", /concurrency escape hatch/u],
    ["// swiftlint:disable all\nfunc create() {}\n", /SwiftLint suppression/u],
  ];
  for (const [source, expected] of cases) {
    const root = createTrackedFixture();
    mkdirSync(join(root, "Sources", "Identity"), { recursive: true });
    writeFileSync(join(root, "Package.swift"), "// StrictConcurrency\n");
    writeFileSync(join(root, "Sources", "Identity", "create.swift"), source);
    const gitAdd = spawnSync("git", ["add", "Package.swift", "Sources"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(gitAdd.status, 0, gitAdd.stderr);
    const result = runFixtureScript(
      root,
      `context.assertSwiftSourcePolicy(${JSON.stringify({
        roots: ["Sources"],
        configuration: {
          files: [{ path: "Package.swift", required: ["StrictConcurrency"] }],
        },
        verification: verificationPolicy(["format", "lint", "build", "test"]),
      })});`,
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  }
});

test("Kotlin source policy accepts explicit API configuration and separate tests", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "src", "main", "kotlin"), { recursive: true });
  mkdirSync(join(root, "src", "test", "kotlin"), { recursive: true });
  writeFileSync(
    join(root, "build.gradle.kts"),
    "explicitApi()\nallWarningsAsErrors = true\n",
  );
  writeFileSync(
    join(root, "src", "main", "kotlin", "Create.kt"),
    `sealed interface CreateOutcome
data object Created : CreateOutcome
fun create(): CreateOutcome = Created
`,
  );
  writeFileSync(
    join(root, "src", "test", "kotlin", "CreateTest.kt"),
    "@Test fun createSucceeds() {}\n",
  );
  const gitAdd = spawnSync("git", ["add", "build.gradle.kts", "src"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const context = createContext(root);

  context.assertKotlinSourcePolicy({
    roots: ["src"],
    configuration: {
      files: [
        {
          path: "build.gradle.kts",
          required: ["explicitApi()", "allWarningsAsErrors = true"],
        },
      ],
    },
    verification: verificationPolicy(["format", "static-analysis", "compile", "test"]),
  });
});

test("Kotlin source policy rejects unsafe operations and weak boundaries", () => {
  const cases = [
    ["fun create(value: String?) = value!!\n", /unsafe or terminating Kotlin operation/u],
    ["fun create(): Nothing = error(\"failed\")\n", /unsafe or terminating Kotlin operation/u],
    ["fun create(value: Any) = value as String\n", /unsafe Kotlin cast/u],
    ["fun create(): Nothing = throw RuntimeException()\n", /generic Kotlin error/u],
    ["@Suppress(\"UNCHECKED_CAST\")\nfun create() {}\n", /Kotlin suppression/u],
    ["import example.internal.*\nfun create() {}\n", /wildcard Kotlin import/u],
    ["lateinit var value: String\n", /Kotlin lateinit state/u],
    ["@Test fun embeddedTest() {}\n", /separate test file/u],
  ];
  for (const [source, expected] of cases) {
    const root = createTrackedFixture();
    mkdirSync(join(root, "src", "main", "kotlin"), { recursive: true });
    writeFileSync(join(root, "build.gradle.kts"), "explicitApi()\n");
    writeFileSync(join(root, "src", "main", "kotlin", "Create.kt"), source);
    const gitAdd = spawnSync("git", ["add", "build.gradle.kts", "src"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(gitAdd.status, 0, gitAdd.stderr);
    const result = runFixtureScript(
      root,
      `context.assertKotlinSourcePolicy(${JSON.stringify({
        roots: ["src"],
        configuration: {
          files: [{ path: "build.gradle.kts", required: ["explicitApi()"] }],
        },
        verification: verificationPolicy(["format", "static-analysis", "compile", "test"]),
      })});`,
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  }
});

test("language verification policies require every native-tooling role", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "tsconfig.json"), `${JSON.stringify(typeScriptConfiguration)}\n`);
  writeFileSync(join(root, "src", "create.ts"), "export type Created = Readonly<{}>;\n");
  const gitAdd = spawnSync("git", ["add", "tsconfig.json", "src/create.ts"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const result = runFixtureScript(
    root,
    `context.assertTypeScriptSourcePolicy(${JSON.stringify({
      roots: ["src"],
      tsconfigPaths: ["tsconfig.json"],
      staticAnalysis: typeScriptStaticAnalysis,
      verification: verificationPolicy(["typecheck", "lint"]),
    })});`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing the test role/u);
});

test("cross-language source limits preserve the 500 and 800 line ceilings", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "tsconfig.json"), `${JSON.stringify(typeScriptConfiguration)}\n`);
  writeFileSync(join(root, "src", "create.ts"), "type Value = number;\n".repeat(501));
  writeFileSync(join(root, "src", "create.test.ts"), "type Value = number;\n".repeat(800));
  const gitAdd = spawnSync("git", ["add", "tsconfig.json", "src"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const policy = {
    roots: ["src"],
    tsconfigPaths: ["tsconfig.json"],
    staticAnalysis: typeScriptStaticAnalysis,
    verification: verificationPolicy(["typecheck", "lint", "test"]),
  };
  let result = runFixtureScript(
    root,
    `context.assertTypeScriptSourcePolicy(${JSON.stringify(policy)});`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /create\.ts has 501 lines, exceeding its hard limit 500/u);

  writeFileSync(join(root, "src", "create.ts"), "export type Value = number;\n");
  writeFileSync(join(root, "src", "create.test.ts"), "type Value = number;\n".repeat(801));
  result = runFixtureScript(
    root,
    `context.assertTypeScriptSourcePolicy(${JSON.stringify(policy)});`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /create\.test\.ts has 801 lines, exceeding its hard limit 800/u);
});

test("cross-language source policies cannot raise the contract ceilings", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "tsconfig.json"), `${JSON.stringify(typeScriptConfiguration)}\n`);
  writeFileSync(join(root, "src", "create.ts"), "export type Value = number;\n");
  const gitAdd = spawnSync("git", ["add", "tsconfig.json", "src"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const policy = {
    roots: ["src"],
    productionHardLines: 501,
    tsconfigPaths: ["tsconfig.json"],
    staticAnalysis: typeScriptStaticAnalysis,
    verification: verificationPolicy(["typecheck", "lint", "test"]),
  };

  const result = runFixtureScript(
    root,
    `context.assertTypeScriptSourcePolicy(${JSON.stringify(policy)});`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /production hard limit cannot exceed 500 lines/u);
});

test("cross-language baselines shrink and generated source stays explicitly excluded", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "src", "generated"), { recursive: true });
  mkdirSync(join(root, "scripts", "policy"), { recursive: true });
  writeFileSync(join(root, "tsconfig.json"), `${JSON.stringify(typeScriptConfiguration)}\n`);
  writeFileSync(join(root, "src", "legacy.ts"), "type Value = number;\n".repeat(6));
  writeFileSync(
    join(root, "src", "generated", "unsafe.ts"),
    "export const value: any = 1;\n".repeat(1_000),
  );
  writeFileSync(
    join(root, "scripts", "policy", "typescript-size-baseline.tsv"),
    "src/legacy.ts\t6\n",
  );
  const gitAdd = spawnSync("git", ["add", "tsconfig.json", "src", "scripts/policy"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const policy = {
    roots: ["src"],
    generatedPrefixes: ["src/generated"],
    baselinePath: "scripts/policy/typescript-size-baseline.tsv",
    productionTargetLines: 5,
    productionHardLines: 10,
    testTargetLines: 8,
    testHardLines: 12,
    facadeHardLines: 10,
    tsconfigPaths: ["tsconfig.json"],
    staticAnalysis: typeScriptStaticAnalysis,
    verification: verificationPolicy(["typecheck", "lint", "test"]),
  };
  const context = createContext(root);
  context.assertTypeScriptSourcePolicy(policy);

  writeFileSync(join(root, "src", "legacy.ts"), "type Value = number;\n".repeat(7));
  const result = runFixtureScript(
    root,
    `context.assertTypeScriptSourcePolicy(${JSON.stringify(policy)});`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /legacy\.ts grew from its baseline 6 to 7 lines/u);
});

test("Swift and Kotlin facade policies reject substantive configured entrypoints", () => {
  const cases = [
    {
      language: "Swift",
      configurationPath: "Package.swift",
      configurationText: "// StrictConcurrency\n",
      sourcePath: "Sources/Identity/Exports.swift",
      source: "public func create() {}\n",
      body: (verification) => `context.assertSwiftSourcePolicy({
  roots: ["Sources"],
  facadeFiles: ["Sources/Identity/Exports.swift"],
  configuration: { files: [{ path: "Package.swift", required: ["StrictConcurrency"] }] },
  verification: ${JSON.stringify(verification)},
});`,
      expected: /declaration-and-re-export-only Swift facade/u,
      roles: ["format", "lint", "build", "test"],
    },
    {
      language: "Kotlin",
      configurationPath: "build.gradle.kts",
      configurationText: "explicitApi()\n",
      sourcePath: "src/main/kotlin/Identity.kt",
      source: "public fun create() = Unit\n",
      body: (verification) => `context.assertKotlinSourcePolicy({
  roots: ["src"],
  facadeFiles: ["src/main/kotlin/Identity.kt"],
  configuration: { files: [{ path: "build.gradle.kts", required: ["explicitApi()"] }] },
  verification: ${JSON.stringify(verification)},
});`,
      expected: /declaration-and-re-export-only Kotlin facade/u,
      roles: ["format", "static-analysis", "compile", "test"],
    },
  ];
  for (const entry of cases) {
    const root = createTrackedFixture();
    mkdirSync(join(root, entry.sourcePath, ".."), { recursive: true });
    writeFileSync(join(root, entry.configurationPath), entry.configurationText);
    writeFileSync(join(root, entry.sourcePath), entry.source);
    const gitAdd = spawnSync("git", ["add", entry.configurationPath, entry.sourcePath], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(gitAdd.status, 0, gitAdd.stderr);
    const result = runFixtureScript(
      root,
      entry.body(verificationPolicy(entry.roles)),
    );

    assert.equal(result.status, 1, entry.language);
    assert.match(result.stderr, entry.expected);
  }
});

test("language source policies ignore forbidden tokens inside string literals", () => {
  const root = createTrackedFixture();
  mkdirSync(join(root, "typescript"), { recursive: true });
  mkdirSync(join(root, "swift"), { recursive: true });
  mkdirSync(join(root, "kotlin"), { recursive: true });
  writeFileSync(join(root, "tsconfig.json"), `${JSON.stringify(typeScriptConfiguration)}\n`);
  writeFileSync(
    join(root, "typescript", "create.ts"),
    'export const marker = "// @ts-ignore any throw new Error";\n',
  );
  writeFileSync(join(root, "Package.swift"), "// StrictConcurrency\n");
  writeFileSync(
    join(root, "swift", "create.swift"),
    'let marker = "// swiftlint:disable all try! fatalError()"\n',
  );
  writeFileSync(join(root, "build.gradle.kts"), "explicitApi()\n");
  writeFileSync(
    join(root, "kotlin", "Create.kt"),
    'val marker = "@Suppress !! error() RuntimeException()"\n',
  );
  const gitAdd = spawnSync(
    "git",
    ["add", "tsconfig.json", "Package.swift", "build.gradle.kts", "typescript", "swift", "kotlin"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(gitAdd.status, 0, gitAdd.stderr);
  const context = createContext(root);

  context.assertTypeScriptSourcePolicy({
    roots: ["typescript"],
    tsconfigPaths: ["tsconfig.json"],
    staticAnalysis: typeScriptStaticAnalysis,
    verification: verificationPolicy(["typecheck", "lint", "test"]),
  });
  context.assertSwiftSourcePolicy({
    roots: ["swift"],
    configuration: {
      files: [{ path: "Package.swift", required: ["StrictConcurrency"] }],
    },
    verification: verificationPolicy(["format", "lint", "build", "test"]),
  });
  context.assertKotlinSourcePolicy({
    roots: ["kotlin"],
    configuration: {
      files: [{ path: "build.gradle.kts", required: ["explicitApi()"] }],
    },
    verification: verificationPolicy(["format", "static-analysis", "compile", "test"]),
  });
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

test("granular provider boundary requires correlated typed turns and retired-path removal", () => {
  const root = createFixture();
  const context = createContext(root);
  writeFileSync(
    join(root, "provider.proto"),
    `syntax = "proto3";
enum IdentityProtocolVersion {
  IDENTITY_PROTOCOL_VERSION_UNSPECIFIED = 0;
  IDENTITY_PROTOCOL_VERSION_V1 = 1;
}
enum IdentityProviderCapability {
  IDENTITY_PROVIDER_CAPABILITY_UNSPECIFIED = 0;
  IDENTITY_PROVIDER_CAPABILITY_RESOLVE = 1;
}
enum IdentityProviderErrorReason {
  IDENTITY_PROVIDER_ERROR_REASON_UNSPECIFIED = 0;
  IDENTITY_PROVIDER_ERROR_REASON_REJECTED = 1;
}
message IdentityProviderDescriptor {
  IdentityProtocolVersion protocol_version = 1;
  repeated IdentityProviderCapability capabilities = 2;
  uint32 max_response_bytes = 3;
}
message IdentityProviderRequest {
  uint64 executor_id = 1;
  uint64 sequence = 2;
  oneof operation {
    ResolveRequest resolve = 10;
  }
}
message IdentityProviderResult {
  oneof result {
    ResolveResult resolve = 10;
  }
}
message IdentityProviderError {
  IdentityProviderErrorReason reason = 1;
}
message IdentityProviderResponse {
  uint64 executor_id = 1;
  uint64 sequence = 2;
  oneof outcome {
    IdentityProviderResult result = 3;
    IdentityProviderError error = 4;
  }
}
message ResolveRequest { string did = 1; }
message ResolveResult { bytes document = 1; }
`,
  );
  writeFileSync(
    join(root, "codec.rs"),
    "decode_provider_response validate_result unknown_fields\n",
  );
  writeFileSync(
    join(root, "runtime.rs"),
    "ProviderTransport response.executor_id != executor_id response.sequence != sequence\n",
  );
  writeFileSync(
    join(root, "adapter.ts"),
    "IdentityProviderRequest IdentityProviderResponse 2_097_152\n",
  );

  const policy = {
    protoPath: "provider.proto",
    codecPath: "codec.rs",
    runtimePath: "runtime.rs",
    requiredCodecNeedles: ["decode_provider_response", "validate_result", "unknown_fields"],
    requiredRuntimeNeedles: [
      "ProviderTransport",
      "response.executor_id != executor_id",
      "response.sequence != sequence",
    ],
    operations: [
      {
        fieldName: "resolve",
        requestType: "ResolveRequest",
        resultType: "ResolveResult",
        number: 10,
      },
    ],
    adapters: [
      {
        path: "adapter.ts",
        requiredNeedles: [
          "IdentityProviderRequest",
          "IdentityProviderResponse",
          "2_097_152",
        ],
        forbiddenNeedles: ["WholeOperationProvider"],
      },
    ],
    retiredPaths: ["deprecated-provider"],
  };
  context.assertGranularProviderBoundary(policy);

  mkdirSync(join(root, "deprecated-provider"));
  writeFileSync(join(root, "deprecated-provider", "tracker.yaml"), "strict: false\n");
  const retiredResult = runFixtureScript(
    root,
    `context.assertPathsAbsent(["deprecated-provider"]);`,
  );
  assert.equal(retiredResult.status, 1);
  assert.match(retiredResult.stderr, /deprecated-provider must not exist/u);
  rmSync(join(root, "deprecated-provider"), { recursive: true });

  symlinkSync("missing-retired-target", join(root, "deprecated-provider"));
  const brokenSymlinkResult = runFixtureScript(
    root,
    `context.assertPathsAbsent(["deprecated-provider"]);`,
  );
  assert.equal(brokenSymlinkResult.status, 1);
  assert.match(brokenSymlinkResult.stderr, /deprecated-provider must not exist/u);
  rmSync(join(root, "deprecated-provider"));

  const validProviderProto = readFileSync(join(root, "provider.proto"), "utf8");
  writeFileSync(
    join(root, "provider.proto"),
    validProviderProto.replace(
      "    ResolveRequest resolve = 10;",
      "    ResolveRequest resolve = 10;\n    ResolveRequest wallet = 11;",
    ),
  );
  const contaminatedOperationResult = runFixtureScript(
    root,
    `context.assertGranularProviderBoundary(${JSON.stringify(policy)});`,
  );
  assert.equal(contaminatedOperationResult.status, 1);
  assert.match(
    contaminatedOperationResult.stderr,
    /IdentityProviderRequest must define correlated granular operations/u,
  );

  writeFileSync(
    join(root, "provider.proto"),
    validProviderProto.replace(
      "  uint32 max_response_bytes = 3;",
      "  uint32 max_response_bytes = 3;\n  string provider_endpoint = 4;",
    ),
  );
  const descriptorExpansionResult = runFixtureScript(
    root,
    `context.assertGranularProviderBoundary(${JSON.stringify(policy)});`,
  );
  assert.equal(descriptorExpansionResult.status, 1);
  assert.match(
    descriptorExpansionResult.stderr,
    /must define version, capabilities, and response bound/u,
  );

  writeFileSync(
    join(root, "provider.proto"),
    validProviderProto.replace(
      "  uint32 max_response_bytes = 3;",
      "  uint32 max_response_bytes = 3;\n  map<string, string> provider_metadata = 4;",
    ),
  );
  const descriptorMapExpansionResult = runFixtureScript(
    root,
    `context.assertGranularProviderBoundary(${JSON.stringify(policy)});`,
  );
  assert.equal(descriptorMapExpansionResult.status, 1);
  assert.match(
    descriptorMapExpansionResult.stderr,
    /must define version, capabilities, and response bound/u,
  );

  writeFileSync(
    join(root, "provider.proto"),
    validProviderProto.replace(
      "  IdentityProtocolVersion protocol_version = 1;",
      "  bytes protocol_version = 1;",
    ),
  );
  const descriptorTypeResult = runFixtureScript(
    root,
    `context.assertGranularProviderBoundary(${JSON.stringify(policy)});`,
  );
  assert.equal(descriptorTypeResult.status, 1);
  assert.match(
    descriptorTypeResult.stderr,
    /must define version, capabilities, and response bound/u,
  );

  writeFileSync(
    join(root, "provider.proto"),
    validProviderProto.replace(
      "    IdentityProviderError error = 4;",
      "    IdentityProviderError error = 4;\n    bytes untyped = 5;",
    ),
  );
  const outcomeExpansionResult = runFixtureScript(
    root,
    `context.assertGranularProviderBoundary(${JSON.stringify(policy)});`,
  );
  assert.equal(outcomeExpansionResult.status, 1);
  assert.match(
    outcomeExpansionResult.stderr,
    /IdentityProviderResponse must echo correlation/u,
  );

  const duplicateOperationPolicy = {
    ...policy,
    operations: [...policy.operations, { ...policy.operations[0] }],
  };
  const duplicateOperationResult = runFixtureScript(
    root,
    `context.assertGranularProviderBoundary(${JSON.stringify(duplicateOperationPolicy)});`,
  );
  assert.equal(duplicateOperationResult.status, 1);
  assert.match(duplicateOperationResult.stderr, /operation field resolve is duplicated/u);

  writeFileSync(
    join(root, "provider.proto"),
    validProviderProto.replace(
      "  uint64 sequence = 2;\n  oneof outcome",
      "  oneof outcome",
    ),
  );
  policy.retiredPaths = [];
  const correlationResult = runFixtureScript(
    root,
    `context.assertGranularProviderBoundary(${JSON.stringify(policy)});`,
  );
  assert.equal(correlationResult.status, 1);
  assert.match(
    correlationResult.stderr,
    /IdentityProviderResponse must echo correlation/u,
  );
});

test("ReallyMe protobuf release policy defaults to current pinned generator versions", () => {
  const root = createFixture();
  const context = createContext(root);
  mkdirSync(join(root, "generated"), { recursive: true });
  mkdirSync(join(root, "scripts", "release-readiness"), { recursive: true });
  writeFileSync(join(root, "scripts", "release-readiness", "core.mjs"), "core\n");
  writeFileSync(join(root, "harden.mjs"), 'const option = "--check-idempotent";\nredact\n');
  writeFileSync(
    join(root, "schema.proto"),
    `syntax = "proto3";
message SensitiveBytes {
  bytes value = 1;
}
`,
  );
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
  writeFileSync(
    join(root, ".github", "workflows", "protobuf-ci.yml"),
    `name: Protobuf
env:
  BUF_VERSION: 1.72.0
  BUFFA_VERSION: 0.9.2
jobs:
  check:
    steps:
      - name: Install pinned Buffa generators
        run: |
          cargo install protoc-gen-buffa --version "$BUFFA_VERSION" --locked
          cargo install protoc-gen-buffa-packaging --version "$BUFFA_VERSION" --locked
      - name: Lint protobuf schema
        run: buf lint
      - name: Regenerate protobuf artifacts
        run: buf generate
      - name: Check release readiness generated freshness
        run: node scripts/check_release_readiness.mjs --generated-freshness
      - name: Mention vendored core
        run: test -f scripts/release-readiness/core.mjs
`,
  );

  context.assertReallyMeProtobufReleasePolicy({
    generatedFreshness: {
      generatedPaths: ["generated"],
      commands: [["node", ["--version"]]],
    },
    hardeningPolicy: {
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
      ],
      requiredGeneratedNeedles: ["pub struct SensitiveBytes"],
      forbiddenGeneratedNeedles: ["::buffa::alloc::format!("],
      requireStrictJson: false,
      requireUnknownFieldZeroization: false,
    },
  });
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
  assert.match(template, /version: "0\.6\.2"/u);
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
    `export const RELEASE_READINESS_VERSION = "0.6.2";
const assertReallyMeVendoredCorePolicy = () => {
  "assertGeneratedArtifactsFresh";
  "assertGeneratedProtoHardeningPolicy";
  "assertReallyMeProtobufReleasePolicy";
  "assertReallyMeVendoredCorePolicy";
  "assertReallyMeRustProtoRepositoryPolicy";
  "assertCargoMetadataPolicy";
  "assertCargoWorkspacePolicy";
  "assertRepositoryShapePolicy";
  "assertRustSourcePolicy";
  "assertTypeScriptSourcePolicy";
  "assertSwiftSourcePolicy";
  "assertKotlinSourcePolicy";
  "assertTextPolicy";
  "assertSpdxHeaders";
  "assertWorkflowActionsPinned";
  "assertWorkflowPolicy";
  "runCommands";
  "assertProtoContract";
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

test("vendored core policy rejects the retired numeric contract option", () => {
  const root = createTrackedFixture();
  const result = runTrackedFixtureScript(
    root,
    `context.assertReallyMeVendoredCorePolicy({ contractVersion: 12 });`,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /numeric release-readiness contractVersion is not supported/u);
});

test("vendored core policy accepts the complete current core", () => {
  const root = createTrackedFixture();
  const result = runTrackedFixtureScript(
    root,
    `context.assertReallyMeVendoredCorePolicy({
  scriptPath: "scripts/release-readiness/core.mjs",
  corePath: "scripts/release-readiness/core.mjs",
});`,
  );

  assert.equal(result.status, 0, result.stderr);
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
