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

- the checker and vendored core are Git-tracked and use the package's exact
  semantic release version;
- GitHub Actions are pinned to immutable commits and Node jobs use Node 24;
- cargo-fuzz installs are exact-version pinned, locked, and present in both
  pull-request and scheduled fuzz lanes through named workflow steps;
- Cargo workspace lints, publish include allowlists, and publishable path
  dependency versions are validated;
- production Rust and examples stay within the 500-line hard ceiling, separate
  test files stay within 800 lines, embedded test implementations are rejected,
  `lib.rs`/`mod.rs` remain declaration-and-re-export-only facades, obvious
  dynamic/string error surfaces and production panic shortcuts are rejected,
  stricter local targets may use a shrinking-only baseline, and wildcard
  imports or re-exports are rejected;
- optional authored TypeScript, Swift, and Kotlin policies apply the same
  production/test ceilings and require their language-native verification
  roles, while rejecting unsafe operations, embedded tests, suppressions, weak
  error boundaries, and substantive facades;
- tracked authored source and configuration files carry ReallyMe
  `MIT OR Apache-2.0` SPDX headers, while Markdown and plain-text documents stay
  header-free and every generated, vendored, or third-party exclusion is typed
  and still matches a tracked path;
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

Prefer action-named implementation files such as `create.rs`, `evaluate.ts`,
`sign.swift`, and `verify.kt`. Treat this as a human-review convention rather
than an automated rule: choosing the correct domain action requires
architectural judgment.

Repository-shape validation is intentionally opt-in. Map the repository using
[`docs/repository-shapes.md`](../docs/repository-shapes.md), then uncomment and
complete `repositoryShape` in the checker. The policy enforces declared lanes,
crate roles, proto placement, sublanes, and typed exceptions; architectural
review still decides whether a `proto-codec` conversion boundary is justified.

If a repository chooses a target below an applicable hard ceiling, it may set
`baselinePath` to a tracked TSV for existing files between the two limits. Each
non-comment line must be `path<TAB>line-count`; the checked file may remain
equal or shrink, but it may not grow or exceed 500 production/example lines or
800 separate-test lines. Delete each entry as soon as its file reaches the
configured target. These ceilings cannot be raised by consumer configuration.
Every tracked source file must be governed by the corresponding language policy
or excluded through a matching `gen` or `generated` source prefix.
