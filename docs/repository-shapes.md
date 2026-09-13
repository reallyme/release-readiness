<!--
SPDX-FileCopyrightText: Copyright © 2026 ReallyMe LLC. All rights reserved

SPDX-License-Identifier: MIT OR Apache-2.0
-->

# Repository Shape Contracts

Repository-shape validation is opt-in. A repository enables it by calling
`assertRepositoryShapePolicy` directly or by adding `repositoryShape` to the
aggregate Rust/protobuf policy. Repositories that have not declared a shape are
not classified or changed automatically.

The objective is a consistent directory grammar, not an identical tree. A
repository declares only the lanes it actually owns. The checker rejects
undeclared or misplaced tracked content; it never requires empty placeholder
directories.

## Directory Vocabulary

| Lane | Meaning |
| --- | --- |
| `crates/` | Rust domain implementation and explicitly declared support crates |
| `bindings/` | ABI and platform adapters only |
| `gen/` | Generated platform-language sources |
| `packages/` | Distributable developer packages |
| `contracts/` | Public behavior, compatibility, and support commitments |
| `conformance/` | Cross-component and cross-language verification |
| `vectors/` | Stable reusable interoperability vectors |
| `fuzz/` | Fuzz targets, dictionaries, and corpora |
| `examples/` | Maintained consumer examples |
| `docs/` | Concepts, guides, security material, and reference documentation |
| `scripts/` | Build, generation, conformance, and release-readiness automation |
| `.github/` | CI and release policy |

Hosted services may additionally use `services/`, `deploy/`, `migrations/`,
`operations/`, `config/`, and `docker/`. Conformance suites may use `upstream/`,
`plans/`, `adapters/`, `results/`, and `evidence/`. Tooling repositories may use
`templates/`, `test/`, and `fixtures/`.

## Approved Archetypes

The following lists are exact. A lane absent from an archetype's permitted list
does not pass unless it is declared as a typed exception.

### `foundational-library`

- Required: `crates`, `docs`, `scripts`, `.github`.
- Permitted: `crates`, `bindings`, `gen`, `packages`, `contracts`,
  `conformance`, `vectors`, `fuzz`, `examples`, `docs`, `scripts`, `.github`,
  `.cargo`.

### `protocol-engine`

- Required: `crates`, `contracts`, `docs`, `scripts`, `.github`.
- Permitted: `crates`, `bindings`, `gen`, `packages`, `contracts`,
  `conformance`, `vectors`, `fuzz`, `examples`, `docs`, `scripts`, `.github`,
  `.cargo`.

### `developer-platform`

- Required: `bindings`, `gen`, `packages`, `examples`, `contracts`,
  `conformance`, `docs`, `scripts`, `.github`.
- Permitted: `crates`, `bindings`, `gen`, `packages`, `contracts`,
  `conformance`, `vectors`, `fuzz`, `examples`, `docs`, `scripts`, `.github`,
  `.cargo`, `.changeset`, `gradle`.

### `hosted-service`

- Required: `services`, `deploy`, `operations`, `docs`, `scripts`, `.github`.
- Permitted: `crates`, `contracts`, `conformance`, `vectors`, `fuzz`,
  `examples`, `docs`, `scripts`, `.github`, `.cargo`, `services`, `deploy`,
  `migrations`, `operations`, `config`, `docker`.

### `conformance-suite`

- Required: `upstream`, `plans`, `adapters`, `conformance`, `docs`, `scripts`,
  `.github`.
- Permitted: `contracts`, `conformance`, `vectors`, `examples`, `docs`,
  `scripts`, `.github`, `upstream`, `plans`, `adapters`, `results`, `evidence`.

### `tooling`

- Required: `docs`, `scripts`, `.github`.
- Permitted: `contracts`, `conformance`, `vectors`, `examples`, `docs`,
  `scripts`, `.github`, `templates`, `test`, `fixtures`.

Every archetype-required lane must appear in `requiredLanes`. Every other
tracked root directory must be listed in `optionalLanes` or as a typed
exception. An optional lane may be absent; a required lane and every configured
sublane must contain tracked files.

## Enforced Invariants

The checker enforces the following structural rules:

- Root `src/`, `proto/`, `protos/`, `tests/`, and `generated/` lanes are
  forbidden. The singular root `test/` lane is reserved for the `tooling`
  archetype; implementation repositories keep tests with their owning package
  or crate and use `conformance/` for cross-component verification.
- Every observed root lane is declared and permitted by its archetype.
- Exceptional root lanes have a supported reason and match tracked content.
- Reusable vectors do not live under `conformance/vectors/`.
- Repositories with `crates/` have a virtual root Cargo workspace rather than a
  root package.
- Every Cargo package beneath `crates/` is declared with an architectural role.
- At most one `proto` crate and one `proto-codec` crate are declared.
- The canonical proto crate is `crates/proto`.
- The conversion crate, when present, is `crates/proto-codec` and requires the
  canonical proto crate.
- Every tracked `.proto` schema lives beneath `crates/proto`.
- Nested Cargo packages beneath `crates/proto` are forbidden.
- `bindings/`, `gen/`, and `packages/` declare every tracked immediate sublane.
- Consumer repositories retain the local checker and vendored shared core under
  `scripts/`. Only the `tooling` archetype may set `requireReleaseReadiness` to
  `false`, allowing this package to validate its source core rather than vendor
  a copy of itself.
- Additional repository-specific retired paths may be declared in
  `forbiddenPaths`.

## Proto and Proto-Codec Meaning

Directory validation cannot decide whether a conversion boundary is
architecturally justified. It can prove only that a declared boundary is placed
and connected consistently.

`crates/proto` owns canonical schemas and generated wire DTOs. It must not
contain domain behavior or a family of nested domain-specific proto packages.

`crates/proto-codec` is justified only when the repository owns substantial,
hand-authored validation and conversion between untrusted wire DTOs and strongly
typed domain values. It is not a second protobuf implementation. A repository
that merely consumes `reallyme-codec`, or directly uses already validated DTOs,
must not add `proto-codec` for visual symmetry.

That decision remains an architecture-review responsibility. Once the decision
is declared, dependency-boundary and source policies should verify that
business logic does not leak into the proto crate and untrusted wire values do
not bypass the conversion boundary.

## Protocol-Engine Example

```js
context.assertRepositoryShapePolicy({
  archetype: "protocol-engine",
  requiredLanes: ["crates", "contracts", "docs", "scripts", ".github"],
  optionalLanes: ["conformance", "vectors", "fuzz", "examples"],
  exceptions: [],
  crates: [
    { path: "crates/openid4vci", role: "domain" },
    { path: "crates/proto", role: "proto" },
    { path: "crates/proto-codec", role: "proto-codec" },
  ],
  subLanes: {},
  forbiddenPaths: [],
  requireReleaseReadiness: true,
});
```

Remove the `proto-codec` declaration and directory when that authored conversion
boundary does not exist. Add `bindings`, `gen`, or `packages` only when the
repository owns those artifacts, and declare their immediate sublanes:

```js
subLanes: {
  bindings: ["ffi", "jni", "wasm"],
  gen: ["swift", "kotlin", "java", "typescript"],
  packages: ["swift", "kotlin", "kotlin-android", "ts"],
}
```

## Typed Exceptions

An organization-specific or tool-owned root can be admitted explicitly:

```js
exceptions: [
  { path: ".devcontainer", reason: "build-tool" },
  { path: "vendor", reason: "vendored" },
]
```

Supported reasons are `build-tool`, `deployment`, `generated`,
`organization-specific`, `third-party`, and `vendored`. Exceptions cannot be
used for a lane already permitted by the archetype, and stale exceptions fail
when they no longer match tracked content.
