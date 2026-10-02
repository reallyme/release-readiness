#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ReallyMe LLC
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import {
  createReleaseReadinessContext,
  RELEASE_READINESS_VERSION,
} from "../core.mjs";

const {
  assertContains,
  assertNodeWorkflowJobsPinNode,
  assertNotContains,
  assertRepositoryShapePolicy,
  assertSpdxHeaders,
  assertWorkflowActionsPinned,
  assertWorkflowRunStep,
  assertWorkflowUsesStepPinnedTo,
  fail,
  readJson,
  readText,
} = createReleaseReadinessContext({
  scriptUrl: import.meta.url,
  requireTrackedFiles: false,
});

const packageJson = readJson("package.json");
if (packageJson.name !== "@reallyme/release-readiness") {
  fail("package name must remain @reallyme/release-readiness");
}
if (packageJson.license !== "MIT OR Apache-2.0") {
  fail("package license must remain MIT OR Apache-2.0");
}
if (packageJson.version !== RELEASE_READINESS_VERSION) {
  fail("package version must match the shared core release version");
}
if (RELEASE_READINESS_VERSION !== "0.6.7") {
  fail("package version must remain 0.6.7 for this release");
}
if (
  JSON.stringify(packageJson.files) !==
  JSON.stringify([
    "LICENSE-APACHE",
    "LICENSE-MIT",
    "core.mjs",
    "docs/",
    "scripts/run-consumer-check.mjs",
    "templates/",
  ])
) {
  fail("package files must remain an explicit release-runtime allowlist");
}
for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
  if (packageJson[field] !== undefined && Object.keys(packageJson[field]).length !== 0) {
    fail(`package ${field} must remain empty`);
  }
}

assertContains("core.mjs", 'RELEASE_READINESS_VERSION = "0.6.7"');
assertNotContains("core.mjs", "RELEASE_READINESS_CORE_CONTRACT_VERSION");
assertContains("package.json", '"reallyme-release-readiness": "scripts/run-consumer-check.mjs"');
assertContains("scripts/run-consumer-check.mjs", "RELEASE_READINESS_CORE_URL");
assertContains("scripts/run-consumer-check.mjs", "pathToFileURL(upstreamCorePath).href");
assertContains("scripts/run-consumer-check.mjs", "MAX_SHARED_CORE_BYTES");
assertContains("scripts/run-consumer-check.mjs", "RELEASE_READINESS_ENFORCED_VERSION");
assertContains("scripts/run-consumer-check.mjs", "requiredSourcePolicies");
assertContains("README.md", "github:reallyme/release-readiness#FULL_COMMIT_SHA");
assertNotContains("README.md", "release-readiness#main");
assertContains("README.md", "Latest stable registry requirements");
assertContains("README.md", "assertTypeScriptSourcePolicy");
assertContains("README.md", "assertSwiftSourcePolicy");
assertContains("README.md", "assertKotlinSourcePolicy");
assertContains("README.md", "docs/repository-shapes.md");
assertContains("docs/repository-shapes.md", "consistent directory grammar");
const repositoryArchetypes = [
  "foundational-library",
  "protocol-engine",
  "developer-platform",
  "application",
  "application-collection",
  "product-workspace",
  "hosted-service",
  "platform-workspace",
  "runtime-composition",
  "infrastructure",
  "conformance-suite",
  "taxonomy",
  "documentation-site",
  "tooling",
];
for (const archetype of repositoryArchetypes) {
  assertContains("core.mjs", `"${archetype}": {`);
  assertContains("docs/repository-shapes.md", `| \`${archetype}\` |`);
  assertContains("docs/archetype-matrix.md", `| \`${archetype}\` |`);
}
assertContains("docs/repository-shapes.md", "## Choosing an Application Archetype");
assertContains("docs/archetype-matrix.md", "## Application Decision");
assertContains("docs/archetype-matrix.md", "## Server and Service Decision");
assertContains("docs/archetype-matrix.md", "Sharing `crates/domain`");
assertNotContains("docs/archetype-matrix.md", "| Example |");
assertContains(".gitignore", "/matrix.md");
assertContains("docs/repository-shapes.md", "## Facade Role");
assertContains("docs/repository-shapes.md", "## Cargo Crate Roles");
assertContains("docs/repository-shapes.md", "Select exactly one archetype");
assertContains("docs/repository-shapes.md", "apps/<app>/contract/proto");
assertContains(
  "docs/repository-shapes.md",
  "shared schemas live in `crates/proto`",
);
const cargoCrateRoles = [
  "adapter",
  "domain",
  "facade",
  "proto",
  "proto-codec",
  "provider",
  "runtime",
  "storage",
  "support",
  "test-support",
  "transport",
];
for (const role of cargoCrateRoles) {
  assertContains("core.mjs", `"${role}"`);
  assertContains("docs/repository-shapes.md", `| \`${role}\` |`);
}
assertContains("core.mjs", "permits at most one facade crate");
assertContains("core.mjs", "requires at least two application sublanes");
assertContains(
  "docs/repository-shapes.md",
  "cannot decide whether a conversion boundary",
);
assertContains("core.mjs", "assertGeneratedArtifactsFresh");
assertContains("core.mjs", "assertGeneratedProtoHardeningPolicy");
assertContains("core.mjs", "assertReallyMeProtobufReleasePolicy");
assertContains("core.mjs", "assertWorkflowChangePathCovered");
assertContains("core.mjs", 'checkerPath = "scripts/check_release_readiness.mjs"');
assertContains("core.mjs", "corePath = null");
assertContains(
  "core.mjs",
  '"node .release-readiness/scripts/run-consumer-check.mjs --generated-freshness"',
);
assertContains("core.mjs", "assertWorkflowToolVersion");
assertContains("core.mjs", "DEFAULT_REALLYME_LATEST_STABLE_DEPENDENCIES");
assertContains("core.mjs", "reallyMeLatestStableDependencies");
assertContains("core.mjs", "loadLatestCargoRegistryVersion");
assertContains("core.mjs", "assertReallyMeVendoredCorePolicy");
assertContains("core.mjs", "assertReallyMeRustProtoRepositoryPolicy");
assertContains("core.mjs", "assertCargoMetadataPolicy");
assertContains("core.mjs", "assertCargoWorkspacePolicy");
assertContains("core.mjs", "assertRepositoryShapePolicy");
assertContains("core.mjs", "forbids compatibility proto package");
assertContains("core.mjs", "assertRustSourcePolicy");
assertContains("core.mjs", "assertTypeScriptSourcePolicy");
assertContains("core.mjs", "assertSwiftSourcePolicy");
assertContains("core.mjs", "assertKotlinSourcePolicy");
assertContains("core.mjs", "assertTextPolicy");
assertContains("core.mjs", "assertWorkflowActionsPinned");
assertContains("core.mjs", "assertWorkflowPolicy");
assertContains("core.mjs", "assertWorkflowPermissionsPolicy");
assertContains("core.mjs", "assertSpdxHeaders");
assertContains("core.mjs", "runCommands");
assertContains("core.mjs", "scalarFieldClassifications");
assertContains("core.mjs", "snapshotDirectory");
assertContains("core.mjs", "assertSnapshotsEqual");
assertContains("core.mjs", "snapshotRepositoryFilesOutside");
assertContains("core.mjs", "assertRepositorySnapshotsEqual");
assertContains("core.mjs", 'createHash("sha256")');
assertContains("core.mjs", "assertProtoContract");
assertContains("core.mjs", "assertReallyMeOperationBoundaryContract");
assertContains("core.mjs", "assertGranularProviderBoundary");
assertContains("core.mjs", "assertPathsAbsent");
assertContains("core.mjs", "provider request and result oneofs must contain only declared granular operations");
assertContains("core.mjs", "lstatSync(absolute);");
assertContains("core.mjs", "requiredCodecNeedles");
assertContains("core.mjs", "forbiddenCodecNeedles");
assertContains("core.mjs", "assertNodeWorkflowJobsPinNode");
assertContains("core.mjs", "assertWorkflowRunStep");
assertContains("core.mjs", "assertWorkflowUsesStep");
assertContains("core.mjs", "assertLockPackageVersion");
assertContains("core.mjs", "assertPackageFiles");
assertContains("core.mjs", "corepack");
assertContains("core.mjs", "requiredInstallSteps");
assertContains("LICENSE-APACHE", "Apache License");
assertContains("LICENSE-APACHE", "Version 2.0, January 2004");
assertContains("LICENSE-MIT", "MIT License");
assertContains("LICENSE-MIT", "Copyright (c) 2026 ReallyMe LLC");
assertSpdxHeaders();
assertContains(
  ".github/workflows/checks.yml",
  "node-version: \"24\"",
);
assertContains("README.md", "Generated protobuf hardening checks");
assertContains("README.md", "Granular provider contracts");
assertContains("README.md", "retired-path enforcement");
assertContains("README.md", "buf generate");
assertContains("README.md", "harden-generated-example-proto.mjs");
assertContains("README.md", "actions/workflows/checks.yml/badge.svg");
assertContains("README.md", 'RELEASE_READINESS_VERSION = "0.6.7"');
assertContains("README.md", "repository: reallyme/release-readiness");
assertContains("README.md", "ref: FULL_RELEASE_READINESS_COMMIT_SHA");
assertContains("README.md", "persist-credentials: false");
assertContains("README.md", "node .release-readiness/scripts/run-consumer-check.mjs");
assertContains("README.md", "github:reallyme/release-readiness#FULL_COMMIT_SHA");
assertNotContains("README.md", "Sister repositories can vendor the core");
assertContains("core.mjs", "scalarFieldClassifications");
assertContains("core.mjs", "unclassified protobuf scalar field");
const templatePath = "templates/check_release_readiness.mjs";
const templateSource = readText(templatePath);
const assertTemplateContains = (needle) => {
  if (!templateSource.includes(needle)) {
    fail(`${templatePath} does not contain ${needle}`);
  }
};
assertTemplateContains("scalarFieldClassifications");
assertContains("README.md", "outside the declared generated directories");
assertContains("README.md", "neither sparse nor sequential numbering");
assertContains("README.md", 'sensitivity: "sensitive"');
assertContains("README.md", "templates/check_release_readiness.mjs");
for (const needle of [
  "assertReallyMeRustProtoRepositoryPolicy",
  "requireTrackedFiles: true",
  "assertNoTemplateMarkers(repositoryPolicy)",
  "validatePublishablePathDependencies: true",
  "reallyMeLatestStableDependencies: true",
  "rustSource: {",
  'version: "0.6.7"',
  "repositoryShape: {",
  'archetype: "protocol-engine"',
  "typescriptSource: {",
  "swiftSource: {",
  "kotlinSource: {",
  "staticAnalysis: {",
  '"@typescript-eslint/consistent-type-assertions"',
  'roots: ["."]',
  "productionHardLines: 500",
  "testTargetLines: 800",
  "testHardLines: 800",
  "forbidInlineTests: true",
  "forbidSubstantiveFacades: true",
  "forbidPanickingProductionCode: true",
  "forbidDynamicErrorSurfaces: true",
  'roles: ["typecheck", "lint", "test"]',
  'roles: ["format", "lint", "build", "test"]',
  'roles: ["format", "static-analysis", "compile", "test"]',
  "requireExclusionsMatched: true",
  "requireExclusionReasons: true",
  "granularProviderBoundary",
  "operations: [",
  "retiredPaths: []",
  "requiredInstallSteps: [",
  "versionFromWorkflowEnv: true",
  'installBufAction: "bufbuild/buf-action"',
  'checkerPath: "scripts/check_release_readiness.mjs"',
  "node .release-readiness/scripts/run-consumer-check.mjs --generated-freshness",
]) {
  assertTemplateContains(needle);
}
assertNotContains(
  "templates/check_release_readiness.mjs",
  "requireTrackedFiles: false",
);
assertNotContains("core.mjs", 'from "yaml"');

assertWorkflowActionsPinned();
assertNodeWorkflowJobsPinNode({ nodeVersion: "24" });
assertWorkflowUsesStepPinnedTo(
  ".github/workflows/checks.yml",
  "Checkout",
  "actions/checkout",
);
assertWorkflowUsesStepPinnedTo(
  ".github/workflows/checks.yml",
  "Setup Node",
  "actions/setup-node",
);
assertWorkflowRunStep(
  ".github/workflows/checks.yml",
  "Run release readiness checks",
  "npm run check",
);
assertRepositoryShapePolicy({
  archetype: "tooling",
  requiredLanes: ["test", "docs", "scripts", ".github"],
  optionalLanes: ["templates"],
  exceptions: [],
  crates: [],
  subLanes: {},
  forbiddenPaths: [],
  requireReleaseReadiness: false,
});
assertSpdxHeaders();
