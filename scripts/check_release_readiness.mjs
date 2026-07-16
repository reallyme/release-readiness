#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright © 2026 ReallyMe LLC. All rights reserved
//
// SPDX-License-Identifier: Apache-2.0

import { createReleaseReadinessContext } from "../core.mjs";

const {
  assertContains,
  assertNotContains,
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

assertContains("core.mjs", "RELEASE_READINESS_CORE_CONTRACT_VERSION = 2");
assertContains("core.mjs", "assertGeneratedArtifactsFresh");
assertContains("core.mjs", "assertGeneratedProtoHardeningPolicy");
assertContains("core.mjs", "assertReallyMeProtobufReleasePolicy");
assertContains("core.mjs", "assertReallyMeVendoredCorePolicy");
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
assertContains("core.mjs", "assertSequentialProtoContract");
assertContains("core.mjs", "assertNodeWorkflowJobsPinNode");
assertContains("core.mjs", "assertWorkflowRunStep");
assertContains("core.mjs", "assertWorkflowUsesStep");
assertContains("core.mjs", "assertLockPackageVersion");
assertContains("core.mjs", "assertPackageFiles");
assertContains("README.md", "Generated protobuf hardening checks");
assertContains("README.md", "buf generate");
assertContains("README.md", "harden-generated-example-proto.mjs");
assertContains("README.md", "RELEASE_READINESS_CORE_CONTRACT_VERSION = 2");
assertContains("README.md", "outside the declared generated directories");
assertNotContains("core.mjs", 'from "yaml"');
