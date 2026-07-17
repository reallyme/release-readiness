<!--
SPDX-FileCopyrightText: Copyright © 2026 ReallyMe LLC. All rights reserved

SPDX-License-Identifier: Apache-2.0
-->

# ReallyMe Release Readiness

[![Release Readiness](https://github.com/reallyme/release-readiness/actions/workflows/checks.yml/badge.svg)](https://github.com/reallyme/release-readiness/actions/workflows/checks.yml)

Shared release-readiness guardrails for ReallyMe repositories.

This package contains a small, dependency-free Node.js core used by ReallyMe
release scripts. Sister repositories can vendor the core byte-for-byte or pin a
reviewed upstream revision so release checks do not drift between projects.

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
  and final-owner zeroization.
- Command matrices for repository-specific release suites.

The current vendored-core contract marker is:

```js
assertContains(
  "scripts/release-readiness/core.mjs",
  "RELEASE_READINESS_CORE_CONTRACT_VERSION = 6",
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

For a new Rust/protobuf repository, start from
[`templates/check_release_readiness.mjs`](templates/check_release_readiness.mjs)
and the companion [`templates/README.md`](templates/README.md). The template
fails closed until every `REPLACE_*` marker has been replaced.

Generated protobuf freshness checks should snapshot generated outputs, run
`buf lint`, `buf generate`, the repository hardening script such as
`harden-generated-example-proto.mjs`, and `cargo fmt`, then compare the updated
generated tree plus every tracked or non-ignored file outside the declared generated directories.

## Protobuf Notes

Protobuf identifiers are ReallyMe wire identifiers, not provider registry
values. `assertProtoContract` requires neither sparse nor sequential numbering;
it rejects invalid field-number ranges, duplicate identifiers, and reuse of
reserved names or numbers.

When a shared field name is sensitive only in one generated message, declare it
as `{ message: "MessageName", field: "field_name" }` so hardening assertions are
scoped to that message.

The executable adapter boundary is intentionally narrow: the proto crate owns
messages only, exposes no protobuf service, accepts binary protobuf and
generated ProtoJSON requests, and returns the same binary status/payload result
envelope from both paths.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

## Copyright and Trademarks

Copyright © 2026 by ReallyMe LLC.

ReallyMe® is a registered trademark of ReallyMe LLC.