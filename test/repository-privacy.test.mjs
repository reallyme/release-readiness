// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertRepositoryPrivacy, assertPushPrivacy, checkNpmPublication, checkPublication, installPrivacyHooks, LOCAL_ONLY_RULES, RepositoryPrivacyError } from "../scripts/repository-privacy.mjs";

const cli = fileURLToPath(new URL("../scripts/repository-privacy.mjs", import.meta.url));
const baseline = `${LOCAL_ONLY_RULES.join("\n")}\n`;
const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), "reallyme-privacy-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(root, "no-global-config") };
  for (const key of ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX"]) delete env[key];
  const run = (...args) => spawnSync("git", ["-c", "user.name=ReallyMe Test", "-c", "user.email=test@really.me", ...args], {
    cwd: root, env, encoding: "utf8", timeout: 10_000,
  });
  const git = (...args) => {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (path, contents = "local data\n") => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };
  git("init", "--quiet", "--initial-branch=main");
  write(".gitignore", baseline);
  git("add", ".gitignore");
  const check = (extra = {}) => assertRepositoryPrivacy({ root, env, ...extra });
  const commit = (message) => {
    git("commit", "--quiet", "-m", message);
    return git("rev-parse", "HEAD");
  };
  return { root, env, run, git, write, check, commit };
};
const code = (expected) => (error) => error instanceof RepositoryPrivacyError && error.code === expected;

test("privacy uses the complete index, nested rules and Git negations", (t) => {
  const { git, write, check } = fixture(t);
  write(".gitignore", `${baseline}*.env\n!example.env\n`);
  write("nested/.gitignore", "!public.env\n");
  write("nested/public.env");
  write("example.env");
  git("add", ".");
  assert.doesNotThrow(check);
  write("nested/private\nvalue.env");
  git("add", "-f", "nested/private\nvalue.env");
  assert.throws(check, (error) => code("TRACKED_IGNORED_FILES")(error) && error.paths.includes("nested/private\nvalue.env"));
});

test("every local-only name is forbidden at every depth even when force-added or negated", (t) => {
  const { git, write, check } = fixture(t);
  write(".gitignore", `${baseline}!nested/AGENTS.md\n`);
  git("add", ".gitignore");
  for (const rule of LOCAL_ONLY_RULES) {
    const path = `nested/${rule}${rule.endsWith("/") ? "private.txt" : ""}`;
    write(path);
    git("add", "-f", path);
  }
  write("deep/agents.md");
  git("add", "-f", "deep/agents.md");
  assert.throws(check, (error) => code("LOCAL_ONLY_PATH")(error) && error.paths.length === 6);
});

test("new ignore rules reject previously tracked files and unstaged removals cannot hide them", (t) => {
  const { git, write, check } = fixture(t);
  write("private.env");
  git("add", "private.env");
  write(".gitignore", `${baseline}*.env\n`);
  git("add", ".gitignore");
  write(".gitignore", baseline);
  assert.throws(check, code("TRACKED_IGNORED_FILES"));
});

test("root-only exclusions and absent repository-wide rules fail closed", (t) => {
  const { git, write, check } = fixture(t);
  write(".gitignore", LOCAL_ONLY_RULES.map((rule) => `/${rule}`).join("\n") + "\n");
  git("add", ".gitignore");
  assert.throws(check, code("MISSING_REPOSITORY_WIDE_LOCAL_RULES"));
});

test("developer/global excludes do not silently change the shared policy", (t) => {
  const { root, git, write, check } = fixture(t);
  write("allowed.txt");
  git("add", "allowed.txt");
  writeFileSync(join(root, ".git/info/exclude"), "*.txt\n");
  write("nested/.gitignore", "*.txt\n");
  assert.doesNotThrow(check);
});

test("partial commits respect the alternate index", (t) => {
  const { root, env, git, write, check } = fixture(t);
  write(".gitignore", `${baseline}*.env\n`);
  git("add", ".gitignore");
  const index = join(root, "alternate.index");
  copyFileSync(join(root, ".git/index"), index);
  write("private.env");
  const alternateEnv = { ...env, GIT_INDEX_FILE: index };
  const added = spawnSync("git", ["add", "-f", "private.env"], { cwd: root, env: alternateEnv, encoding: "utf8" });
  assert.equal(added.status, 0, added.stderr);
  assert.doesNotThrow(check);
  assert.throws(() => check({ env: alternateEnv }), code("TRACKED_IGNORED_FILES"));
});

test("symlink ignore files cannot change policy outside the staged tree", { skip: process.platform === "win32" }, (t) => {
  const { root, git, write, check } = fixture(t);
  write("rules", baseline);
  rmSync(join(root, ".gitignore"));
  symlinkSync("rules", join(root, ".gitignore"));
  git("add", ".gitignore", "rules");
  assert.throws(check, code("IGNORE_FILE_MUST_BE_REGULAR"));
});

test("push checks actual outgoing commits rather than a clean worktree or only the tip", (t) => {
  const { root, env, git, write, commit } = fixture(t);
  const base = commit("Public baseline");
  write("AGENTS.md");
  git("add", "-f", "AGENTS.md");
  commit("Local-only file");
  git("rm", "--cached", "AGENTS.md");
  const clean = commit("Stop tracking local-only file");
  assert.throws(() => assertPushPrivacy({ root, env, updates: `refs/heads/main ${clean} refs/heads/main ${base}\n` }), code("LOCAL_ONLY_PATH"));
});

test("new branch checks old trees against its current ignore rules", (t) => {
  const { root, env, git, write, commit } = fixture(t);
  write("private.env");
  git("add", "private.env");
  commit("Old source tree");
  git("rm", "--cached", "private.env");
  write(".gitignore", `${baseline}*.env\n`);
  git("add", ".gitignore");
  const tip = commit("Current privacy rules");
  assert.throws(() => assertPushPrivacy({ root, env, updates: `refs/heads/new ${tip} refs/heads/new ${"0".repeat(40)}\n` }), code("TRACKED_IGNORED_FILES"));
});

test("safe outgoing commits and deletions pass; unknown baselines and malformed input fail", (t) => {
  const { root, env, git, write, commit } = fixture(t);
  const base = commit("Public baseline");
  write("public.txt");
  git("add", "public.txt");
  const tip = commit("Public source");
  assert.equal(assertPushPrivacy({ root, env, updates: `refs/heads/main ${tip} refs/heads/main ${base}\n` }), 1);
  assert.equal(assertPushPrivacy({ root, env, updates: `refs/heads/old ${"0".repeat(40)} refs/heads/old ${base}\n` }), 0);
  assert.throws(() => assertPushPrivacy({ root, env, updates: `refs/heads/main ${tip} refs/heads/main ${"f".repeat(40)}\n` }), code("GIT_CHECK_FAILED"));
  assert.throws(() => assertPushPrivacy({ root, env, updates: "invalid\n" }), code("INVALID_PUSH_UPDATES"));
});

test("installed hooks block an actual force-added commit and preserve existing hook managers", (t) => {
  const { root, env, git, write, run, commit } = fixture(t);
  commit("Public baseline");
  installPrivacyHooks({ root, env });
  installPrivacyHooks({ root, env });
  write("AGENTS.md");
  git("add", "-f", "AGENTS.md");
  const rejected = run("commit", "-m", "Private file must not enter history");
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /LOCAL_ONLY_PATH/u);
  assert.equal(git("log", "-1", "--format=%s"), "Public baseline");
  const preCommit = join(root, ".git/hooks/pre-commit");
  writeFileSync(preCommit, "#!/bin/sh\nexit 0\n");
  chmodSync(preCommit, 0o755);
  assert.throws(() => installPrivacyHooks({ root, env }), code("EXISTING_HOOK_REQUIRES_INTEGRATION"));
  assert.equal(readFileSync(preCommit, "utf8"), "#!/bin/sh\nexit 0\n");
});

test("artifact checks allow generated outputs and reject private local state", (t) => {
  const { root, git, write } = fixture(t);
  write(".gitignore", `${baseline}*.env\noutput/\n`);
  git("add", ".gitignore");
  write("output/stage/dist/public.js");
  assert.doesNotThrow(() => checkPublication({ root, artifact: join(root, "output/stage") }));
  write("output/stage/.env");
  assert.throws(() => checkPublication({ root, artifact: join(root, "output/stage") }), code("PRIVATE_PUBLICATION_PATH"));
});

test("archive checks inspect real tar, nested ZIP/JAR contents and reject traversal", (t) => {
  const { root, git, write } = fixture(t);
  write(".gitignore", `${baseline}/.env\n`);
  git("add", ".gitignore");
  const script = `import io, pathlib, tarfile, zipfile
root=pathlib.Path(${JSON.stringify(root)})
for name,entry in [('safe','package/public.txt'),('private','package/.env'),('instructions','package/AGENTS.md'),('traversal','../outside')]:
 with tarfile.open(root/(name+'.tgz'),'w:gz') as archive:
  payload=b'fixture';info=tarfile.TarInfo(entry);info.size=len(payload);archive.addfile(info,io.BytesIO(payload))
inner=io.BytesIO()
with zipfile.ZipFile(inner,'w') as archive: archive.writestr('.local/private.txt','fixture')
with zipfile.ZipFile(root/'nested.aar','w') as archive: archive.writestr('classes.jar',inner.getvalue())
`;
  const created = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  assert.doesNotThrow(() => checkPublication({ root, artifact: join(root, "safe.tgz"), stripComponents: 1 }));
  assert.throws(() => checkPublication({ root, artifact: join(root, "private.tgz"), stripComponents: 1 }), code("PRIVATE_PUBLICATION_PATH"));
  assert.throws(() => checkPublication({ root, artifact: join(root, "instructions.tgz"), stripComponents: 1 }), code("LOCAL_ONLY_PATH"));
  assert.throws(() => checkPublication({ root, artifact: join(root, "nested.aar") }), code("LOCAL_ONLY_PATH"));
  assert.throws(() => checkPublication({ root, artifact: join(root, "traversal.tgz") }), code("ARTIFACT_INSPECTION_FAILED"));
});

test("privacy CLI rejects unknown arguments and missing repositories", (t) => {
  const { root, env } = fixture(t);
  const invoke = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: "utf8" });
  assert.equal(invoke(["--unknown"]).status, 1);
  if (process.platform !== "win32") {
    const link = join(root, "privacy-entry.mjs");
    symlinkSync(cli, link);
    const linked = spawnSync(process.execPath, [link, "--unknown"], { cwd: root, env, encoding: "utf8" });
    assert.equal(linked.status, 1);
    assert.match(linked.stderr, /UNSUPPORTED_ARGUMENTS/u);
  }
  rmSync(join(root, ".git"), { recursive: true, force: true });
  assert.equal(invoke([]).status, 1);
});

test("installed pre-push hook rejects a private intermediate commit before a real local push", (t) => {
  const { root, env, git, run, write, commit } = fixture(t);
  commit("Public baseline");
  const remote = mkdtempSync(join(tmpdir(), "reallyme-privacy-remote-"));
  t.after(() => rmSync(remote, { recursive: true, force: true }));
  const initialized = spawnSync("git", ["init", "--bare", "--quiet", remote], { env, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  installPrivacyHooks({ root, env });
  git("push", remote, "main");
  write("AGENTS.md");
  git("add", "-f", "AGENTS.md");
  git("commit", "--quiet", "--no-verify", "-m", "Private intermediate fixture");
  git("rm", "--cached", "AGENTS.md");
  git("commit", "--quiet", "--no-verify", "-m", "Public tip fixture");
  const rejected = run("push", remote, "main");
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /LOCAL_ONLY_PATH/u);
  const remoteTip = spawnSync("git", ["--git-dir", remote, "log", "main", "-1", "--format=%s"], { env, encoding: "utf8" });
  assert.equal(remoteTip.stdout.trim(), "Public baseline");
});

test("artifact directory and framework symlink policies apply to empty directories and link targets", { skip: process.platform === "win32" }, (t) => {
  const { root, git, write } = fixture(t);
  write(".gitignore", `${baseline}dist/\n`);
  git("add", ".gitignore");
  write("stage/Framework/Versions/A/library");
  symlinkSync("A", join(root, "stage/Framework/Versions/Current"));
  assert.doesNotThrow(() => checkPublication({ root, artifact: join(root, "stage") }));
  mkdirSync(join(root, "stage/.local"));
  assert.throws(() => checkPublication({ root, artifact: join(root, "stage") }), code("LOCAL_ONLY_PATH"));
  rmSync(join(root, "stage/.local"), { recursive: true });
  symlinkSync("../../../../outside", join(root, "stage/Framework/Versions/Escape"));
  assert.throws(() => checkPublication({ root, artifact: join(root, "stage") }), code("ARTIFACT_INSPECTION_FAILED"));
});

test("release upload validation binds the blocking check to the immediately following payload", (t) => {
  const { root, write } = fixture(t);
  const source = `on: workflow_dispatch
jobs:
  package:
    runs-on: ubuntu-24.04
    steps:
      - name: Verify publication privacy
        shell: bash
        env:
          PUBLICATION_PATH: \${{ runner.temp }}/publication
        run: node .release-readiness/scripts/repository-privacy.mjs --artifact "$PUBLICATION_PATH"
      - name: Upload package
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9
        with:
          name: package
          path: \${{ runner.temp }}/publication
`;
  const verify = (workflow) => {
    write("publication.yml", workflow);
    return spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { createReleaseReadinessContext } from ${JSON.stringify(import.meta.resolve("../core.mjs"))};
      import { assertPublicationPrivacyWorkflow } from ${JSON.stringify(import.meta.resolve("../scripts/public-release.mjs"))};
      const context = createReleaseReadinessContext({ scriptUrl: import.meta.url, repoRoot: ${JSON.stringify(root)}, requireTrackedFiles: false });
      assertPublicationPrivacyWorkflow(context, "publication.yml");
    `], { encoding: "utf8" });
  };
  assert.equal(verify(source).status, 0);
  const multiline = source
    .replace("PUBLICATION_PATH: \${{ runner.temp }}/publication", "PUBLICATION_PATH: |\n            build/swift/Library.xcframework.zip\n            build/swift/Library.xcframework.checksum")
    .replace("path: \${{ runner.temp }}/publication", "path: |\n            build/swift/Library.xcframework.zip\n            build/swift/Library.xcframework.checksum");
  const compatibleSwift = verify(multiline);
  assert.equal(compatibleSwift.status, 0, compatibleSwift.stderr);
  for (const invalid of [
    source.replace(' --artifact "$PUBLICATION_PATH"', ' --artifact "$PUBLICATION_PATH" || true'),
    source.replace("      - name: Verify publication privacy", "      - name: Verify publication privacy\n        if: false"),
    source.replace("        shell: bash", "        shell: bash\n        continue-on-error: true"),
    source.replace("PUBLICATION_PATH: \${{ runner.temp }}/publication", "PUBLICATION_PATH: /different"),
    source.replace("      - name: Upload package", "      - name: Mutate payload\n        run: echo changed\n      - name: Upload package"),
    source.replace("      - name: Upload package", "      - name: Upload package\n        if: always()"),
    source.replace("        shell: bash", "        shell: sh"),
  ]) {
    const result = verify(invalid);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /publication privacy/u);
  }
});

test("npm permits its generated dist package but rejects private files from the actual packlist", (t) => {
  const { root, git, write } = fixture(t);
  write(".gitignore", `${baseline}dist/\n*.env\n`);
  write("package.json", JSON.stringify({ name: "privacy-fixture", version: "1.0.0", files: ["dist/"] }));
  write(".npmignore", "");
  write("dist/public.js");
  git("add", ".");
  assert.doesNotThrow(() => checkNpmPublication({ root }));
  write("dist/.env");
  assert.throws(() => checkNpmPublication({ root }), code("PRIVATE_PUBLICATION_PATH"));
});

test("CI-built Maven and Swift products can be published from Git-ignored build directories", (t) => {
  const { root, git, write } = fixture(t);
  write(".gitignore", `${baseline}build/\ntarget/\ndist/\n*.jar\n`);
  git("add", ".gitignore");
  write(".build/release/Library.xcframework/Info.plist", "fixture metadata\n");
  write(".build/release/Library.xcframework/ios-arm64/library", "fixture binary\n");
  assert.doesNotThrow(() => checkPublication({ root, artifact: join(root, ".build/release") }));
  mkdirSync(join(root, "build/publication"), { recursive: true });
  const created = spawnSync("python3", ["-c", `import zipfile
with zipfile.ZipFile(${JSON.stringify(join(root, "build/publication/library.jar"))},'w') as archive:
 archive.writestr('public/Library.class',b'fixture')
`], { encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  assert.doesNotThrow(() => checkPublication({ root, artifact: join(root, "build/publication") }));
  const nestedCache = ".build/release/Library.xcframework/.build/cache";
  write(nestedCache);
  assert.throws(() => checkPublication({ root, artifact: join(root, ".build/release") }), code("LOCAL_ONLY_PATH"));
});

test("Swift release ZIPs, internal framework links and companion checksums stay unchanged", (t) => {
  const { root, git, write } = fixture(t);
  write(".gitignore", `${baseline}build/\n*.zip\n*.checksum\n`);
  git("add", ".gitignore");
  mkdirSync(join(root, "build/swift"), { recursive: true });
  const archive = join(root, "build/swift/Library.xcframework.zip");
  const created = spawnSync("python3", ["-c", `import stat, zipfile
with zipfile.ZipFile(${JSON.stringify(archive)},'w') as archive:
 archive.writestr('Library.xcframework/Info.plist',b'fixture metadata')
 archive.writestr('Library.xcframework/macos-arm64/Library.framework/Versions/A/Library',b'fixture binary')
 archive.writestr('Library.xcframework/macos-arm64/Library.framework/Modules/Library.swiftmodule/arm64.swiftinterface',b'fixture interface')
 link=zipfile.ZipInfo('Library.xcframework/macos-arm64/Library.framework/Versions/Current')
 link.create_system=3;link.external_attr=(stat.S_IFLNK|0o777)<<16
 archive.writestr(link,'A')
 archive.writestr('Library.dSYM/Contents/Resources/DWARF/Library',b'fixture symbols')
`], { encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  const original = readFileSync(archive);
  const checksum = `${createHash("sha256").update(original).digest("hex")}\n`;
  write("build/swift/Library.xcframework.checksum", checksum);
  const selection = "build/swift/Library.xcframework.zip\nbuild/swift/Library.xcframework.checksum\n";
  assert.doesNotThrow(() => checkPublication({ root, artifact: selection }));
  assert.deepEqual(readFileSync(archive), original);
  assert.equal(readFileSync(join(root, "build/swift/Library.xcframework.checksum"), "utf8"), checksum);
  assert.throws(() => checkPublication({ root, artifact: "build/swift/*" }), code("PUBLICATION_REQUIRES_LITERAL_PATHS"));
});
