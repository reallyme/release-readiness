// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { installAndroidRuntimeApk, readAndroidGuestLogs, waitForAndroidRuntime } from "../scripts/android-runtime.mjs";
import { checkAndroidPublication } from "../scripts/android-publication.mjs";

const readyResponses = new Map([
  ["get-state", "device\n"],
  ["shell getprop sys.boot_completed", "1\r\n"],
  ["shell am get-started-user-state 0", "RUNNING_UNLOCKED\r\n"],
  ["shell service check package", "Service package: found\r\n"],
  ["shell service check mount", "Service mount: found\r\n"],
  ["shell cmd package path --user 0 android", "package:/system/framework/framework-res.apk\r\n"],
  ["shell sm list-volumes private", "private mounted null\r\n"],
]);

const adbResult = (stdout, status = 0) => ({ stdout, status });

function fixture(overrides = new Map()) {
  let timestamp = 0;
  const calls = [];
  return {
    calls,
    dependencies: {
      now: () => timestamp,
      pause: async (ms) => { timestamp += ms; },
      execute: (adb, args, options) => {
        assert.equal(adb, "/sdk/platform-tools/adb");
        assert.deepEqual(args.slice(0, 2), ["-s", "emulator-5554"]);
        assert.ok(options.timeout > 0 && options.timeout <= 5_000);
        const command = args.slice(2).join(" ");
        assert.ok(readyResponses.has(command), command);
        calls.push({ command, timeout: options.timeout });
        const reply = overrides.get(command);
        return reply?.shift() ?? adbResult(readyResponses.get(command));
      },
    },
  };
}

const options = { serial: "emulator-5554", waitSeconds: 7, adb: "/sdk/platform-tools/adb" };

test("Android readiness selects one device and succeeds only after transport and services recover", async () => {
  const { calls, dependencies } = fixture(new Map([
    ["get-state", [adbResult("offline\n")]],
    ["shell cmd package path --user 0 android", [adbResult("", 1)]],
    ["shell sm list-volumes private", [adbResult("private checking null\n")]],
  ]));
  assert.deepEqual(await waitForAndroidRuntime(options, dependencies), { kind: "ready" });
  assert.equal(calls.filter(({ command }) => command === "get-state").length, 4);
  assert.equal(calls.at(-1).command, "shell sm list-volumes private");
});

test("the CI cold-boot allowance can recover after the local readiness deadline", async () => {
  const delayedTransport = () => fixture(new Map([
    // ADB first discovers the cold emulator after the 120-second local deadline.
    ["get-state", Array(61).fill(adbResult("offline\n"))],
  ]));
  assert.deepEqual(await waitForAndroidRuntime({ ...options, waitSeconds: 120 }, delayedTransport().dependencies), {
    kind: "timeout", stage: "ADB transport", reason: "reported not ready",
  });
  assert.deepEqual(await waitForAndroidRuntime({ ...options, waitSeconds: 420 }, delayedTransport().dependencies), {
    kind: "ready",
  });
});

test("Android readiness distinguishes storage timeout from successful Android boot", async () => {
  for (const response of [
    "public:1 mounted FAT\nprivate unmounted null\n",
    "private mounted_ro null\n",
    "private:42 mounted ADOPTED\n",
    "private checking null\n",
    "",
  ]) {
    const { calls, dependencies } = fixture(new Map([
      ["shell sm list-volumes private", Array(4).fill(adbResult(response))],
    ]));
    assert.deepEqual(await waitForAndroidRuntime(options, dependencies), {
      kind: "timeout", stage: "private storage", reason: "reported not ready",
    });
    assert.equal(calls.at(-1).timeout, 1_000);
  }
});

test("Android readiness rejects the successful command response for a missing Binder service", async () => {
  for (const [service, stage] of [["package", "package service"], ["mount", "storage service"]]) {
    const { calls, dependencies } = fixture(new Map([
      [`shell service check ${service}`, [adbResult(`Service ${service}: not found\r\n`)]],
    ]));
    assert.deepEqual(await waitForAndroidRuntime({ ...options, waitSeconds: 1 }, dependencies), {
      kind: "timeout", stage, reason: "reported not ready",
    });
    assert.equal(calls.at(-1).command, `shell service check ${service}`);
  }
});

test("Android readiness fails closed on hung probes, command errors, and malformed input", async () => {
  const locked = fixture(new Map([
    ["shell am get-started-user-state 0", [adbResult("RUNNING_LOCKED\n")]],
  ]));
  assert.deepEqual(await waitForAndroidRuntime({ ...options, waitSeconds: 1 }, locked.dependencies), {
    kind: "timeout", stage: "system user unlock", reason: "reported not ready",
  });
  assert.ok(locked.calls.every(({ timeout }) => timeout === 1_000));

  const timedOut = fixture(new Map([
    ["get-state", [{ error: { code: "ETIMEDOUT" }, status: null }]],
  ]));
  assert.deepEqual(await waitForAndroidRuntime({ ...options, waitSeconds: 1 }, timedOut.dependencies), {
    kind: "timeout", stage: "ADB transport", reason: "ADB command timed out",
  });
  const missing = fixture(new Map([
    ["get-state", [{ error: { code: "ENOENT" }, status: null }]],
  ]));
  assert.deepEqual(await waitForAndroidRuntime(options, missing.dependencies), { kind: "adb-unavailable" });
  for (const invalid of [
    { serial: undefined }, { serial: "--other-device" }, { serial: "emulator 5554" },
    { waitSeconds: 0 }, { waitSeconds: Infinity }, { waitSeconds: 601 }, { adb: "" },
  ]) {
    const { calls, dependencies } = fixture();
    assert.deepEqual(await waitForAndroidRuntime({ ...options, ...invalid }, dependencies), { kind: "invalid-input" });
    assert.deepEqual(calls, []);
  }
});

test("Android install distinguishes a disconnected package service from an APK rejection", (t) => {
  const root = mkdtempSync(join(tmpdir(), "reallyme-android-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const apk = join(root, "consumer release.apk");
  writeFileSync(apk, "fixture");
  const install = (response) => installAndroidRuntimeApk({ ...options, apk }, (adb, args, runnerOptions) => {
    assert.equal(adb, options.adb);
    assert.deepEqual(args, ["-s", options.serial, "install", "--no-streaming", "-r", apk]);
    assert.ok(runnerOptions.timeout > 0);
    return { stdout: "", stderr: "", ...response };
  });
  const brokenPipe = "Performing Push Install\ncmd: Failure calling service package: Broken pipe (32)\r\n";
  assert.deepEqual(install({ status: 0, stdout: "Performing Push Install\nSuccess\n" }), { kind: "installed" });
  assert.deepEqual(install({ status: 1, stderr: brokenPipe }), { kind: "package-service-disconnected" });
  assert.deepEqual(install({ status: 1, stderr: brokenPipe + "Failure [INSTALL_FAILED_INVALID_APK]\n" }), {
    kind: "install-failed", reason: "INSTALL_FAILED_INVALID_APK",
  });
  assert.deepEqual(install({ status: 0, stdout: "Success\n", stderr: "Failure [INSTALL_FAILED_INVALID_APK]\n" }), {
    kind: "install-failed", reason: "INSTALL_FAILED_INVALID_APK",
  });
  assert.deepEqual(install({ status: 1, stderr: "adb: Broken pipe\n" }), {
    kind: "install-failed", reason: "ADB did not confirm installation",
  });
  assert.deepEqual(install({ status: 0, stdout: "Success later\n" }), {
    kind: "install-failed", reason: "ADB did not confirm installation",
  });
  assert.deepEqual(install({ status: null, error: { code: "ETIMEDOUT" } }), {
    kind: "install-failed", reason: "ADB command timed out",
  });
  assert.deepEqual(installAndroidRuntimeApk({ ...options, apk: join(root, "missing.apk") }, assert.fail), {
    kind: "invalid-apk",
  });
});

test("Android runtime CLI is runnable locally and returns explicit failure codes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "reallyme-android-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fakeAdb = join(root, "adb");
  const apk = join(root, "consumer.apk");
  writeFileSync(apk, "fixture");
  writeFileSync(fakeAdb, "#!/bin/sh\nprintf '%s\\n' 'cmd: Failure calling service package: Broken pipe (32)' >&2\nexit 1\n", { mode: 0o755 });
  const script = fileURLToPath(new URL("../scripts/android-runtime.mjs", import.meta.url));
  const run = (adb, ...args) => spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ADB: adb },
  });
  assert.equal(run(fakeAdb).status, 2);
  assert.equal(run(fakeAdb, "wait", "emulator-5554", "10.5").status, 2);
  const missing = run(join(root, "missing-adb"), "wait", "emulator-5554");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /could not run adb/u);
  const brokenPipe = run(fakeAdb, "install", "emulator-5554", apk);
  assert.equal(brokenPipe.status, 75, brokenPipe.stderr);
  assert.match(brokenPipe.stderr, /package service disconnected/u);
});

test("Android guest diagnostics keeps partial output and bounds adb when the guest stops responding", () => {
  const logs = readAndroidGuestLogs(options, (adb, args, runnerOptions) => {
    assert.equal(adb, options.adb);
    assert.deepEqual(args, ["-s", options.serial, "logcat", "-d", "-t", "300", "-b", "system,events,crash", "-v", "threadtime", "-v", "printable"]);
    assert.ok(runnerOptions.timeout > 0 && runnerOptions.timeout <= 10_000);
    assert.ok(runnerOptions.maxBuffer <= 524_288);
    return { stdout: "system_server stopped\n", status: null, error: { code: "ETIMEDOUT" } };
  });
  assert.deepEqual(logs, { kind: "guest-logs", output: "system_server stopped\n", complete: false });
});

test("Android publication verifies the exact staged files and source SHA", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "reallyme-android-publication-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sha = "a".repeat(40);
  const repository = join(directory, "repository");
  const versionDirectory = join(repository, "me/really/example/1.2.3");
  mkdirSync(versionDirectory, { recursive: true });
  const aar = join(versionDirectory, "example-1.2.3.aar");
  const pom = join(versionDirectory, "example-1.2.3.pom");
  writeFileSync(aar, "release archive");
  const seal = () => checkAndroidPublication("seal-publication", repository, sha);
  const verify = (candidate = sha) => checkAndroidPublication("verify-publication", repository, candidate);
  assert.equal(await seal(), "invalid-publication");
  writeFileSync(pom, "<project>release metadata</project>");
  assert.equal(await seal(), "publication-verified");
  assert.equal(await verify(), "publication-verified");
  assert.equal(await checkAndroidPublication("verify-publication", repository, sha, "1.2.3"), "publication-verified");
  assert.equal(await checkAndroidPublication("verify-publication", repository, sha, "1.2.4"), "publication-version-mismatch");
  assert.equal(await verify("b".repeat(40)), "publication-mismatch");
  writeFileSync(aar, "changed archive");
  assert.equal(await verify(), "publication-mismatch");
  writeFileSync(aar, "release archive");
  const extra = join(versionDirectory, "extra.xml");
  writeFileSync(extra, "unexpected metadata");
  assert.equal(await verify(), "publication-mismatch");
  rmSync(extra);
  symlinkSync(aar, extra);
  assert.equal(await verify(), "invalid-publication");
  rmSync(extra);
  const hidden = join(versionDirectory, ".unpublished");
  writeFileSync(hidden, "not included by artifact upload");
  assert.equal(await verify(), "invalid-publication");
});

test("Android runtime workflow separates cold restarts from same-device install recovery", async (t) => {
  const template = readFileSync(new URL("../templates/android-runtime.yml", import.meta.url), "utf8");
  const runtime = template.split("        run: |\n").at(-1)
    .split("\n      - name: Upload tested Android publication")[0].replace(/^ {10}/gmu, "");
  assert.match(runtime, /android-runtime\.mjs/u);
  assert.match(runtime, /^readonly readiness_wait_seconds=420$/mu);
  assert.match(runtime, /node "\$helper" wait "\$ANDROID_SERIAL" "\$readiness_wait_seconds"/u);
  assert.match(template, /- name: Prepare Android consumer and emulator\n(?:[^\n]*\n)*? {10}ANDROID_AVD_DEVICE: pixel\n/u);
  assert.ok(template.indexOf("seal-publication") < template.indexOf("bash -e -o pipefail scripts/prepare-android-runtime.sh"));
  // Only successful main runs may write the cache that release builds restore.
  assert.ok(template.indexOf("actions/cache/restore@") < template.indexOf("scripts/stage-android-publication.sh"));
  assert.match(template, /- name: Save Gradle cache\n {8}if: github\.ref == 'refs\/heads\/main' && /u);
  assert.equal([...template.matchAll(/uses: actions\/cache\/save@/gu)].length, 1);
  assert.ok(template.indexOf("Upload tested Android publication") < template.indexOf("Save Gradle cache"));
  assert.ok(template.indexOf("verify-publication") < template.indexOf("Upload tested Android publication"));
  const sha = "a".repeat(40);
  const run = async (scenario) => {
    const root = mkdtempSync(join(tmpdir(), "reallyme-android-workflow-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const path of ["sdk/platform-tools", "sdk/emulator", ".release-readiness/scripts", "scripts", "bin", "publication/repository"]) {
      mkdirSync(join(root, path), { recursive: true });
    }
    for (const file of ["android-runtime.mjs", "android-publication.mjs"]) {
      copyFileSync(fileURLToPath(new URL(`../scripts/${file}`, import.meta.url)), join(root, ".release-readiness/scripts", file));
    }
    const repository = join(root, "publication/repository");
    writeFileSync(join(repository, "example.aar"), "release archive");
    writeFileSync(join(repository, "example.pom"), "<project/>");
    assert.equal(await checkAndroidPublication("seal-publication", repository, sha), "publication-verified");
    const apk = join(root, "consumer.apk");
    const eventsPath = join(root, "events");
    const output = join(root, "outputs");
    writeFileSync(apk, "same release APK");
    writeFileSync(eventsPath, "");
    writeFileSync(output, "");
    const executable = (file, body) => writeFileSync(join(root, file), `#!/bin/sh\nset -eu\n${body}\n`, { mode: 0o755 });
    executable("bin/git", 'printf "%s\\n" "$GITHUB_SHA"');
    executable("bin/timeout", 'shift 2\nexec "$@"');
    executable("bin/node", `
      if [ "$2" = wait ]; then
        while [ ! -e "$RUNNER_TEMP/emulator-running" ]; do sleep 0.02; done
        printf 'wait:%s\\n' "$4" >>"$EVENTS"
        if [ "$SCENARIO" = boot-retry ] && [ ! -e "$RUNNER_TEMP/boot-attempted" ]; then
          : >"$RUNNER_TEMP/boot-attempted"
          exit 75
        fi
        if [ "$SCENARIO" = recovery-timeout ] && [ "$4" = 60 ]; then exit 75; fi
      fi
      exec "$FIXTURE_NODE_PATH" "$@"
    `);
    executable("bin/sleep", `
      if [ "$#" -eq 1 ] && [ "$1" = 5 ]; then
        printf 'install-pause\\n' >>"$EVENTS"
        exit 0
      fi
      exec /bin/sleep "$@"
    `);
    executable("sdk/emulator/emulator", `
      printf 'emulator-start\\n' >>"$EVENTS"
      trap 'rm -f "$RUNNER_TEMP/emulator-running"; printf "emulator-stop\\n" >>"$EVENTS"; exit 0' TERM
      : >"$RUNNER_TEMP/emulator-running"
      # Exit even if the outer test times out before it can run the EXIT trap.
      remaining=75
      while [ "$remaining" -gt 0 ]; do
        sleep 1
        remaining=$((remaining - 1))
      done
      exit 1
    `);
    executable("sdk/platform-tools/adb", `
      if [ "$1" = start-server ]; then exit 0; fi
      test "$1" = -s
      test "$2" = emulator-5554
      shift 2
      case "$*" in
        'get-state')
          while [ ! -e "$RUNNER_TEMP/emulator-running" ]; do sleep 0.02; done
          echo device ;;
        'shell getprop sys.boot_completed') echo 1 ;;
        'shell am get-started-user-state 0') echo RUNNING_UNLOCKED ;;
        'shell service check package') echo 'Service package: found' ;;
        'shell service check mount') echo 'Service mount: found' ;;
        'shell cmd package path --user 0 android') echo package:/system/framework/framework-res.apk ;;
        'shell sm list-volumes private') echo 'private mounted null' ;;
        'install --no-streaming -r '*)
          test "$4" = "$APK_PATH"
          test "$(cat "$4")" = 'same release APK'
          printf 'install\\n' >>"$EVENTS"
          if [ "$SCENARIO" = install-failed ] || [ "$SCENARIO" = recovery-timeout ] ||
             { [ "$SCENARIO" = install-retry ] && [ ! -e "$RUNNER_TEMP/attempted" ]; }; then
            : >"$RUNNER_TEMP/attempted"
            echo 'cmd: Failure calling service package: Broken pipe (32)' >&2
            exit 1
          fi
          if [ "$SCENARIO" = invalid-apk ]; then
            echo 'Failure [INSTALL_FAILED_INVALID_APK]' >&2
            exit 1
          fi
          echo Success ;;
        'logcat -b main -c') printf 'clear-main\\n' >>"$EVENTS" ;;
        'logcat -d -t 300 -b system,events,crash -v threadtime -v printable')
          printf 'guest-diagnostics\\n' >>"$EVENTS"
          echo 'system_server stopped'
          exit 1 ;;
        *) exit 9 ;;
      esac
    `);
    writeFileSync(join(root, "scripts/test-android-runtime.sh"), `
      test "$1" = emulator-5554
      printf 'runtime-test\\n' >>"$EVENTS"
      if [ "$SCENARIO" = changed-publication ]; then printf changed >"$MAVEN_REPOSITORY/example.aar"; fi
      if [ "$SCENARIO" = assertion-failed ]; then exit 19; fi
    `);
    const result = spawnSync("bash", ["-eo", "pipefail", "-c", runtime], {
      cwd: root, encoding: "utf8", timeout: 60_000,
      env: {
        ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, EVENTS: eventsPath, FIXTURE_NODE_PATH: process.execPath,
        ANDROID_HOME: join(root, "sdk"), ANDROID_SERIAL: "emulator-5554", ANDROID_AVD_NAME: "reallyme-runtime",
        APK_PATH: apk, MAVEN_REPOSITORY: repository, RUNNER_TEMP: root, GITHUB_SHA: sha, GITHUB_OUTPUT: output, SCENARIO: scenario,
      },
    });
    return { result, events: readFileSync(eventsPath, "utf8").trim().split("\n"), output: readFileSync(output, "utf8") };
  };
  const success = await run("install-retry");
  assert.equal(success.result.status, 0, success.result.stderr);
  assert.deepEqual(success.events, [
    "emulator-start", "wait:420", "install", "install-pause", "wait:60", "install",
    "clear-main", "runtime-test", "emulator-stop",
  ]);
  assert.equal(success.output, `sha=${sha}\n`);
  const bootRetry = await run("boot-retry");
  assert.equal(bootRetry.result.status, 0, bootRetry.result.stderr);
  assert.deepEqual(bootRetry.events, [
    "emulator-start", "wait:420", "guest-diagnostics", "emulator-stop",
    "emulator-start", "wait:420", "install", "clear-main", "runtime-test", "emulator-stop",
  ]);
  assert.equal(bootRetry.output, `sha=${sha}\n`);
  const exhausted = await run("install-failed");
  assert.equal(exhausted.result.status, 75, exhausted.result.stderr);
  assert.deepEqual(exhausted.events, [
    "emulator-start", "wait:420", "install", "install-pause", "wait:60", "install",
    "install-pause", "wait:60", "install", "guest-diagnostics", "emulator-stop",
  ]);
  assert.equal(exhausted.output, "");
  const recoveryTimeout = await run("recovery-timeout");
  assert.equal(recoveryTimeout.result.status, 75, recoveryTimeout.result.stderr);
  assert.deepEqual(recoveryTimeout.events, [
    "emulator-start", "wait:420", "install", "install-pause", "wait:60", "guest-diagnostics", "emulator-stop",
  ]);
  assert.equal(recoveryTimeout.output, "");
  const rejected = await run("invalid-apk");
  assert.equal(rejected.result.status, 1, rejected.result.stderr);
  assert.deepEqual(rejected.events, ["emulator-start", "wait:420", "install", "guest-diagnostics", "emulator-stop"]);
  assert.equal(rejected.output, "");
  const assertion = await run("assertion-failed");
  assert.equal(assertion.result.status, 19, assertion.result.stderr);
  assert.deepEqual(assertion.events, ["emulator-start", "wait:420", "install", "clear-main", "runtime-test", "guest-diagnostics", "emulator-stop"]);
  assert.match(assertion.result.stderr, /could not be fully collected/u);
  assert.equal(assertion.output, "");
  const changed = await run("changed-publication");
  assert.equal(changed.result.status, 1, changed.result.stderr);
  assert.match(changed.result.stderr, /differs from its verified manifest/u);
  assert.equal(changed.output, "");
});
