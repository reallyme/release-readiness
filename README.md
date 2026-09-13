<!--
SPDX-FileCopyrightText: Copyright © 2026 ReallyMe LLC. All rights reserved

SPDX-License-Identifier: MIT OR Apache-2.0
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
- Workflow permissions matched structurally at the workflow and job scopes, and
  release-critical named steps matched as complete commands rather than loose
  substrings. Repeated step names can be scoped by job.
- Latest stable registry requirements for ReallyMe Crypto, Codec, JOSE, and
  COSE dependencies when they appear in Cargo metadata.
- Cargo workspace metadata, package surfaces, dependency sources, and publish
  policy.
- Rust source structure: hard limits for module and implementation size,
  shrinking-only baselines for existing debt, thin facades, separate tests,
  typed error surfaces, no production panic shortcuts, and no wildcard imports
  or re-exports.
- TypeScript, Swift, and Kotlin source structure: the same 500-line production
  and 800-line separate-test ceilings, shrinking-only baselines, thin declared
  facades, language-specific unsafe-operation checks, and mandatory native
  verification roles.
- Opt-in repository-shape contracts with approved archetypes, declared root
  lanes and sublanes, explicit Cargo crate roles, canonical proto ownership,
  and typed exceptional roots. Organization-neutral runtime-composition and
  infrastructure profiles keep executable hosting separate from deployment
  intent and operational control.
- SPDX headers for tracked source files, with typed generated/vendored/
  third-party exclusions that can be required to match current tracked files.
- Protobuf schema contracts, generated output freshness, and adapter boundary
  checks.
- Granular provider contracts with exact descriptor/request/result/error/response
  surfaces, unique operation parity, correlation, typed outcomes,
  service-separation, codec, runtime, and adapter checks.
- Explicit retired-path enforcement so deprecated examples, trackers, and
  compatibility surfaces cannot remain present or tracked unnoticed.
- Generated protobuf hardening checks for redacted Debug output, strict
  ProtoJSON, zeroizing temporary byte owners, recursive unknown-field wiping,
  final-owner zeroization, and closed-world sensitivity classification for
  every `bytes` and `string` schema field.
- Command matrices for repository-specific release suites.

The current vendored-core contract marker is:

```js
assertContains(
  "scripts/release-readiness/core.mjs",
  "RELEASE_READINESS_CORE_CONTRACT_VERSION = 12",
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
runs the consumer checker. It also detects tracked Rust, TypeScript, Swift, and
Kotlin source and requires the consumer checker to invoke the corresponding
shared source policy. A repository cannot bypass the source rules by omitting a
policy call.

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

For authored Rust, configure `assertRustSourcePolicy` (or the aggregate
`rustSource` policy) with the source roots and generated-source exclusions. Use
`roots: ["."]` to govern every tracked Rust source throughout the repository. The
non-configurable hard ceiling is 500 lines for authored production code and
examples. Separate test files may contain up to 800 lines; test implementations
inside production source are rejected. A production module may declare a
separate test module with `#[cfg(test)] mod tests;`. The same ceilings apply to
authored TypeScript, Swift, and Kotlin. Every tracked source file must be covered
by the declared roots or an explicit generated-source prefix. Generated
exclusions must identify a `gen` or `generated` path and match tracked source;
they are not a general-purpose exception mechanism.

A repository may choose a lower target and record existing files between that
target and the applicable hard ceiling in a tracked TSV as
`path<TAB>line-count`. That allowance can only stay equal or decrease and never
overrides the 500/800 ceilings. Remove the entry once the file reaches its
target.

As a human-review convention, prefer action-named implementation files such as
`create.rs`, `evaluate.ts`, `sign.swift`, and `verify.kt`. This is intentionally
not enforced by the checker because whether a name expresses the repository's
domain operation requires architectural judgment.

For authored TypeScript, use `assertTypeScriptSourcePolicy`. It governs `.ts`,
`.tsx`, `.mts`, and `.cts`; requires explicit strict compiler settings in every
declared `tsconfig`; rejects `any`, `@ts-ignore`, ESLint disable directives,
wildcard imports or exports, production test bodies, non-null assertions,
`as any`/`as unknown`/`as never`, generic thrown errors, and substantive
`index.*` facades. `@ts-expect-error` is permitted only in separate test files
and must include a reason. A non-empty static-analysis configuration policy must
pin the repository's AST-aware lint rules. Verification commands must cover
`typecheck`, `lint`, and `test`.

For authored Swift, use `assertSwiftSourcePolicy`. It rejects force unwraps,
`try!`, `as!`, terminating shortcuts, embedded XCTest implementations, generic
error surfaces, untyped `throws`, SwiftLint disable directives, and concurrency
escape hatches. Facade files are explicit because Swift has no universal module
facade filename. Its configuration text policy must prove repository-specific
strict-concurrency and warnings-as-errors settings, while verification commands
must cover `format`, `lint`, `build`, and `test`.

For authored Kotlin, use `assertKotlinSourcePolicy`. It rejects `!!`, unsafe
casts, generic exceptions, terminating validation shortcuts, `lateinit`,
`@Suppress`, wildcard imports, and embedded test implementations. Facade files
are explicit. Its configuration text policy must prove settings such as
explicit API mode and warnings-as-errors, while verification commands must
cover `format`, `static-analysis`, `compile`, and `test`.

One verification command may satisfy multiple roles when a repository-native
command performs all of them. Generated source must be excluded explicitly;
authored examples remain production code. Semantic requirements that cannot be
proved safely from source text—boundary-schema validation, correct branded-type
selection, PII-safe error context, and effective secret zeroization—remain
repository-specific compiler/linter rules and tests invoked by those mandatory
verification commands.

Repository layout can be checked with `assertRepositoryShapePolicy`, either
directly or through the optional aggregate `repositoryShape` field. The policy
does not infer an archetype or require unused directories. See
[`docs/repository-shapes.md`](docs/repository-shapes.md) for every accepted
archetype, directory lane, invariant, crate role, and the architectural limits
of automated `proto-codec` validation.

SPDX exceptions should use typed entries such as
`{ path: "gen", reason: "generated" }`. Enable both
`requireExclusionsMatched` and `requireExclusionReasons` so deleted directories
cannot leave silent, stale policy exceptions behind.

The default SPDX policy expects ReallyMe's `MIT OR Apache-2.0` header. This
default does not choose or change a consumer repository's license. Repositories
belonging to another organization, or ReallyMe repositories using different
terms, must pass their own exact `copyright` and `license` values to
`assertSpdxHeaders` and maintain the corresponding license files. The vendored
`core.mjs` remains ReallyMe-authored, dual-licensed code: preserve its header
and third-party notice, and exclude that exact vendored path with reason
`"vendored"` instead of restamping it with the consumer's attribution.

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

Licensed under either the [MIT License](LICENSE-MIT) or the
[Apache License, Version 2.0](LICENSE-APACHE), at your option.

## Copyright and Trademarks

Copyright © 2026 by ReallyMe LLC.

ReallyMe® is a registered trademark of ReallyMe LLC.
