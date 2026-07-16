<!--
SPDX-FileCopyrightText: Copyright © 2026 ReallyMe LLC. All rights reserved

SPDX-License-Identifier: Apache-2.0
-->

# ReallyMe Release Readiness

Shared release-readiness guardrails for ReallyMe repositories.

This repository is the source of truth for the small auditable core used by
ReallyMe release scripts. It exists so sister repositories can enforce the same
release invariants without slowly drifting into repo-specific copies.

## What It Checks

The core is intentionally dependency-free and supports repository-specific
release scripts with helpers for:

- Git-tracked file enforcement for release-critical inputs.
- Exact text and negative text assertions for package, workflow, and policy files.
- Cargo lockfile package source/version checks.
- Cargo package file-list checks.
- GitHub Actions Node 24 policy checks for jobs using Node tooling.
- Full-commit SHA enforcement for every external GitHub Action or reusable
  workflow reference.
- Digest enforcement for explicitly enabled Docker actions and containment
  checks for local action or reusable-workflow references.
- GitHub Actions step checks that compare actual `run:` commands and `uses:` actions.
- Declarative text and workflow policies for migrating repeated local
  assertions without moving product semantics into the shared package.
- Cargo metadata policy checks for package versions, publishability,
  dependency sources, default features, and packaged file surfaces.
- Workspace-wide Cargo checks for inherited lints, publish include allowlists,
  and publishable path-dependency version alignment.
- Tracked-source SPDX header enforcement with configurable extensions and
  exclusions.
- Validated command matrices for repository-specific release suites.
- Protobuf generated-output freshness checks.
- Protobuf contract checks for sparse stable identifiers, valid field-number
  ranges, uniqueness, and reserved number/name non-reuse.
- A common executable protobuf adapter boundary requiring messages only, no
  service, one operation-request `oneof`, one status-plus-payload binary result
  envelope, and generated ProtoJSON as a request convenience.
- Generated protobuf hardening checks driven by each repo's hardening script.
- Generated protobuf redaction and zeroization policy checks through
`assertGeneratedProtoHardeningPolicy`.
- Additional generated-file policies for oneof, view-oneof, service, and other
  generator-specific security surfaces.
- A combined ReallyMe protobuf release lane through
  `assertReallyMeProtobufReleasePolicy`.
- A vendored-core policy through `assertReallyMeVendoredCorePolicy`, so
  consumers prove the release script and shared core are both Git-tracked and on
  the expected contract version.
- An aggregate Rust/protobuf repository baseline through
  `assertReallyMeRustProtoRepositoryPolicy`, so new consumers cannot partially
  apply the shared Cargo, workflow, SPDX, protobuf, ProtoJSON, hardening, and
  generated-freshness requirements.

## Golden Standard Sources

The shared core intentionally takes the strictest patterns from the first four
consumer repositories:

- `crypto`: Node workflow pinning, provider/release policy style, and broad
  generated proto JSON/redaction checks.
- `codec`: package-surface checks and redaction of encoded byte material.
- `jose`: Git-tracked input enforcement, lockfile source checks, and generated
  private-key/plaintext hardening.
- `cose`: generated snapshot freshness, stable protobuf identifier and adapter
  boundary checks, and strict generated Debug/zeroize policy.

The generated protobuf lane is security-sensitive. Consumers should use
`assertGeneratedArtifactsFresh` to snapshot generated output plus every tracked
or non-ignored file outside the declared generated directories, run `buf lint`,
`buf generate`, the repository hardening/redaction script, and `cargo fmt`, then
compare both surfaces. This catches stale generated code, unexpected
regenerator side effects, and hardening drift, including missing redaction,
missing zeroization hooks, or changed debug surfaces.

Snapshots retain SHA-256 fingerprints rather than complete file contents, so
the comparison remains exact without keeping the entire tracked worktree and
generated tree resident in memory.

For declared secret-bearing byte fields, `assertGeneratedProtoHardeningPolicy`
proves that generated JSON deserialization stages bytes in a
`Zeroizing<Vec<u8>>`, generated `clear`/`Drop` paths zeroize the final Buffa
field owner, unknown length-delimited protobuf data is recursively wiped,
strict ProtoJSON rejects unknown keys, and generated `Debug` output does not
print `self.<field>`. Buffa's generated public field type remains `Vec<u8>`;
the checker deliberately does not overclaim that changing the deserializer's
temporary owner changes generated message storage.

The shared adapter contract is deliberately narrower than an RPC schema. The
proto crate owns messages only and declares no service. A binary
`<Component>OperationRequest` or its generated ProtoJSON representation enters
the same dispatcher, and both paths return the same binary
`<Component>ProtoResultEnvelope`. Ergonomic native SDK APIs remain separate.

## Usage

For now, sister repositories vendor the core file byte-for-byte:

```sh
cp core.mjs ../crypto/scripts/release-readiness/core.mjs
cp core.mjs ../codec/scripts/release-readiness/core.mjs
cp core.mjs ../jose/scripts/release-readiness/core.mjs
cp core.mjs ../cose/scripts/release-readiness/core.mjs
```

Each consuming repository should assert the contract marker:

```js
assertContains(
  "scripts/release-readiness/core.mjs",
  "RELEASE_READINESS_CORE_CONTRACT_VERSION = 4",
);
```

For a new Rust/protobuf repository, start from
[`templates/check_release_readiness.mjs`](templates/check_release_readiness.mjs)
and follow [`templates/README.md`](templates/README.md). The template fails
closed until every `REPLACE_*` marker is resolved. It uses the aggregate
repository policy so the local checker stays focused on configuration and
component-specific invariants rather than copying shared enforcement logic.

When this repository becomes the canonical public source, consumers can either
continue vendoring a reviewed copy or pin a specific Git revision. Release
automation must not consume a floating branch.

## Protobuf Hardening Pattern

Consumer scripts should expose an explicit generated-freshness mode:

```js
const generatedFreshnessMode = process.argv.includes("--generated-freshness");

if (generatedFreshnessMode) {
  assertGeneratedArtifactsFresh({
    generatedPaths: ["crates/proto/example/src/generated"],
    commands: [
      ["buf", ["lint"]],
      ["buf", ["generate"]],
      ["node", ["scripts/harden-generated-example-proto.mjs"]],
      ["cargo", ["fmt", "--package", "reallyme-example-proto"]],
    ],
  });
}
```

The protobuf CI workflow should install the pinned protobuf toolchain and run:

```sh
node scripts/check_release_readiness.mjs --generated-freshness
```

This keeps lightweight release metadata checks fast while ensuring protobuf CI
performs the full regenerate, harden, format, and compare cycle.

Consumer scripts should also define the hardening policy explicitly:

```js
assertGeneratedProtoHardeningPolicy({
  hardeningScript: "scripts/harden-generated-example-proto.mjs",
  generatedRust: "crates/proto/example/src/generated/buffa/reallyme.example.v1.example.rs",
  generatedView:
    "crates/proto/example/src/generated/buffa/reallyme.example.v1.example.__view.rs",
  protoCargo: "crates/proto/example/Cargo.toml",
  workflow: ".github/workflows/protobuf-ci.yml",
  workflowStepName: "Harden generated protobuf artifacts",
  workflowStepRun: "node scripts/harden-generated-example-proto.mjs",
  requiredScriptNeedles: [
    "Zeroize::zeroize",
    "deserialize_zeroizing_bytes",
  ],
  secretByteFields: ["private_key"],
  requiredGeneratedNeedles: [
    '.field("private_key", &"<redacted>")',
    "::zeroize::Zeroize::zeroize(&mut self.private_key);",
  ],
  forbiddenGeneratedNeedles: [
    '.field("private_key", &self.private_key)',
  ],
});
```

For ReallyMe repositories, prefer the combined helper so the standard lane is
harder to partially apply:

```js
assertReallyMeProtobufReleasePolicy({
  generatedFreshnessMode,
  workflowMode: "delegated",
  installBufUses:
    "bufbuild/buf-setup-action@a47c93e0b1648d5651a065437926377d060baa99",
  hardeningPolicy: {
    hardeningScript: "scripts/harden-generated-example-proto.mjs",
    generatedRust:
      "crates/proto/example/src/generated/buffa/reallyme.example.v1.example.rs",
    generatedView:
      "crates/proto/example/src/generated/buffa/reallyme.example.v1.example.__view.rs",
    protoCargo: "crates/proto/example/Cargo.toml",
    requiredScriptNeedles: ["Zeroize::zeroize", "deserialize_zeroizing_bytes"],
    requiredCargoNeedles: ['"buffa/json"'],
    secretByteFields: ["private_key"],
    requiredGeneratedNeedles: [
      '.field("private_key", &"<redacted>")',
      "::zeroize::Zeroize::zeroize(&mut self.private_key);",
    ],
    forbiddenGeneratedNeedles: ['.field("private_key", &self.private_key)'],
    requiredViewNeedles: [
      'formatter.write_str("ExampleRequestView(<redacted>)")',
    ],
  },
  generatedFreshness: {
    generatedPaths: ["crates/proto/example/src/generated"],
    commands: [
      ["buf", ["lint"]],
      ["buf", ["generate"]],
      ["node", ["scripts/harden-generated-example-proto.mjs"]],
      ["cargo", ["fmt", "--package", "reallyme-example-proto"]],
    ],
  },
});
```

Protobuf identifiers are ReallyMe wire identifiers, not COSE, JOSE, JWA, or
other provider registry values. Use family-scoped enums where the schema
permits it, keep adjacent variants together in documented sparse bands, and
reserve every retired name and number. `assertProtoContract` deliberately does
not require sequential numbering; it rejects duplicate identifiers, invalid
field-number ranges, and reuse of reserved names or numbers. Repository-local
numeric contract tests and encoded goldens remain responsible for freezing the
chosen identifiers across releases.

Low-level executable adapters should also use the common typed boundary:

```js
assertReallyMeProtoBoundaryContract({
  protoPath: "crates/proto/example/proto/reallyme/example/v1/example.proto",
  operationRequest: "ExampleOperationRequest",
  resultEnvelope: "ExampleProtoResultEnvelope",
  resultStatus: "ExampleProtoResultStatus",
  protoReadme: "crates/proto/example/README.md",
  protoCargo: "crates/proto/example/Cargo.toml",
  wirePath: "src/wire.rs",
});
```

The operation request must carry a `oneof operation`; the result envelope must
carry its typed status at field 1 and `bytes payload` at field 2. The schema
must declare messages only and no protobuf service. The generated ProtoJSON
entrypoint is a request convenience and returns the same binary result envelope
as the binary protobuf entrypoint.

In delegated mode, the workflow installs the pinned toolchain and invokes only
the repository checker:

```yaml
- name: Check release readiness generated freshness
  run: node scripts/check_release_readiness.mjs --generated-freshness
```

The shared core rejects a second `buf lint` or `buf generate` workflow step in
that mode. This avoids running generation twice while keeping the exact command
sequence visible in the repository policy object.

## Organization-Wide Policies

Every consumer should enable full-SHA action pinning in addition to Node
version enforcement:

```js
assertWorkflowActionsPinned();
assertNodeWorkflowJobsPinNode({ nodeVersion: "24" });
```

Local assertions can be migrated incrementally into a declarative text policy:

```js
assertTextPolicy({
  files: [
    {
      path: "Cargo.toml",
      required: ["overflow-checks = true"],
      forbidden: ["[patch.crates-io]"],
    },
  ],
});
```

Cargo package and dependency invariants belong in the shared metadata policy,
while algorithm- or protocol-specific meaning remains local:

```js
assertCargoMetadataPolicy({
  packages: [
    {
      name: "reallyme-example",
      version: "1.2.3",
      publish: "public",
      packageFiles: ["Cargo.toml", "README.md", "LICENSE", "NOTICE", "src/lib.rs"],
      dependencies: [
        {
          name: "reallyme-crypto",
          requirement: "^0.2.1",
          source: "registry",
          defaultFeatures: false,
        },
      ],
    },
  ],
});
```

The core rejects absolute paths, repository-relative paths that escape
lexically or through symlink traversal, tracked release inputs that are
symlinks, untracked generated artifacts, missing tracked generated artifacts,
malformed command policies, floating GitHub Action references, floating Docker
action tags, and folded workflow `run: >` scalars used by exact-step checks.
Generated paths may not name the repository root or overlap one another, and
regeneration may not modify tracked or non-ignored files outside those paths.
