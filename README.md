<!--
SPDX-FileCopyrightText: Copyright © 2026 ReallyMe LLC. All rights reserved

SPDX-License-Identifier: Apache-2.0
-->

# ReallyMe Release Readiness

[![Release Readiness](https://github.com/reallyme/release-readiness/actions/workflows/checks.yml/badge.svg)](https://github.com/reallyme/release-readiness/actions/workflows/checks.yml)

Shared release-readiness guardrails for ReallyMe repositories.

This package contains a small, dependency-free Node.js core used by ReallyMe
release scripts. Sister repositories can vendor the core byte-for-byte for
offline local use. Remote CI should execute the current shared repository
runner so policy fixes do not remain trapped in stale local copies.

## What It Checks

- Git-tracked release inputs and repository-contained paths.
- GitHub Actions pinned to full commit SHAs, with Node jobs pinned to Node 24.
- Cargo workspace metadata, package surfaces, dependency sources, and publish
  policy.
- SPDX headers for tracked source files.
- Protobuf schema contracts, generated output freshness, and adapter boundary
  checks.
- Generated protobuf hardening checks for redacted Debug output, strict
  ProtoJSON, zeroizing temporary byte owners, recursive unknown-field wiping,
  final-owner zeroization, and closed-world sensitivity classification for
  every `bytes` and `string` schema field.
- Command matrices for repository-specific release suites.

The current vendored-core contract marker is:

```js
assertContains(
  "scripts/release-readiness/core.mjs",
  "RELEASE_READINESS_CORE_CONTRACT_VERSION = 7",
);
```

## Usage

Run this repository's checks with:

```sh
npm run check
```

The GitHub Actions workflow runs the same command on Node 24.

Consumer repositories usually vendor the core into their local release scripts:

```sh
cp core.mjs ../crypto/scripts/release-readiness/core.mjs
cp core.mjs ../cose/scripts/release-readiness/core.mjs
```

Remote CI must pin this repository by a reviewed full commit SHA. Never use a
mutable branch or tag in a credential-bearing workflow:

```sh
npm exec --yes --package=github:reallyme/release-readiness#FULL_COMMIT_SHA -- \
  reallyme-release-readiness
```

Arguments after `reallyme-release-readiness` are passed to the consumer's
`scripts/check_release_readiness.mjs`. The runner requires the tracked vendored
core to be byte-for-byte identical to its immutable upstream core before it
runs the consumer checker.

For a new Rust/protobuf repository, start from
[`templates/check_release_readiness.mjs`](templates/check_release_readiness.mjs)
and the companion [`templates/README.md`](templates/README.md). The template
fails closed until every `REPLACE_*` marker has been replaced.

Generated protobuf freshness checks should snapshot generated outputs, run
`buf lint`, `buf generate`, the repository hardening script such as
`harden-generated-example-proto.mjs`, and `cargo fmt`, then compare the updated
generated tree plus every tracked or non-ignored file outside the declared generated directories.
Hardening scripts must also support `--check-idempotent`; repository checkers
run that mode against checked-in output so a second pass cannot accumulate
comments, derives, debug implementations, or drop implementations.

## Protobuf Notes

Protobuf identifiers are ReallyMe wire identifiers, not provider registry
values. `assertProtoContract` requires neither sparse nor sequential numbering;
it rejects invalid field-number ranges, duplicate identifiers, and reuse of
reserved names or numbers.

Every protobuf `bytes` and `string` field must appear exactly once in
`scalarFieldClassifications`. Mark it `sensitivity: "sensitive"` or
`sensitivity: "public"` explicitly and include its schema kind and owning
message. The checker rejects unclassified schema additions, duplicate entries,
kind mismatches, and stale classifications. Sensitive entries additionally
require message-scoped Debug redaction, generated-path and final-owner wiping,
and a zeroizing ProtoJSON staging owner. Nested messages fail closed until the
classifier is explicitly extended to represent their ownership path.

The executable adapter boundary is intentionally narrow: the proto crate owns
messages only, exposes no protobuf service, accepts binary protobuf and
generated ProtoJSON requests, and returns the same binary status/payload result
envelope from both paths.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

## Copyright and Trademarks

Copyright © 2026 by ReallyMe LLC.

ReallyMe® is a registered trademark of ReallyMe LLC.
