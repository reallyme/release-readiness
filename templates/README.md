# Local Release Checker Template

## Cargo dependency licenses

[`deny.toml`](deny.toml) contains the shared dependency license baseline for
Rust consumers of any archetype. Copy the `[licenses].allow` list into a new
Cargo Deny config, or use the licenses needed by the repository from that list
in its existing config. Keep any crate-specific exceptions scoped to the
reviewed dependency and version. The baseline applies to dependencies.
Repository licensing and authored SPDX headers follow the repository's own
license policy.

Run Cargo Deny against the locked release graph with the features and targets
the repository ships. For a workspace whose release checks cover all features:

```sh
cargo deny --locked --all-features check licenses
```

Carry applicable upstream notices into the distributed artifacts. Blue Oak
allows the license text or a link to it. Unicode v3 requires its copyright and
permission notice with copies or in associated documentation.
[Cargo Deny license configuration](https://embarkstudios.github.io/cargo-deny/checks/licenses/cfg.html) ·
[Blue Oak Model License](https://blueoakcouncil.org/license/1.0.0) ·
[Unicode License v3](https://www.unicode.org/license.txt)

## Rust protobuf checker

Use this template for a ReallyMe Rust repository that owns an executable
protobuf/ProtoJSON adapter lane.

Configure `rustRelease` using the [Rust toolchain and dependency review guide](../docs/rust-release.md).
The same policy applies to Rust repositories without protobuf or public crates.

Install the checker from the reviewed central revision:

```sh
cp ../release-readiness/templates/check_release_readiness.mjs scripts/check_release_readiness.mjs
```

Then replace every `REPLACE_*` marker. The checker fails closed while any
marker remains. Do not copy shared helper implementations into the local
script; add generally applicable policy to `core.mjs` and publish it through
the centrally versioned runner.

The template enables the following mandatory baseline through
`assertReallyMeRustProtoRepositoryPolicy`:

- the checker is Git-tracked and imports the immutable core supplied by the
  package runner at its exact semantic release version;
- GitHub Actions are pinned to immutable commits and Node jobs declare the
  Node 26 runtime explicitly;
- action-specific checks match the action repository and require a full commit
  SHA, so reviewed workflow updates do not require changing the checker;
- cargo-fuzz installs use the exact workflow `CARGO_FUZZ_VERSION`, are locked,
  and are present in both pull-request and scheduled fuzz lanes through named
  workflow steps;
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
- native Buffa generation uses guarded owners, redacts Debug, wipes sensitive
  messages, uses borrowed-only views, rejects unknown ProtoJSON keys, and
  discards binary unknown fields in sensitive messages;
- protobuf regeneration cannot modify files outside declared generated paths;
- protobuf CI pins Buf and the ReallyMe Buffa toolchain and invokes generated
  freshness exactly once.

### ReallyMe Buffa toolchain

The shared core validates exact `BUF_VERSION` and `BUFFA_VERSION` values in
the protobuf workflow's top-level `env`. Declare `reallyme-buffa` as the
protobuf crate's `buffa` runtime dependency and pin it to the same exact
registry version. For the 0.1.2 toolchain, use:

```toml
[dependencies]
buffa = { package = "reallyme-buffa", version = "=0.1.2", features = ["json", "zeroize"] }
```

The crate may inherit the same dependency through `[workspace.dependencies]`.
Use both exact installs in the workflow's `Install pinned Buffa generators`
step:

```sh
cargo install reallyme-protoc-gen-buffa --version "=$BUFFA_VERSION" --locked
cargo install reallyme-protoc-gen-buffa-packaging --version "=$BUFFA_VERSION" --locked
```

Use `local: protoc-gen-reallyme-buffa` and
`local: protoc-gen-reallyme-buffa-packaging` as direct executable entries in a
block-form `plugins` list. Set `views=true` and `json=true` on the message
generator. The Rust dependency must expose the `json` and `zeroize` features
directly or through the protobuf crate's feature declarations. Generated freshness
checks both executables' reported versions before running Buf. Update
`BUFFA_VERSION`, the Cargo requirement, the lockfile where used, and generated
output together. A consumer may also pin `bufVersion` or `buffaVersion` in its
policy.

For messages containing classified sensitive fields, enable `zeroize=true`
or a matching `zeroize_in` selector. Set `unknown_fields=false`, enable
`deny_unknown_json_fields=true` or `deny_unknown_json_fields_in`, and select
the messages with `borrowed_views_only_in`. Configure
`bytes_type_custom_in` and `string_type_custom_in` as needed, and register
each selected Rust owner using `json_policy_type`. Buffa makes the generated
Rust require the owner's zeroization traits and uses the owner's ProtoJSON
implementation. Test and audit the implementations in the consumer crate.
Use the native output in `hardeningPolicy.generatedRust` and include its
directory in the freshness check. Remove legacy Rust hardening settings and
the associated rewrite and idempotence commands from the checker and CI.

The Rust release policy rejects upstream Buffa package identities in workspace
dependencies and the locked graph. Keep the local `buffa` Cargo alias for
the ReallyMe runtime because generated Rust references `::buffa`.

Keep component-specific algorithm, vector, provider, package, and documentation
invariants below the marked boundary at the end of the local script. When a
local assertion is useful to more than one repository, promote it into the
central core or its declarative policy rather than duplicating it.

The template expects `bufbuild/buf-action` for the protobuf workflow. Change
`installBufAction` if the workflow uses another Buf action. The workflow must
still pin the action to a full commit SHA. Configure the consumer repository's
`.github/dependabot.yml` with the `github-actions` ecosystem if automated
update pull requests are wanted. Dependabot updates workflow references, not
SHA literals copied into checker source.

Enable `protobufRelease.protobufFirst` to validate the tracked architecture
references, owned schemas, and exact CI verification commands. Declare
`sdkConformance` when the repository ships SDKs. For repositories without SDKs
or with a different protobuf layout, see the standalone policy and the
[protobuf-first contract and CI examples](../docs/protobuf-first.md).

Prefer action-named implementation files such as `create.rs`, `evaluate.ts`,
`sign.swift`, and `verify.kt`. Treat this as a human-review convention rather
than an automated rule: choosing the correct domain action requires
architectural judgment.

Repository-shape validation is intentionally opt-in. Map the repository using
[`docs/repository-shapes.md`](../docs/repository-shapes.md), then uncomment and
complete `repositoryShape` in the checker. The policy enforces declared lanes,
crate roles, proto placement, sublanes, and typed exceptions; architectural
review still decides whether a `proto-codec` conversion boundary is justified.
Choose `application` for one independently released application,
`application-collection` for independently releasable applications that may
share explicitly owned domain, event, or protocol packages, and
`product-workspace` for cooperating applications whose compatibility and
lifecycle form one product release unit. A facade is optional in every case and
is declared with the `facade` crate role. These classifications are
language-neutral: applications and collection members may use Rust,
TypeScript, or both.

For a foundational library without a protobuf boundary, start with the
[`foundational-library` checker example](../docs/repository-shapes.md#foundational-library).
Its `contracts/README.md` records the consumer surface, compatibility promises,
and verification evidence.

If a repository chooses a target below an applicable hard ceiling, it may set
`baselinePath` to a tracked TSV for existing files between the two limits. Each
non-comment line must be `path<TAB>line-count`; the checked file may remain
equal or shrink, but it may not grow or exceed 500 production/example lines or
800 separate-test lines. Delete each entry as soon as its file reaches the
configured target. These ceilings cannot be raised by consumer configuration.
Every tracked source file must be governed by the corresponding language policy
or excluded through a matching `gen` or `generated` source prefix.
