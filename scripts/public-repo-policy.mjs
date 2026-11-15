// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { readFileSync } from "node:fs";

import { assertPublicCi } from "./public-ci.mjs";

const CLA_TEMPLATE = new URL("../templates/cla.yaml", import.meta.url);
const CLA_WORKFLOWS = [".github/workflows/cla.yaml", ".github/workflows/cla.yml"];

export function assertPublicRepoPolicy(context, trackedFiles, env = process.env, options) {
  const { fail } = context;
  let isPublic = false;
  if (env.GITHUB_ACTIONS === "true") {
    if (typeof env.GITHUB_EVENT_PATH !== "string" || env.GITHUB_EVENT_PATH.length === 0) {
      fail("GitHub Actions must provide its event payload for the public repository policy");
    }

    let event;
    try {
      event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
    } catch {
      fail("could not read the GitHub Actions event payload for the public repository policy");
    }
    const repository = event?.repository;
    if (
      typeof repository?.full_name !== "string" ||
      repository.full_name.toLowerCase() !== env.GITHUB_REPOSITORY?.toLowerCase()
    ) {
      fail("GitHub Actions event payload must identify the current repository");
    }
    if (!/^reallyme\//iu.test(repository.full_name)) {
      return null;
    }
    if (
      typeof repository.private !== "boolean" ||
      (repository.visibility !== undefined &&
        !["public", "private", "internal"].includes(repository.visibility))
    ) {
      fail("GitHub Actions event payload must identify the current repository and its visibility");
    }
    isPublic = !repository.private &&
      (repository.visibility === undefined || repository.visibility === "public");
  } else {
    // A local run can check the public-repo policy without a network request.
    isPublic = env.RELEASE_READINESS_PUBLIC_REPO === "true";
  }
  if (!isPublic) {
    return null;
  }

  const workflows = CLA_WORKFLOWS.filter((path) => trackedFiles.has(path));
  if (workflows.length !== 1) {
    fail("public repositories must track exactly one CLA workflow at .github/workflows/cla.yaml or .github/workflows/cla.yml");
  }
  const [path] = workflows;
  const alternatePath = CLA_WORKFLOWS.find((candidate) => candidate !== path);
  context.assertPathsAbsent([alternatePath]);

  let expected;
  try {
    expected = readFileSync(CLA_TEMPLATE, "utf8");
  } catch {
    fail("could not read the pinned package's CLA workflow template");
  }
  // The workflow has a write token on PR events. Compare the complete
  // template so extra jobs, steps, permissions, or YAML directives fail.
  const normalize = (source) => source.replaceAll("\r\n", "\n");
  if (normalize(context.readText(path)).trimEnd() !== normalize(expected).trimEnd()) {
    fail(`${path} must match templates/cla.yaml from the pinned release-readiness package`);
  }
  return assertPublicCi(context, trackedFiles, options);
}
