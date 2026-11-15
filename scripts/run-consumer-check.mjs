#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createReleaseReadinessContext, RELEASE_READINESS_VERSION } from "../core.mjs";
import { readPublicCiConfig, renderPublicCi } from "./public-ci.mjs";
import {
  assertOnMain, assertPublicCiRun, assertPublicPreflightDispatch, assertPublicPreflightRun,
  assertPublicReleaseInvocation, assertPublicReleaseVersion, renderPreflightSummaryStep,
  writePublicPreflightReceipt, writePublicReleaseOutputs,
} from "./public-release.mjs";
import { assertPublicRepoPolicy } from "./public-repo-policy.mjs";

const MAX_CHECKER_BYTES = 524_288;
const MAX_SHARED_CORE_BYTES = 262_144;
const MAX_TRACKED_FILES_BYTES = 16_777_216;
const args = process.argv.slice(2);
const commandArguments = new Map([
  ["--check-workflows", [0]],
  ["--render-ci", [0]],
  ["--render-preflight-summary", [0, 1]],
  ["--check-release", [5]],
]);
const workflowCommand = args.find((arg) => commandArguments.has(arg));

const failure = (message) => {
  console.error(`release readiness runner failed: ${message}`);
  process.exit(1);
};

let repositoryRoot;
let checkerPath;
let upstreamCorePath;
try {
  repositoryRoot = realpathSync(process.cwd());
  checkerPath = resolve(repositoryRoot, "scripts/check_release_readiness.mjs");
  upstreamCorePath = fileURLToPath(new URL("../core.mjs", import.meta.url));

  if (workflowCommand === undefined) {
    const description = "consumer checker";
    const path = checkerPath;
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
    if (status.size === 0 || status.size > MAX_CHECKER_BYTES) {
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

const trackedFilesResult = spawnSync("git", ["ls-files", "-z"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  maxBuffer: MAX_TRACKED_FILES_BYTES,
});
if (trackedFilesResult.error !== undefined || trackedFilesResult.status !== 0) {
  failure("could not enumerate Git-tracked source files");
}
const trackedFiles = new Set(trackedFilesResult.stdout.split("\0").filter(Boolean));
const repositoryContext = createReleaseReadinessContext({
  scriptUrl: pathToFileURL(checkerPath).href,
  failurePrefix: "release readiness runner failed",
});
const selfCheck = relative(repositoryRoot, upstreamCorePath) === "core.mjs" &&
  (process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY?.toLowerCase() === "reallyme/release-readiness");
if (workflowCommand !== undefined &&
    (args[0] !== workflowCommand || !commandArguments.get(workflowCommand).includes(args.length - 1))) {
  if (workflowCommand === "--check-release") failure("use --check-release ECOSYSTEM PHASE VERSION TAG SOURCE_SHA");
  if (workflowCommand === "--render-preflight-summary") failure("use --render-preflight-summary [ECOSYSTEM]");
  failure(`${workflowCommand} must be used on its own`);
}
if (workflowCommand === "--render-preflight-summary") {
  const [, ecosystem] = args;
  let publishWorkflow;
  if (ecosystem !== undefined) {
    const { release } = readPublicCiConfig(repositoryContext, trackedFiles, { selfCheck });
    publishWorkflow = release?.channels.get(ecosystem)?.publish;
    if (publishWorkflow === undefined) failure("choose a release ecosystem declared in .github/release-readiness.json");
  }
  process.stdout.write(renderPreflightSummaryStep(publishWorkflow));
} else if (workflowCommand === "--render-ci") {
  // Let stdout flush when a caller pipes the rendered file.
  const { lanes, mergeQueue } = readPublicCiConfig(repositoryContext, trackedFiles, { selfCheck });
  process.stdout.write(renderPublicCi(lanes, { mergeQueue }));
} else if (workflowCommand !== undefined) {
  const policy = assertPublicRepoPolicy(repositoryContext, trackedFiles, process.env, { selfCheck });
  if (policy === null) {
    failure("set RELEASE_READINESS_PUBLIC_REPO=true to check the public workflow policy locally");
  }
  if (workflowCommand === "--check-release") {
    const [, ecosystem, phase, version, tag, sha] = args;
    const repository = process.env.GITHUB_REPOSITORY;
    const workflowRef = process.env.GITHUB_ACTIONS === "true" ? process.env.GITHUB_WORKFLOW_REF ?? "" : undefined;
    assertPublicReleaseInvocation(repositoryContext, repository, sha, ecosystem, phase, policy.release, workflowRef);
    assertPublicReleaseVersion(repositoryContext, trackedFiles, policy.release, version, tag);
    const { tagOwner } = policy.release;
    if (phase === "preflight") {
      assertPublicPreflightDispatch(repositoryContext, version, sha);
      const ci = assertPublicCiRun(repositoryContext, repository, sha, {
        mergeQueue: policy.mergeQueue, lanes: policy.ciLanes,
        requireAndroidPublication: ecosystem === "maven" && policy.hasAndroidLane,
      });
      writePublicPreflightReceipt(repositoryContext, { repository, ecosystem, version, tag, sha }, ci);
      writePublicReleaseOutputs(repositoryContext, { ...ci, preflightRunId: null, tagOwner });
      console.log(`Verified repository version ${version} and Required CI run ${ci.ciRunId} for ${sha}. Canonical tag owner: ${tagOwner}.`);
      for (const [lane, evidence] of ci.carriedLanes) {
        console.log(`Lane ${lane} was skipped for ${sha}. It has unchanged inputs since CI run ${evidence.runId} passed it at ${evidence.sha}.`);
      }
    } else {
      assertOnMain(repositoryContext, repository, sha);
      const verified = assertPublicPreflightRun(repositoryContext, repository, policy.release, ecosystem, version, sha);
      writePublicReleaseOutputs(repositoryContext, { ...verified, androidArtifactId: null, tagOwner });
      console.log(`Verified package preflight run ${verified.preflightRunId} and its CI run ${verified.ciRunId} for ${version} at ${sha}.`);
    }
  }
} else {
  const policy = assertPublicRepoPolicy(repositoryContext, trackedFiles, process.env, { selfCheck });
  runConsumerChecker(policy?.coverage);
}

function runConsumerChecker(standardCiPaths) {
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

  const result = spawnSync(process.execPath, [checkerPath, ...args], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      RELEASE_READINESS_CORE_URL: pathToFileURL(upstreamCorePath).href,
      RELEASE_READINESS_ENFORCED_VERSION: RELEASE_READINESS_VERSION,
      RELEASE_READINESS_SOURCE_POLICY_FD: "3",
      RELEASE_READINESS_STANDARD_CI_PATHS: JSON.stringify(Object.fromEntries(standardCiPaths ?? [])),
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
    if (trackedFiles.has("Cargo.toml") && !reportedSourcePolicies.has("rust-release")) {
      failure("consumer checker did not enforce the shared Rust release policy");
    }
  }
  process.exitCode = result.status;
}
