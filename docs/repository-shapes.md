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
| `apps/` | Independently bounded applications within a collection or platform workspace |
| `taxonomy/` | Canonical authored vocabulary, semantics, operations, profiles, and ownership |
| `schema/` or `schemas/` | Machine-readable validation contracts for authored data or conformance artifacts |
| `views/` | Generated, consumer-specific projections of canonical authored data |
| `consumers/` | Repository and version compatibility declarations for downstream consumers |
| `content/` | Authored documentation grouped into explicitly declared navigation sections |
| `components/` | Reusable documentation-site presentation components |
| `snippets/` | Reusable or generated documentation code excerpts |
| `assets/` | Static documentation-site media and downloadable resources |
| `contracts/` | Public behavior, compatibility, and support commitments |
| `conformance/` | Cross-component and cross-language verification |
| `vectors/` | Stable reusable interoperability vectors |
| `fuzz/` | Fuzz targets, dictionaries, and corpora |
| `examples/` | Maintained consumer examples |
| `docs/` | Concepts, guides, security material, and reference documentation |
| `scripts/` | Build, generation, conformance, and release-readiness automation |
| `tests/` | Root-level validation for non-implementation artifacts in approved data, conformance, and documentation profiles |
| `.github/` | CI and release policy |

Applications may additionally use `config/`, `migrations/`, and `resources/`.
Hosted services may additionally use `services/`, `deploy/`, `migrations/`,
`operations/`, `config/`, and `docker/`. Runtime-composition repositories use
`configs/` and `deploy/`. Infrastructure repositories use capability-named
`topology/`, `provisioning/`, `configuration/`, `deployments/`, `networking/`,
`observability/`, and `operations/` lanes. Conformance suites may use
`upstream/`, `plans/`, `adapters/`, `schemas/`, `tests/`, `results/`, and
`evidence/`. Taxonomy repositories use `taxonomy/`, `schema/`, `views/`, and
`consumers/`. Documentation sites use `content/`, `components/`, `snippets/`,
and `assets/`. Tooling repositories may use `templates/`, `test/`, and
`fixtures/`.

These contracts are organization-neutral. Repository ownership affects the
configured copyright and license policy, not the meaning of a directory lane.

## Approved Archetypes

The following lists are exact. A lane absent from an archetype's permitted list
does not pass unless it is declared as a typed exception.

| Archetype | Intended repository responsibility |
| --- | --- |
| `foundational-library` | Reusable domain or technical foundations without ownership of an end-to-end protocol |
| `protocol-engine` | A protocol contract, its domain behavior, adapters, and conformance evidence |
| `developer-platform` | Multi-language bindings, generated sources, packages, and developer-facing examples |
| `application` | One independently released, host-neutral application |
| `application-collection` | Several explicitly named, independently bounded applications released from one repository |
| `hosted-service` | A deployed service together with its deployment and operational ownership |
| `platform-workspace` | Shared platform kits, applications, servers, workers, and cross-host conformance |
| `runtime-composition` | Executable host composition without application or protocol business ownership |
| `infrastructure` | Provisioning, configuration, networking, deployment, and operational control planes |
| `conformance-suite` | Pinned upstream suites, owned plans and adapters, results, and certification evidence |
| `taxonomy` | Canonical vocabulary and schemas with generated consumer views and compatibility declarations |
| `documentation-site` | Versioned public or internal documentation whose navigation, contracts, examples, and checks ship together |
| `tooling` | Repository-independent development, policy, generation, or release tooling |

### `foundational-library`

- Required: `crates`, `docs`, `scripts`, `.github`.
- Permitted: `crates`, `bindings`, `gen`, `packages`, `contracts`,
  `conformance`, `vectors`, `fuzz`, `examples`, `docs`, `scripts`, `.github`,
  `.cargo`.

### `protocol-engine`

- Required: `crates`, `contracts`, `conformance`, `docs`, `scripts`, `.github`.
- Permitted: `crates`, `bindings`, `gen`, `packages`, `contracts`,
  `conformance`, `vectors`, `fuzz`, `examples`, `docs`, `scripts`, `.github`,
  `.cargo`.

### `developer-platform`

- Required: `bindings`, `gen`, `packages`, `examples`, `contracts`,
  `conformance`, `docs`, `scripts`, `.github`.
- Permitted: `crates`, `bindings`, `gen`, `packages`, `contracts`,
  `conformance`, `vectors`, `fuzz`, `examples`, `docs`, `scripts`, `.github`,
  `.cargo`, `.changeset`, `gradle`.

### `application`

- Required: `crates`, `contracts`, `conformance`, `docs`, `scripts`, `.github`.
- Permitted: `crates`, `contracts`, `conformance`, `vectors`, `fuzz`,
  `examples`, `docs`, `scripts`, `.github`, `.cargo`, `config`, `migrations`,
  `resources`.

This profile owns one independently released, host-neutral application. Its
domain behavior, ports, configuration schema, and public contracts remain here;
listener lifecycle, executable composition, deployment, and infrastructure do
not. Rust implementation belongs beneath `crates/<application>`. A protobuf
boundary uses the canonical `crates/proto` and, only when justified,
`crates/proto-codec` structure.

### `application-collection`

- Required: `apps`, `conformance`, `docs`, `scripts`, `.github`.
- Permitted: `apps`, `crates`, `contracts`, `conformance`, `vectors`, `fuzz`,
  `examples`, `docs`, `scripts`, `.github`, `.cargo`.

This profile owns several applications whose shared release cadence and
dependency graph justify one repository. Every immediate `apps/<app>` lane is
declared explicitly. Application-specific implementation, configuration,
resources, migrations, and contracts stay beneath that application. Protobuf
schemas live beneath `apps/<app>/contracts/proto`; a collection does not create
a workspace-wide canonical proto crate. Root `crates/`, when present, contains
only genuinely shared implementation and every package remains role-declared.

### `hosted-service`

- Required: `services`, `deploy`, `operations`, `conformance`, `docs`,
  `scripts`, `.github`.
- Permitted: `crates`, `contracts`, `conformance`, `vectors`, `fuzz`,
  `examples`, `docs`, `scripts`, `.github`, `.cargo`, `services`, `deploy`,
  `migrations`, `operations`, `config`, `docker`.

Every immediate `services/<service>` lane is declared explicitly. This keeps a
multi-service deployment from accumulating unnamed executable or business
boundaries.

### `platform-workspace`

- Required: `crates`, `kits`, `apps`, `servers`, `workers`, `conformance`,
  `docs`, `scripts`, `.github`.
- Permitted: `crates`, `kits`, `apps`, `servers`, `workers`, `conformance`,
  `docs`, `scripts`, `.github`.

This profile owns the shared Platform facade, reusable host-neutral kits,
reference applications, native server composition, Worker composition, and
cross-host conformance. Each application owns its protobuf schema beneath
`apps/<app>/contract/proto`; Platform does not centralize app contracts in a
workspace-wide `crates/proto` package.

### `runtime-composition`

- Required: `crates`, `configs`, `deploy`, `contracts`, `conformance`, `docs`,
  `scripts`, `.github`.
- Permitted: `crates`, `configs`, `deploy`, `contracts`, `conformance`,
  `vectors`, `fuzz`, `examples`, `docs`, `scripts`, `.github`, `.cargo`,
  `docker`.

This profile owns executable composition: native process entrypoints, edge or
Worker hosts, non-secret runtime configuration, container construction, and
artifact-level conformance. Rust hosts remain declared packages beneath
`crates/`; application or protocol business logic remains in its owning
repository.

### `infrastructure`

- Required: `deployments`, `operations`, `docs`, `scripts`, `.github`.
- Permitted: `topology`, `provisioning`, `configuration`, `deployments`,
  `networking`, `observability`, `operations`, `crates`, `tools`, `contracts`,
  `conformance`, `vectors`, `examples`, `docs`, `scripts`, `.github`, `.cargo`.

This profile names capabilities rather than products. For example, OpenTofu or
Terraform belongs beneath `provisioning/`, Ansible beneath `configuration/`,
container deployment definitions beneath `deployments/`, provider ingress and
load-balancer definitions beneath `networking/`, and reviewed control-plane
catalogs beneath `operations/`. Provider and product names must not become
profile requirements.

### `conformance-suite`

- Required: `upstream`, `plans`, `adapters`, `schemas`, `tests`, `results`,
  `evidence`, `docs`, `scripts`, `.github`.
- Permitted: `contracts`, `vectors`, `examples`, `docs`, `scripts`, `.github`,
  `upstream`, `plans`, `adapters`, `schemas`, `tests`, `results`, `evidence`.

`upstream/` contains pinned third-party suites or immutable source snapshots.
Owned test selection belongs in `plans/`; integration code belongs in
`adapters/`; artifact validation belongs in `schemas/` and `tests/`; execution
output belongs in `results/`; and reviewed certification material belongs in
`evidence/`. A repository that is itself a conformance suite does not add a
second, ambiguous `conformance/` wrapper.

### `taxonomy`

- Required: `taxonomy`, `schema`, `views`, `consumers`, `conformance`, `tests`,
  `docs`, `scripts`, `.github`.
- Permitted: `taxonomy`, `schema`, `views`, `consumers`, `conformance`, `tests`,
  `docs`, `scripts`, `.github`.

`taxonomy/` is the only authored semantic source. `schema/` validates it;
`views/` contains generated projections for explicitly declared consumers;
`consumers/` pins compatibility expectations; and `conformance/` maps external
requirements back to canonical concepts. Every immediate `views/<consumer>`
lane is declared so a new projection cannot appear without an architecture
decision.

### `documentation-site`

- Required: `content`, `contracts`, `tests`, `scripts`, `.github`.
- Permitted: `content`, `components`, `snippets`, `contracts`, `conformance`,
  `examples`, `localization`, `assets`, `docs`, `tests`, `scripts`, `.github`.

`content/` owns the rendered documentation and declares every immediate
navigation section. `contracts/` pins the APIs, specifications, or source
revisions documented by the site. `tests/` verifies links, navigation, examples,
and generated references. Site implementation details stay in `components/`,
reusable excerpts in `snippets/`, and static media in `assets/`. Root topic
directories are intentionally disallowed because they make navigation growth
indistinguishable from architectural drift.

### `tooling`

- Required: `test`, `docs`, `scripts`, `.github`.
- Permitted: `contracts`, `conformance`, `vectors`, `examples`, `docs`,
  `scripts`, `.github`, `templates`, `test`, `fixtures`.

Every archetype-required lane must appear in `requiredLanes`. Every other
tracked root directory must be listed in `optionalLanes` or as a typed
exception. An optional lane may be absent; a required lane and every configured
sublane must contain tracked files.

## Enforced Invariants

The checker enforces the following structural rules:

- Root `src/`, `proto/`, `protos/`, and `generated/` lanes are forbidden. Root
  `tests/` is permitted only for the `taxonomy`, `conformance-suite`, and
  `documentation-site` archetypes, where it validates non-implementation
  artifacts. The singular root `test/` lane is reserved for `tooling`.
  Implementation repositories keep tests with their owning package or crate
  and use `conformance/` for cross-component verification.
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
- Compatibility packages named `crates/proto-*` are forbidden; the only
  permitted package with that prefix is exactly `crates/proto-codec`.
- Every tracked `.proto` schema lives beneath `crates/proto`.
- In a `platform-workspace`, every tracked `.proto` schema instead lives beneath
  its owning `apps/<app>/contract/proto` directory.
- In an `application-collection`, every tracked `.proto` schema instead lives
  beneath its owning `apps/<app>/contracts/proto` directory.
- Nested Cargo packages beneath `crates/proto` are forbidden.
- `bindings/`, `gen/`, and `packages/` declare every tracked immediate sublane.
  A `hosted-service` declares every immediate `services/` sublane; a `taxonomy`
  declares every immediate `views/` sublane; and a `documentation-site`
  declares every immediate `content/` sublane. An `application-collection`
  declares every immediate `apps/` sublane. A `platform-workspace` additionally
  declares every immediate `apps/`, `kits/`, `servers/`, and `workers/` sublane.
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

## Taxonomy, Conformance, and Documentation Layouts

A taxonomy separates canonical authored semantics from validation, generated
projections, and consumer compatibility:

```text
taxonomy-repository/
  taxonomy/
  schema/
  views/
    first-consumer/
    second-consumer/
  consumers/
  conformance/
  tests/
  docs/
  scripts/
    release-readiness/
  .github/
```

```js
context.assertRepositoryShapePolicy({
  archetype: "taxonomy",
  requiredLanes: [
    "taxonomy",
    "schema",
    "views",
    "consumers",
    "conformance",
    "tests",
    "docs",
    "scripts",
    ".github",
  ],
  optionalLanes: [],
  exceptions: [],
  crates: [],
  subLanes: { views: ["first-consumer", "second-consumer"] },
  forbiddenPaths: [],
  requireReleaseReadiness: true,
});
```

A conformance suite keeps third-party inputs, owned execution behavior, raw
results, and reviewed evidence distinguishable:

```text
conformance-suite/
  upstream/
  plans/
  adapters/
  schemas/
  tests/
  results/
  evidence/
  docs/
  scripts/
    release-readiness/
  .github/
```

```js
context.assertRepositoryShapePolicy({
  archetype: "conformance-suite",
  requiredLanes: [
    "upstream",
    "plans",
    "adapters",
    "schemas",
    "tests",
    "results",
    "evidence",
    "docs",
    "scripts",
    ".github",
  ],
  optionalLanes: ["contracts", "vectors", "examples"],
  exceptions: [],
  crates: [],
  subLanes: {},
  forbiddenPaths: [],
  requireReleaseReadiness: true,
});
```

A documentation site consolidates navigation sections beneath `content/` while
keeping source contracts and executable validation separate:

```text
documentation-site/
  content/
    get-started/
    guides/
    reference/
  components/             # optional
  snippets/               # optional
  contracts/
  conformance/            # optional
  examples/               # optional
  localization/           # optional
  assets/                 # optional
  tests/
  scripts/
    release-readiness/
  .github/
```

```js
context.assertRepositoryShapePolicy({
  archetype: "documentation-site",
  requiredLanes: ["content", "contracts", "tests", "scripts", ".github"],
  optionalLanes: [
    "components",
    "snippets",
    "conformance",
    "examples",
    "localization",
    "assets",
  ],
  exceptions: [],
  crates: [],
  subLanes: { content: ["get-started", "guides", "reference"] },
  forbiddenPaths: [],
  requireReleaseReadiness: true,
});
```

## Application Layouts

An independently released application keeps one virtual workspace and moves
its implementation out of the repository root:

```text
application/
  Cargo.toml
  crates/
    application/
    proto/
    proto-codec/          # only with a real wire/domain conversion boundary
  contracts/
  conformance/
  config/                 # optional
  migrations/             # optional
  resources/              # optional
  vectors/                # optional
  fuzz/                   # optional
  examples/               # optional
  docs/
  scripts/
    release-readiness/
  .github/
```

```js
context.assertRepositoryShapePolicy({
  archetype: "application",
  requiredLanes: ["crates", "contracts", "conformance", "docs", "scripts", ".github"],
  optionalLanes: ["config", "migrations", "resources", "vectors", "fuzz", "examples"],
  exceptions: [],
  crates: [
    { path: "crates/application", role: "domain" },
    { path: "crates/proto", role: "proto" },
    { path: "crates/proto-codec", role: "proto-codec" },
  ],
  subLanes: {},
  forbiddenPaths: [],
  requireReleaseReadiness: true,
});
```

An application collection keeps application-owned material together beneath
each declared application. Shared root crates must not become a dumping ground
for behavior that has a clear application owner:

```text
application-collection/
  Cargo.toml
  apps/
    first-application/
      contracts/
        proto/
      config/
      migrations/
      resources/
      src/
      tests/
    second-application/
      contracts/
        proto/
      src/
      tests/
  crates/                  # optional, genuinely shared implementation only
  contracts/               # optional, collection-wide commitments only
  conformance/
  vectors/                 # optional
  fuzz/                    # optional
  examples/                # optional
  docs/
  scripts/
    release-readiness/
  .github/
```

```js
context.assertRepositoryShapePolicy({
  archetype: "application-collection",
  requiredLanes: ["apps", "conformance", "docs", "scripts", ".github"],
  optionalLanes: ["crates", "contracts", "vectors", "fuzz", "examples"],
  exceptions: [],
  crates: [{ path: "crates/shared-events", role: "support" }],
  subLanes: { apps: ["first-application", "second-application"] },
  forbiddenPaths: [],
  requireReleaseReadiness: true,
});
```

## Protocol-Engine Example

```js
context.assertRepositoryShapePolicy({
  archetype: "protocol-engine",
  requiredLanes: ["crates", "contracts", "conformance", "docs", "scripts", ".github"],
  optionalLanes: ["vectors", "fuzz", "examples"],
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

## Platform Workspace Example

```js
context.assertRepositoryShapePolicy({
  archetype: "platform-workspace",
  requiredLanes: [
    "crates",
    "kits",
    "apps",
    "servers",
    "workers",
    "conformance",
    "docs",
    "scripts",
    ".github",
  ],
  optionalLanes: [],
  exceptions: [],
  crates: [{ path: "crates/platform", role: "support" }],
  subLanes: {
    apps: ["example"],
    kits: ["app", "server"],
    servers: ["example"],
    workers: ["example"],
  },
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
