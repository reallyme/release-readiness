<div align="center">

# ReallyMe Release Readiness

**Shared release-readiness guardrails for ReallyMe repositories**

[![Release Readiness](https://github.com/reallyme/release-readiness/actions/workflows/checks.yml/badge.svg)](https://github.com/reallyme/release-readiness/actions/workflows/checks.yml)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](LICENSE-MIT)

</div>

This package contains a dependency-free Node.js core used by ReallyMe release
scripts. Consumer repositories keep only their repository-specific checker and
execute the immutable core supplied by a pinned package runner. This prevents
policy fixes from remaining trapped in stale local copies.

## What It Checks

- Git-tracked release inputs and repository-contained paths.
- GitHub Actions pinned to full commit SHAs, with Node jobs using explicit
  numeric versions of at least 26. This repository uses Node 26, and the
  package runtime requires Node 26 or newer.
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
  intent and operational control. Application and application-collection
  profiles distinguish an independently released application from a repository
  containing several independently bounded applications, including collections
  with explicitly owned shared domain, event, or protocol packages.
  Product-workspace profiles cover several cooperating applications that
  jointly implement one product and share a release lifecycle. Facades are
  optional crate roles rather than separate repository archetypes. Taxonomy,
  conformance-suite, and documentation-site profiles separate canonical data,
  executable verification, evidence, and rendered documentation.
- SPDX headers for tracked source files, with typed generated/vendored/
  third-party exclusions that can be required to match current tracked files.
- Protobuf schema contracts, generated output freshness, and adapter boundary
  checks.
- Opt-in protobuf-first verification for any repository archetype, including
  shared conformance fixtures and native CI checks for repositories with SDKs.
- Granular provider contracts with exact descriptor/request/result/error/response
  surfaces, unique operation parity, correlation, typed outcomes,
  service-separation, codec, runtime, and adapter checks.
- Explicit retired-path enforcement so deprecated examples, trackers, and
  compatibility surfaces cannot remain present or tracked unnoticed.
- Generated protobuf hardening checks for native Buffa guarded owners,
  redacted Debug, zeroization, strict ProtoJSON, borrowed-only views, and explicit
  sensitivity classification for every `bytes` and `string` schema field.
- Command matrices for repository-specific release suites.

The package and Git release share one semantic version. Consumer checkers load
the core supplied by the pinned runner rather than carrying a local copy. The
current marker is:

```js
assertContains(
  "core.mjs",
  'RELEASE_READINESS_VERSION = "0.8.0"',
);
```

Numeric core-contract identifiers are no longer supported. Consumer policy,
the package version, and release tag must use the same semantic release
version.

## Usage

Run this repository's checks with:

```sh
npm run check
```

The GitHub Actions workflow runs the same command on Node 26.

## Keeping Pins Current

This repository has no npm runtime dependencies. Its own workflow has two
immutable action references (`actions/checkout` and `actions/setup-node`).
The release checker verifies each named action's repository and its full
commit SHA; a reviewed update to that SHA only changes the workflow. A
repository may configure the `github-actions` Dependabot ecosystem to propose
those workflow updates.

Other exact requirements are intentional toolchain and release contracts:

| Requirement | Declaration | Update path |
| --- | --- | --- |
| Buf CLI | Exact workflow `BUF_VERSION` | Update the workflow value; a consumer may separately opt into an exact policy override |
| ReallyMe Buffa runtime and generators | Exact workflow `BUFFA_VERSION` and matching Cargo requirement for `reallyme-buffa` | Update the workflow, Cargo requirement, lockfile where used, and generated output together |
| cargo-fuzz template | Exact workflow `CARGO_FUZZ_VERSION` | Update the workflow value; both install lanes use that variable |
| Node runtime | 26 in this repository and template; consumer minimum and package engine `>=26` | Review a runtime-major migration in this repository's workflow, checker, template, and package engine |
| Release-readiness package | 0.8.0 | Publish a new package revision and update consumer pins |

Dependabot does not update version literals embedded in checker source. The
shared core validates Buf, the ReallyMe Buffa toolchain, and template cargo-fuzz
against the workflow environment without repeating those versions in the checker.
Keep action SHAs in workflow files and match action repositories in checker
policy with `assertWorkflowUsesStepPinnedTo` or `installBufAction`.
Declarative `usesSteps` policies can use `{ name, action: "owner/repository" }`
for the same rule; use `{ name, uses: "owner/repository@sha" }` only when a
specific reviewed revision is itself the contract.

Consumer repositories keep only their repository-specific checker. It loads
the immutable core path supplied by the runner:

```js
const coreUrl = process.env.RELEASE_READINESS_CORE_URL;
const { createReleaseReadinessContext } = await import(coreUrl);
```

Remote CI must pin this repository by a reviewed full commit SHA. Never use a
mutable branch or tag in a credential-bearing workflow. Two invocation modes
are supported.

An explicit checkout keeps the reviewed package visible in the job workspace:

```yaml
- name: Checkout release-readiness runner
  uses: actions/checkout@FULL_ACTION_COMMIT_SHA
  with:
    repository: reallyme/release-readiness
    ref: FULL_RELEASE_READINESS_COMMIT_SHA
    path: .release-readiness
    persist-credentials: false

- name: Run release-readiness gates
  run: node .release-readiness/scripts/run-consumer-check.mjs
```

Alternatively, npm can execute the package directly from the same reviewed
commit:

```sh
npm exec --yes --package=github:reallyme/release-readiness#FULL_COMMIT_SHA -- \
  reallyme-release-readiness
```

Both modes execute the same package runner. Arguments after
`reallyme-release-readiness` in npm mode are passed to the consumer's
`scripts/check_release_readiness.mjs`. The runner supplies its own immutable
core through `RELEASE_READINESS_CORE_URL`; the consumer does not vendor or
modify it. The runner also detects tracked Rust, TypeScript, Swift, and Kotlin
source and requires the consumer checker to invoke the corresponding shared
source policy. A repository cannot bypass the source rules by omitting a policy
call.

For a repository with a tracked root `Cargo.toml`, the runner also requires
the [Rust release policy](docs/rust-release.md). It pins development and release
to Rust 1.100.0 and checks that CI tests each publishable crate at its declared
MSRV and audits the locked dependency graph. Use Rust 1.96 as the recommended
MSRV for new public crates.

For a new Rust/protobuf repository, start from
[`templates/check_release_readiness.mjs`](templates/check_release_readiness.mjs)
and the companion [`templates/README.md`](templates/README.md). The template
fails closed until every `REPLACE_*` marker has been replaced.
For a Rust library without a protobuf boundary, use the
[`foundational-library` example](docs/repository-shapes.md#foundational-library).

The protobuf release policy defaults to the explicit-checkout invocation at
`.release-readiness/scripts/run-consumer-check.mjs`. Consumers using the npm
invocation must configure `generatedFreshnessStepRun` with their complete,
commit-pinned npm command. The policy references the consumer checker path for
workflow-change coverage; it never expects a vendored core in new consumers.
An unfiltered `push`, `pull_request`, or `pull_request_target` trigger covers
every repository path. When a change trigger uses `paths`, its flat sequence
must include the exact checker path and must not contain negated patterns.
`paths-ignore` cannot prove coverage because its full glob semantics belong to
GitHub, so configure an explicit `paths` entry for this policy instead.

Use the public [archetype matrix](docs/archetype-matrix.md) to select a
repository responsibility, then apply the exact lane and ownership rules in
[the repository-shape contract](docs/repository-shapes.md).

Generated protobuf freshness checks run `buf lint`, `buf generate`, and
formatting, then compare the outputs and every tracked or non-ignored file
outside the declared generated directories. The ReallyMe Buffa generator
applies Rust hardening during generation.

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

An audited `@unchecked Sendable` or `@preconcurrency import NetworkExtension`
bridge may be declared with its exact tracked file path, SHA-256 digest,
accepted token, and review reason. Every changed byte requires a new digest.
Bundled third-party Swift source may be declared only under a `Vendor/`
directory with a tracked notice and the SHA-256 digest of the sorted
`snapshotDirectory` entries serialized as JSON. The runner checks the entire
directory, including non-Swift files, before excluding it from authored-source
rules. Neither declaration disables checks for other authored Swift files.

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

The default SPDX policy expects ReallyMe's `MIT OR Apache-2.0` header on
governed source and configuration files. Markdown and plain-text files are not
header-governed by default. This policy does not choose or change a consumer
repository's license. Repositories belonging to another organization, or
ReallyMe repositories using different terms, must pass their own exact
`copyright` and `license` values to `assertSpdxHeaders` and maintain the
corresponding license files. Legacy consumers pinned to an earlier vendored-core
release must preserve that core's original header and third-party notice while
they migrate; new consumers must use the centrally versioned runner.

The shared [Cargo dependency license baseline](templates/deny.toml) is available
to Rust repositories of any archetype. See the [Cargo Deny setup](templates/README.md#cargo-dependency-licenses)
for applying the baseline to a repository's locked release graph.

## Protobuf Notes

Use [`assertProtobufFirstPolicy`](docs/protobuf-first.md) to declare a
protobuf-first boundary, its tracked contract and CI verification, and any
SDK conformance lanes. The guide covers shared operation errors, SDK-specific
provider failures, and generated types and codecs at the wire boundary.

Protobuf identifiers are ReallyMe wire identifiers, not provider registry
values. `assertProtoContract` requires neither sparse nor sequential numbering;
it rejects invalid field-number ranges, duplicate identifiers, and reuse of
reserved names or numbers.

Every protobuf `bytes` and `string` field must appear exactly once in
`scalarFieldClassifications`. Mark it `sensitivity: "sensitive"` or
`sensitivity: "public"` explicitly and include its schema kind and owning
message. The checker rejects unclassified schema additions, duplicate entries,
kind mismatches, and stale classifications. Sensitive entries additionally
require Buffa's custom guarded field types with ProtoJSON policies, message
zeroization and Debug redaction, borrowed-only views, strict JSON decoding,
and disabled binary unknown-field storage. Nested messages, groups, extensions,
and maps with string or bytes slots require an extended classifier.

When upgrading a protobuf consumer from `0.7.0`, move Rust hardening settings
into `buf.gen.yaml`, remove the generated Rust rewrite and idempotence commands,
and regenerate with matching ReallyMe runtime and plugin versions. Update the
consumer pin and [checker template](templates/README.md#reallyme-buffa-toolchain)
together. Rust consumers also need the [Rust release policy](docs/rust-release.md).

The executable adapter boundary is intentionally narrow: the proto crate owns
messages only, exposes no protobuf service, accepts binary protobuf and
generated ProtoJSON requests, and returns the same binary status/payload result
envelope from both paths.

## License

Licensed under either the [MIT License](LICENSE-MIT) or the
[Apache License, Version 2.0](LICENSE-APACHE), at your option.

Third-party components retain their own licenses and notices.

## Copyright And Trademarks

Copyright © 2026 by ReallyMe Technologies Limited.

ReallyMe<sup>®</sup> is a registered trademark of ReallyMe Technologies Limited.
