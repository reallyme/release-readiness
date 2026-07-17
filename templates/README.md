<!--
SPDX-FileCopyrightText: Copyright © 2026 ReallyMe LLC. All rights reserved

SPDX-License-Identifier: Apache-2.0
-->

# Local Release Checker Template

Use this template for a ReallyMe Rust repository that owns an executable
protobuf/ProtoJSON adapter lane.

Install both files from the same reviewed central revision:

```sh
mkdir -p scripts/release-readiness
cp ../release-readiness/core.mjs scripts/release-readiness/core.mjs
cp ../release-readiness/templates/check_release_readiness.mjs scripts/check_release_readiness.mjs
```

Then replace every `REPLACE_*` marker. The checker fails closed while any
marker remains. Do not copy shared helper implementations into the local
script; add generally applicable policy to `core.mjs` and propagate that exact
file to every consumer.

The template enables the following mandatory baseline through
`assertReallyMeRustProtoRepositoryPolicy`:

- the checker and vendored core are Git-tracked and use the expected contract;
- GitHub Actions are pinned to immutable commits and Node jobs use Node 24;
- cargo-fuzz installs are exact-version pinned, locked, and present in both
  pull-request and scheduled fuzz lanes through named workflow steps;
- Cargo workspace lints, publish include allowlists, and publishable path
  dependency versions are validated;
- tracked hand-written sources carry ReallyMe Apache-2.0 SPDX headers;
- protobuf defines messages only, one self-describing operation request, and
  one binary status/payload result envelope;
- generated ProtoJSON is a request convenience and returns that same binary
  envelope;
- every declared SDK adapter exposes both generic protobuf and generated
  ProtoJSON entrypoints and references the binary result envelope;
- generated sensitive fields have redacted Debug, zeroizing JSON temporaries,
  final-owner zeroization, recursive unknown-field wiping, and strict unknown
  JSON rejection;
- protobuf regeneration cannot modify files outside declared generated paths;
- protobuf CI owns the pinned `buf`/Buffa toolchain and invokes generated
  freshness exactly once.

Keep component-specific algorithm, vector, provider, package, and documentation
invariants below the marked boundary at the end of the local script. When a
local assertion is useful to more than one repository, promote it into the
central core or its declarative policy rather than duplicating it.
