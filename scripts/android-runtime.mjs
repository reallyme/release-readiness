#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { checkAndroidPublication } from "./android-publication.mjs";

const DEFAULT_WAIT_SECONDS = 120;
const MAX_WAIT_SECONDS = 600;
const POLL_INTERVAL_MS = 2_000;
const PROBE_TIMEOUT_MS = 5_000;
const INSTALL_TIMEOUT_MS = 120_000;
const GUEST_LOG_TIMEOUT_MS = 10_000;
const GUEST_LOG_LINES = "300";
const GUEST_LOG_MAX_BYTES = 524_288;
const RETRYABLE_DEVICE_EXIT = 75;
const DEVICE_SERIAL = /^[A-Za-z0-9][A-Za-z0-9_.:\[\]-]{0,127}$/u;

const probes = [
  { stage: "ADB transport", args: ["get-state"], ready: (value) => value === "device" },
  { stage: "Android boot", args: ["shell", "getprop", "sys.boot_completed"], ready: (value) => value === "1" },
  {
    stage: "system user unlock", args: ["shell", "am", "get-started-user-state", "0"],
    ready: (value) => value === "RUNNING_UNLOCKED",
  },
  // `service check` can print "not found" while returning success.
  { stage: "package service", args: ["shell", "service", "check", "package"], ready: (value) => value === "Service package: found" },
  { stage: "storage service", args: ["shell", "service", "check", "mount"], ready: (value) => value === "Service mount: found" },
  {
    stage: "package manager", args: ["shell", "cmd", "package", "path", "--user", "0", "android"],
    ready: (value) => value.split(/\r?\n/u).some((line) => /^package:\/[^\s]+\.apk$/u.test(line)),
  },
  {
    // Match the internal, writable package volume. Removable media and
    // mounted read-only volumes cannot establish APK install readiness.
    stage: "private storage", args: ["shell", "sm", "list-volumes", "private"],
    ready: (value) => value.split(/\r?\n/u).some((line) => /^private[ \t]+mounted[ \t]+\S+[ \t]*$/u.test(line)),
  },
];

const validDevice = (serial, adb) =>
  typeof serial === "string" && DEVICE_SERIAL.test(serial) &&
  typeof adb === "string" && adb.length > 0 && !adb.includes("\0");

const runAdb = (execute, adb, serial, args, timeout, maxBuffer = 65_536) =>
  execute(adb, ["-s", serial, ...args], {
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  });

const adbUnavailable = (result) => ["ENOENT", "EACCES", "EPERM"].includes(result.error?.code);

export async function waitForAndroidRuntime({ serial, waitSeconds, adb = "adb" }, {
  now = () => performance.now(),
  pause = sleep,
  execute = spawnSync,
} = {}) {
  if (!validDevice(serial, adb) ||
      !Number.isSafeInteger(waitSeconds) || waitSeconds < 1 || waitSeconds > MAX_WAIT_SECONDS) {
    return { kind: "invalid-input" };
  }
  let last = { stage: probes[0].stage, reason: "deadline exceeded" };
  const deadline = now() + waitSeconds * 1_000;
  while (now() < deadline) {
    let ready = true;
    for (const probe of probes) {
      const remaining = deadline - now();
      if (remaining <= 0) {
        return { kind: "timeout", stage: probe.stage, reason: "deadline exceeded" };
      }
      const result = runAdb(execute, adb, serial, probe.args, Math.min(PROBE_TIMEOUT_MS, Math.ceil(remaining)));
      if (adbUnavailable(result)) return { kind: "adb-unavailable" };
      if (result.error !== undefined || result.status !== 0 || !probe.ready(result.stdout.trim())) {
        const reason = result.error?.code === "ETIMEDOUT"
          ? "ADB command timed out"
          : result.status === 0 && result.error === undefined ? "reported not ready" : "ADB command failed";
        last = { stage: probe.stage, reason };
        ready = false;
        break;
      }
    }
    if (ready && now() <= deadline) return { kind: "ready" };
    const remaining = deadline - now();
    if (remaining > 0) await pause(Math.min(POLL_INTERVAL_MS, remaining));
  }
  return { kind: "timeout", ...last };
}

export function installAndroidRuntimeApk({ serial, apk, adb = "adb" }, execute = spawnSync) {
  if (!validDevice(serial, adb) || typeof apk !== "string" || !apk.endsWith(".apk") ||
      apk.startsWith("-") || apk.includes("\0")) {
    return { kind: "invalid-input" };
  }
  try {
    const file = lstatSync(apk);
    if (!file.isFile() || file.size === 0) return { kind: "invalid-apk" };
  } catch {
    return { kind: "invalid-apk" };
  }
  const result = runAdb(execute, adb, serial, ["install", "--no-streaming", "-r", apk], INSTALL_TIMEOUT_MS);
  if (adbUnavailable(result)) return { kind: "adb-unavailable" };
  if (result.error !== undefined) {
    return { kind: "install-failed", reason: result.error.code === "ETIMEDOUT" ? "ADB command timed out" : "ADB command failed" };
  }
  const output = `${result.stdout}\n${result.stderr}`;
  const rejection = /\b(INSTALL_(?:FAILED|PARSE_FAILED)_[A-Z0-9_]+)\b/u.exec(output)?.[1];
  if (rejection !== undefined) return { kind: "install-failed", reason: rejection };
  if (result.status === 0 && /^Success[ \t]*\r?$/mu.test(output)) return { kind: "installed" };
  // Restrict recovery to the package Binder service failure seen in CI.
  // Generic transport errors and APK rejection are still blocking failures.
  if (/^(?:cmd: )?Failure calling service package: Broken pipe(?: \(32\))?[ \t]*\r?$/mu.test(output)) {
    return { kind: "package-service-disconnected" };
  }
  return { kind: "install-failed", reason: "ADB did not confirm installation" };
}

export function readAndroidGuestLogs({ serial, adb = "adb" }, execute = spawnSync) {
  if (!validDevice(serial, adb)) return { kind: "invalid-input" };
  const args = ["logcat", "-d", "-t", GUEST_LOG_LINES, "-b", "system,events,crash", "-v", "threadtime", "-v", "printable"];
  const result = runAdb(execute, adb, serial, args, GUEST_LOG_TIMEOUT_MS, GUEST_LOG_MAX_BYTES);
  if (adbUnavailable(result)) return { kind: "adb-unavailable" };
  return {
    kind: "guest-logs",
    output: result.stdout ?? "",
    complete: result.error === undefined && result.status === 0,
  };
}

async function main(args, env) {
  const [command, serial, argument, releaseVersion] = args;
  let result = { kind: "invalid-input" };
  if (command === "wait" && (args.length === 2 || args.length === 3)) {
    const seconds = argument ?? String(DEFAULT_WAIT_SECONDS);
    const waitSeconds = /^[1-9][0-9]{0,2}$/u.test(seconds) ? Number(seconds) : 0;
    result = await waitForAndroidRuntime({ serial, waitSeconds, adb: env.ADB });
  }
  if (command === "install" && args.length === 3) {
    result = installAndroidRuntimeApk({ serial, apk: argument, adb: env.ADB });
  }
  if (command === "diagnostics" && args.length === 2) {
    result = readAndroidGuestLogs({ serial, adb: env.ADB });
  }
  if ((command === "seal-publication" && args.length === 3) ||
      (command === "verify-publication" && (args.length === 3 || args.length === 4))) {
    result = { kind: await checkAndroidPublication(command, serial, argument, releaseVersion) };
  }
  switch (result.kind) {
    case "ready":
      console.log("Android runtime is ready for APK installation.");
      return 0;
    case "adb-unavailable":
      console.error("Android readiness check could not run adb. Set ADB to the platform-tools executable.");
      return 1;
    case "timeout":
      console.error(`Android readiness timed out at ${result.stage}: ${result.reason}.`);
      return RETRYABLE_DEVICE_EXIT;
    case "installed":
      console.log("Android runtime APK installed.");
      return 0;
    case "package-service-disconnected":
      console.error("Android package service disconnected during APK installation.");
      return RETRYABLE_DEVICE_EXIT;
    case "install-failed":
      console.error(`Android runtime APK installation failed: ${result.reason}.`);
      return 1;
    case "invalid-apk":
      console.error("Android runtime APK must be a non-empty regular file.");
      return 1;
    case "guest-logs":
      console.error("Android guest logcat (system, events, crash)");
      for (const line of result.output.trimEnd().split(/\r?\n/u).filter(Boolean)) {
        console.error(`guest | ${line.replaceAll(/\p{Cc}/gu, "").replaceAll("##[", "# #[")}`);
      }
      if (result.complete) return 0;
      console.error("Android guest logcat could not be fully collected.");
      return 1;
    case "publication-verified":
      console.log("Android Maven publication verified.");
      return 0;
    case "invalid-publication":
      console.error("Android publication must contain non-empty Maven artifacts with a POM for each AAR.");
      return 1;
    case "publication-mismatch":
      console.error("Android publication or source SHA differs from its verified manifest.");
      return 1;
    case "publication-version-mismatch":
      console.error("An Android AAR does not match the selected release version.");
      return 1;
    case "publication-io-failed":
      console.error("Could not read the Android publication or write its manifest.");
      return 1;
    case "invalid-input":
      console.error(`Usage: node android-runtime.mjs wait DEVICE_SERIAL [WAIT_SECONDS (1-${MAX_WAIT_SECONDS})]\n       node android-runtime.mjs install DEVICE_SERIAL APK_PATH\n       node android-runtime.mjs diagnostics DEVICE_SERIAL\n       node android-runtime.mjs seal-publication REPOSITORY_DIRECTORY SOURCE_SHA\n       node android-runtime.mjs verify-publication REPOSITORY_DIRECTORY SOURCE_SHA [RELEASE_VERSION]`);
      return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
