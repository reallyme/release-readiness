#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright © 2026 ReallyMe LLC. All rights reserved
//
// SPDX-License-Identifier: Apache-2.0

import { createReleaseReadinessContext } from "../core.mjs";

const {
  assertContains,
  assertNodeWorkflowJobsPinNode,
  assertNotContains,
  assertSpdxHeaders,
  assertWorkflowActionsPinned,
  assertWorkflowRunStep,
  assertWorkflowUsesStep,
  fail,
  readJson,
} = createReleaseReadinessContext({
  scriptUrl: import.meta.url,
  requireTrackedFiles: false,
});

const packageJson = readJson("package.json");
if (packageJson.name !== "@reallyme/release-readiness") {
  fail("package name must remain @reallyme/release-readiness");
}
if (packageJson.license !== "Apache-2.0") {
  fail("package license must remain Apache-2.0");
}
for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
  if (packageJson[field] !== undefined && Object.keys(packageJson[field]).length !== 0) {
    fail(`package ${field} must remain empty`);
  }
}

assertContains("core.mjs", "RELEASE_READINESS_CORE_CONTRACT_VERSION = 6");
assertContains("package.json", '"reallyme-release-readiness": "scripts/run-consumer-check.mjs"');
assertContains("scripts/run-consumer-check.mjs", "timingSafeEqual");
assertContains("scripts/run-consumer-check.mjs", "shared core does not match the pinned package");
assertContains("scripts/run-consumer-check.mjs", "MAX_SHARED_CORE_BYTES");
assertContains("README.md", "github:reallyme/release-readiness#FULL_COMMIT_SHA");
assertNotContains("README.md", "release-readiness#main");
assertContains("core.mjs", "assertGeneratedArtifactsFresh");
assertContains("core.mjs", "assertGeneratedProtoHardeningPolicy");
assertContains("core.mjs", "assertReallyMeProtobufReleasePolicy");
assertContains("core.mjs", "assertReallyMeVendoredCorePolicy");
assertContains("core.mjs", "assertReallyMeRustProtoRepositoryPolicy");
assertContains("core.mjs", "assertCargoMetadataPolicy");
assertContains("core.mjs", "assertCargoWorkspacePolicy");
assertContains("core.mjs", "assertTextPolicy");
assertContains("core.mjs", "assertWorkflowActionsPinned");
assertContains("core.mjs", "assertWorkflowPolicy");
assertContains("core.mjs", "assertSpdxHeaders");
assertContains("core.mjs", "runCommands");
assertContains("core.mjs", "secretByteFields");
assertContains("core.mjs", "snapshotDirectory");
assertContains("core.mjs", "assertSnapshotsEqual");
assertContains("core.mjs", "snapshotRepositoryFilesOutside");
assertContains("core.mjs", "assertRepositorySnapshotsEqual");
assertContains("core.mjs", 'createHash("sha256")');
assertContains("core.mjs", "assertProtoContract");
assertContains("core.mjs", "assertReallyMeProtoBoundaryContract");
assertContains("core.mjs", "requiredCodecNeedles");
assertContains("core.mjs", "forbiddenCodecNeedles");
assertContains("core.mjs", "assertNodeWorkflowJobsPinNode");
assertContains("core.mjs", "assertWorkflowRunStep");
assertContains("core.mjs", "assertWorkflowUsesStep");
assertContains("core.mjs", "assertLockPackageVersion");
assertContains("core.mjs", "assertPackageFiles");
assertContains("core.mjs", "corepack");
assertContains("core.mjs", "requiredInstallSteps");
assertContains("LICENSE", "Apache License");
assertContains("LICENSE", "Version 2.0, January 2004");
assertContains(
  ".github/workflows/checks.yml",
  "SPDX-License-Identifier: Apache-2.0",
);
assertContains(
  ".github/workflows/checks.yml",
  "node-version: \"24\"",
);
assertContains("README.md", "Generated protobuf hardening checks");
assertContains("README.md", "buf generate");
assertContains("README.md", "harden-generated-example-proto.mjs");
assertContains("README.md", "actions/workflows/checks.yml/badge.svg");
assertContains("README.md", "RELEASE_READINESS_CORE_CONTRACT_VERSION = 6");
assertContains("README.md", "outside the declared generated directories");
assertContains("README.md", "neither sparse nor sequential numbering");
assertContains("README.md", '{ message: "MessageName", field: "field_name" }');
assertContains("README.md", "templates/check_release_readiness.mjs");
assertContains(
  "templates/check_release_readiness.mjs",
  "assertReallyMeRustProtoRepositoryPolicy",
);
assertContains(
  "templates/check_release_readiness.mjs",
  "requireTrackedFiles: true",
);
assertContains(
  "templates/check_release_readiness.mjs",
  "assertNoTemplateMarkers(repositoryPolicy)",
);
assertContains(
  "templates/check_release_readiness.mjs",
  "validatePublishablePathDependencies: true",
);
assertContains(
  "templates/check_release_readiness.mjs",
  'requiredInstallSteps: [',
);
assertContains(
  "templates/check_release_readiness.mjs",
  "node scripts/check_release_readiness.mjs --generated-freshness",
);
assertNotContains(
  "templates/check_release_readiness.mjs",
  "requireTrackedFiles: false",
);
assertNotContains("core.mjs", 'from "yaml"');

assertWorkflowActionsPinned();
assertNodeWorkflowJobsPinNode({ nodeVersion: "24" });
assertWorkflowUsesStep(
  ".github/workflows/checks.yml",
  "Checkout",
  "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
);
assertWorkflowUsesStep(
  ".github/workflows/checks.yml",
  "Setup Node",
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
);
assertWorkflowRunStep(
  ".github/workflows/checks.yml",
  "Run release readiness checks",
  "npm run check",
);
assertSpdxHeaders();
