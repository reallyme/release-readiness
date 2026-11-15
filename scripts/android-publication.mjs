// SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const MAX_MANIFEST_BYTES = 1_048_576;
const SHA = /^[0-9a-f]{40}$/u;
const STABLE_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const MAVEN_PATH_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.+-]*$/u;

async function hashPublication(repository) {
  const files = [];
  const visit = async (directory, prefix) => {
    for (const name of (await readdir(directory)).sort()) {
      const location = join(directory, name);
      const path = prefix + name;
      const entry = await lstat(location);
      // Upload and download must see exactly the files hashed here. In
      // particular, artifact upload omits hidden files by default.
      if (!MAVEN_PATH_SEGMENT.test(name) || (!entry.isDirectory() && !entry.isFile())) return false;
      if (entry.isDirectory()) {
        if (!await visit(location, `${path}/`)) return false;
        continue;
      }
      if (entry.size === 0) return false;
      const hash = createHash("sha256");
      for await (const bytes of createReadStream(location)) hash.update(bytes);
      files.push({ path, sha256: hash.digest("hex") });
    }
    return true;
  };
  if (!(await lstat(repository)).isDirectory() || !await visit(repository, "")) return null;
  const paths = new Set(files.map(({ path }) => path));
  const archives = files.filter(({ path }) => path.endsWith(".aar"));
  if (archives.length === 0 || archives.some(({ path }) => !paths.has(path.replace(/\.aar$/u, ".pom")))) {
    return null;
  }
  return files;
}

export async function checkAndroidPublication(command, input, sourceSha, releaseVersion) {
  if (!["seal-publication", "verify-publication"].includes(command) ||
      typeof sourceSha !== "string" || !SHA.test(sourceSha) ||
      typeof input !== "string" || input.length === 0 || input.includes("\0") ||
      (releaseVersion !== undefined && (command !== "verify-publication" ||
        typeof releaseVersion !== "string" || !STABLE_VERSION.test(releaseVersion)))) {
    return "invalid-input";
  }
  const repository = resolve(input);
  if (basename(repository) !== "repository") return "invalid-input";
  const manifestPath = join(dirname(repository), "sha256.json");
  try {
    const files = await hashPublication(repository);
    if (files === null) return "invalid-publication";
    if (releaseVersion !== undefined && files.some(({ path }) => {
      if (!path.endsWith(".aar")) return false;
      const segments = path.split("/");
      const [artifact, version, archive] = segments.slice(-3);
      return segments.length < 4 || version !== releaseVersion || archive !== `${artifact}-${version}.aar`;
    })) {
      return "publication-version-mismatch";
    }
    const manifest = JSON.stringify({ schema: 1, sourceSha, files }) + "\n";
    if (Buffer.byteLength(manifest) > MAX_MANIFEST_BYTES) return "invalid-publication";
    if (command === "seal-publication") {
      await writeFile(manifestPath, manifest, { flag: "wx" });
    } else {
      const file = await lstat(manifestPath);
      if (!file.isFile() || file.size > MAX_MANIFEST_BYTES ||
          await readFile(manifestPath, "utf8") !== manifest) {
        return "publication-mismatch";
      }
    }
    return "publication-verified";
  } catch {
    return "publication-io-failed";
  }
}
