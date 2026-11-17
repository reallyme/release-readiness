#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited
#
# SPDX-License-Identifier: MIT OR Apache-2.0

"""List actual publication entries without extracting or logging their contents."""

import io
import json
import os
import posixpath
from pathlib import Path, PurePosixPath
import stat
import sys
import tarfile
import zipfile
import zlib

MAX_ENTRIES = 100_000
MAX_NESTED_BYTES = 64 * 1024 * 1024
MAX_DEPTH = 4
ARCHIVES = (".zip", ".jar", ".aar", ".crate", ".tgz", ".tar", ".tar.gz", ".tar.xz", ".tar.bz2")


class PublicationError(Exception):
    """Reject an unreadable or ambiguous publication with a fixed diagnostic."""


def reject_walk_error(_error):
    raise PublicationError("UNREADABLE_STAGING_DIRECTORY")


def canonical(name):
    if not isinstance(name, str) or not name or "\\" in name or "\x00" in name:
        raise PublicationError("INVALID_PATH")
    if name.startswith("/") or (len(name) > 1 and name[1] == ":"):
        raise PublicationError("INVALID_PATH")
    # Tar commonly uses a leading './'. It is a root marker, not traversal.
    while name.startswith("./"):
        name = name[2:]
    name = name.rstrip("/")
    if not name or any(part in ("", ".", "..") for part in name.split("/")):
        raise PublicationError("INVALID_PATH")
    name.encode("utf-8", errors="strict")
    return name


class Inventory:
    def __init__(self):
        self.paths = []
        self.nested_bytes = 0
        self.entries = 0

    def add(self, name, prefix="", strip=0, directory=False):
        source = canonical(name)
        parts = source.split("/")
        if len(parts) <= strip and not directory:
            raise PublicationError("STRIP_REMOVES_FILE")
        suffix = "/" if directory else ""
        logical = "/".join(parts[strip:]) if len(parts) > strip else source
        if strip:
            # A wrapper removal must never hide an excluded directory name.
            original = str(PurePosixPath(prefix) / source) if prefix else source
            self.paths.append(original + suffix)
        path = str(PurePosixPath(prefix) / logical) if prefix else logical
        self.paths.append(canonical(path) + suffix)
        self.entries += 1
        if self.entries > MAX_ENTRIES:
            raise PublicationError("TOO_MANY_ENTRIES")
        return path

    def link(self, path, target):
        if not target or len(target) > 4096 or "\\" in target or "\x00" in target:
            raise PublicationError("INVALID_LINK_TARGET")
        if target.startswith("/") or (len(target) > 1 and target[1] == ":"):
            raise PublicationError("EXTERNAL_LINK_TARGET")
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(path), target))
        self.add(canonical(resolved))

    def reserve(self, size):
        if size < 0 or self.nested_bytes + size > MAX_NESTED_BYTES:
            raise PublicationError("NESTED_ARCHIVE_TOO_LARGE")
        self.nested_bytes += size

    def nested(self, name, size, reader, depth):
        if not name.lower().endswith(ARCHIVES):
            return
        if depth >= MAX_DEPTH:
            raise PublicationError("NESTED_ARCHIVE_TOO_DEEP")
        self.reserve(size)
        data = reader(size + 1)
        if len(data) != size:
            raise PublicationError("INVALID_ARCHIVE_SIZE")
        prefix = str(PurePosixPath(name).parent)
        self.archive(io.BytesIO(data), prefix="" if prefix == "." else prefix, depth=depth + 1)

    def archive(self, source, prefix="", strip=0, depth=0):
        if zipfile.is_zipfile(source):
            with zipfile.ZipFile(source) as archive:
                seen = set()
                for item in archive.infolist():
                    if item.is_dir():
                        self.add(item.filename, prefix, strip, directory=True)
                        continue
                    normalized = canonical(item.filename)
                    if normalized in seen:
                        raise PublicationError("DUPLICATE_ARCHIVE_ENTRY")
                    seen.add(normalized)
                    path = self.add(item.filename, prefix, strip)
                    if stat.S_ISLNK(item.external_attr >> 16):
                        if item.file_size > 4096:
                            raise PublicationError("INVALID_LINK_TARGET")
                        self.link(path, archive.read(item).decode("utf-8", errors="strict"))
                        continue
                    if path.lower().endswith(ARCHIVES):
                        with archive.open(item) as stream:
                            self.nested(path, item.file_size, stream.read, depth)
            return
        if hasattr(source, "seek"):
            source.seek(0)
        options = {"fileobj": source} if hasattr(source, "read") else {"name": source}
        with tarfile.open(mode="r:*", **options) as archive:
            seen = set()
            for item in archive:
                if item.isdir():
                    if item.name not in (".", "./"):
                        self.add(item.name, prefix, strip, directory=True)
                    continue
                normalized = canonical(item.name)
                if normalized in seen:
                    raise PublicationError("UNSUPPORTED_OR_DUPLICATE_ARCHIVE_ENTRY")
                seen.add(normalized)
                path = self.add(item.name, prefix, strip)
                if item.issym():
                    self.link(path, item.linkname)
                    continue
                if not item.isfile():
                    raise PublicationError("UNSUPPORTED_ARCHIVE_ENTRY")
                if path.lower().endswith(ARCHIVES):
                    stream = archive.extractfile(item)
                    if stream is None:
                        raise PublicationError("UNREADABLE_ARCHIVE_ENTRY")
                    with stream:
                        self.nested(path, item.size, stream.read, depth)

    def inspect(self, source, strip):
        if source.is_symlink():
            raise PublicationError("PUBLICATION_MUST_NOT_BE_SYMLINK")
        if source.is_dir():
            if strip != 0:
                raise PublicationError("STRIP_ONLY_APPLIES_TO_ARCHIVES")
            for directory, names, files in os.walk(source, followlinks=False, onerror=reject_walk_error):
                for name in names:
                    self.add((Path(directory) / name).relative_to(source).as_posix(), directory=True)
                    if (Path(directory) / name).is_symlink():
                        link = Path(directory) / name
                        relative = link.relative_to(source).as_posix()
                        self.add(relative)
                        self.link(relative, os.readlink(link))
                for name in files:
                    path = Path(directory) / name
                    if path.is_symlink():
                        relative = path.relative_to(source).as_posix()
                        self.add(relative)
                        self.link(relative, os.readlink(path))
                        continue
                    if not path.is_file():
                        raise PublicationError("PUBLICATION_MUST_CONTAIN_REGULAR_FILES")
                    relative = path.relative_to(source).as_posix()
                    self.add(relative)
                    if name.lower().endswith(ARCHIVES):
                        prefix = str(PurePosixPath(relative).parent)
                        self.archive(path, prefix="" if prefix == "." else prefix)
        elif source.is_file() and source.name.lower().endswith(ARCHIVES):
            self.archive(source, strip=strip)
        elif source.is_file():
            self.add(source.name)
        else:
            raise PublicationError("EXPECTED_ARCHIVE_OR_STAGING_DIRECTORY")
        if not self.paths:
            raise PublicationError("EMPTY_PUBLICATION")


def main():
    try:
        if len(sys.argv) != 3:
            raise PublicationError("INVALID_ARGUMENTS")
        inventory = Inventory()
        inventory.inspect(Path(sys.argv[1]), int(sys.argv[2]))
        sys.stdout.write(json.dumps(inventory.paths, ensure_ascii=True))
        return 0
    except (PublicationError, OSError, ValueError, UnicodeError, tarfile.TarError, zipfile.BadZipFile, RuntimeError, EOFError, zlib.error):
        # Paths and archive bytes can contain private data. The caller reports
        # a typed failure; worker diagnostics never disclose archive contents.
        return 1


if __name__ == "__main__":
    sys.exit(main())
