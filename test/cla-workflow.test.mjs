// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { createReleaseReadinessContext } from "../core.mjs";

const context = createReleaseReadinessContext({ scriptUrl: import.meta.url });
const claPath = "templates/cla.yaml";
const steps = () => context.extractWorkflowSteps(claPath);

test("CLA writes are confined to signature processing and never reach the merge queue", () => {
  context.assertWorkflowPermissionsPolicy({
    path: claPath,
    workflow: { contents: "read" },
    jobs: {
      "cla-signatures": { actions: "write", contents: "write", "pull-requests": "write" },
      "cla-merge-queue": { actions: "read", contents: "read", "pull-requests": "read" },
      CLAAssistant: { contents: "none" },
    },
  });
  const source = readFileSync(new URL(`../${claPath}`, import.meta.url), "utf8");
  assert.doesNotMatch(source, /uses:\s*actions\/checkout@/u);
  assert.match(source, /github\.event_name != 'merge_group' &&/u);
  assert.match(source, /github\.event_name == 'merge_group' &&/u);
  assert.match(source, /needs: \[cla-signatures, cla-merge-queue\]/u);
  assert.match(source, /if: >-\n\s+always\(\)/u);
});

test("the required CLA result fails closed for failed, cancelled or skipped applicable work", () => {
  const gate = steps().find((step) => step.name === "Require the applicable CLA result");
  assert.ok(gate?.run);
  const results = ["success", "failure", "cancelled", "skipped"];
  for (const event of ["pull_request_target", "issue_comment", "merge_group", "push"]) {
    for (const signatures of results) {
      for (const queue of results) {
        const result = spawnSync("bash", ["-c", gate.run], {
          encoding: "utf8", timeout: 5_000,
          env: { ...process.env, GITHUB_EVENT_NAME: event, SIGNATURE_RESULT: signatures, QUEUE_RESULT: queue },
        });
        assert.equal(result.error, undefined);
        const expected = event === "merge_group"
          ? queue === "success" && signatures === "skipped"
          : ["pull_request_target", "issue_comment"].includes(event) && signatures === "success" && queue === "skipped";
        assert.equal(result.status === 0, expected, `${event}/${signatures}/${queue}`);
      }
    }
  }
});

const repository = "reallyme/example";
const baseSha = "a".repeat(40);
const groupSha = "b".repeat(40);
const firstHead = "c".repeat(40);
const secondHead = "d".repeat(40);
const repoPath = `repos/${repository}`;
const comparePath = `${repoPath}/compare/${baseSha}...${groupSha}?per_page=100`;
const workflowRunsPath = (head, workflow = "cla.yaml") =>
  `${repoPath}/actions/workflows/${workflow}/runs?event=pull_request_target&head_sha=${head}&per_page=100`;
const pullRequest = (head) => ({
  state: "open",
  base: { ref: "main", repo: { full_name: repository } },
  head: { sha: head },
});
const workflowRun = (head, id, pr, action = "synchronize") => ({
  id,
  path: ".github/workflows/cla.yaml",
  display_title: `CLA ${action} PR #${pr}`,
  event: "pull_request_target",
  head_sha: head,
  status: "completed",
  conclusion: "success",
});
const commits = (...subjects) => subjects.map((message) => ({ commit: { message } }));
const validResponses = {
  [comparePath]: [
    { total_commits: 2, commits: commits("One (#11)") },
    { total_commits: 2, commits: commits("Two (#12)") },
  ],
  [`${repoPath}/pulls/11`]: pullRequest(firstHead),
  [`${repoPath}/pulls/12`]: pullRequest(secondHead),
  [workflowRunsPath(firstHead)]: [{ workflow_runs: [workflowRun(firstHead, 111, 11, "opened")] }],
  [workflowRunsPath(secondHead)]: [{ workflow_runs: [
    workflowRun(secondHead, 112, 12, "reopened"),
    workflowRun(secondHead, 113, 12, "closed"),
  ] }],
};

test("the CLA merge queue verifies all PRs and fails closed on incomplete or mismatched evidence", (t) => {
  const jq = spawnSync("jq", ["--version"], { encoding: "utf8" });
  if (jq.error?.code === "ENOENT" && process.env.GITHUB_ACTIONS !== "true") {
    t.skip("jq is needed to exercise the GitHub runner's merge-queue script");
    return;
  }
  assert.equal(jq.status, 0, jq.stderr);

  const root = mkdtempSync(join(tmpdir(), "reallyme-cla-queue-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scriptPath = join(root, "verify.sh");
  const responsePath = join(root, "responses.json");
  const script = steps().find((step) => step.name === "Verify CLA checks for queued pull requests")?.run;
  assert.equal(typeof script, "string");
  assert.match(script, /^set -euo pipefail/u);
  writeFileSync(scriptPath, script);
  writeFileSync(join(root, "gh"), `#!/bin/sh
exec "$RR_TEST_NODE" --input-type=module -e '
  import { readFileSync } from "node:fs";
  const endpoint = process.argv.at(-1);
  const responses = JSON.parse(readFileSync(process.env.RR_TEST_RESPONSES, "utf8"));
  if (!Object.hasOwn(responses, endpoint)) process.exit(2);
  process.stdout.write(JSON.stringify(responses[endpoint]));
' -- "$@"
`, { mode: 0o755 });

  const run = (overrides = {}, workflow = "cla.yaml") => {
    writeFileSync(responsePath, JSON.stringify({ ...validResponses, ...overrides }));
    return spawnSync("bash", [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}${delimiter}${process.env.PATH}`,
        RR_TEST_NODE: process.execPath,
        RR_TEST_RESPONSES: responsePath,
        GITHUB_REPOSITORY: repository,
        GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/${workflow}@refs/heads/main`,
        BASE_SHA: baseSha,
        GROUP_SHA: groupSha,
        BASE_REF: "refs/heads/main",
      },
    });
  };

  const success = run();
  assert.equal(success.status, 0, success.stderr);
  const alternateName = run({
    [workflowRunsPath(firstHead, "cla.yml")]: [{ workflow_runs: [
      { ...workflowRun(firstHead, 111, 11), path: ".github/workflows/cla.yml" },
    ] }],
    [workflowRunsPath(secondHead, "cla.yml")]: [{ workflow_runs: [
      { ...workflowRun(secondHead, 112, 12), path: ".github/workflows/cla.yml" },
    ] }],
  }, "cla.yml");
  assert.equal(alternateName.status, 0, alternateName.stderr);
  for (const [label, overrides] of [
    ["no commits", { [comparePath]: [{ total_commits: 0, commits: [] }] }],
    ["incomplete pages", { [comparePath]: [{ total_commits: 2, commits: commits("One (#11)") }] }],
    ["unrecognized commit", { [comparePath]: [{ total_commits: 2, commits: commits("One (#11)", "Unmapped") }] }],
    ["PR targeting another base", {
      [`${repoPath}/pulls/12`]: { ...pullRequest(secondHead), base: { ref: "other", repo: { full_name: repository } } },
    }],
    ["no CLA run", { [workflowRunsPath(secondHead)]: [{ workflow_runs: [] }] }],
    ["failed newer CLA run followed by a successful closure", {
      [workflowRunsPath(secondHead)]: [{ workflow_runs: [
        workflowRun(secondHead, 112, 12, "opened"),
        { ...workflowRun(secondHead, 113, 12), conclusion: "failure" },
        workflowRun(secondHead, 114, 12, "closed"),
      ] }],
    }],
    ["another workflow with the same run title", {
      [workflowRunsPath(secondHead)]: [{ workflow_runs: [
        { ...workflowRun(secondHead, 112, 12), path: ".github/workflows/other.yml" },
      ] }],
    }],
    ["a workflow from a different event", {
      [workflowRunsPath(secondHead)]: [{ workflow_runs: [
        { ...workflowRun(secondHead, 112, 12), event: "issue_comment" },
      ] }],
    }],
    ["stale CLA head", {
      [workflowRunsPath(secondHead)]: [{ workflow_runs: [workflowRun(firstHead, 112, 12)] }],
    }],
    ["another PR sharing the same commit", {
      [workflowRunsPath(secondHead)]: [{ workflow_runs: [workflowRun(secondHead, 112, 11)] }],
    }],
  ]) {
    const rejected = run(overrides);
    assert.equal(rejected.error, undefined, label);
    assert.equal(rejected.signal, null, label);
    assert.notEqual(rejected.status, 0, label);
  }
});
