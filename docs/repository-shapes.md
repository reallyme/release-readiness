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
| `crates/` | Rust implementation packages with explicitly declared architectural roles |
| `bindings/` | ABI and platform adapters only |
| `gen/` | Generated platform-language sources |
| `packages/` | Distributable developer packages |
| `apps/` | Named application or deployable boundaries within a collection, product workspace, or platform workspace |
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

Specialized archetypes add the following vocabulary:

| Lane | Meaning |
| --- | --- |
| `apps/<app>/contract/` | The one canonical contract package owned by a particular application |
| `kits/` | Reusable, host-neutral platform composition kits |
| `servers/` | Native server compositions in a platform workspace |
| `workers/` | Edge or Worker compositions in a platform workspace |
| `services/` | Independently named deployed service boundaries |
| `config/` | Non-secret application or service configuration, defaults, and schemas |
| `configs/` | Non-secret runtime-composition inputs for several executable hosts |
| `configuration/` | Infrastructure configuration-management definitions |
| `deploy/` | Buildable deployment artifacts and generic deployment examples owned with a product, runtime, or service |
| `deployments/` | Environment and provider deployment definitions owned by infrastructure |
| `operations/` | Runbooks, operational policy, and reviewed control-plane declarations |
| `migrations/` | Versioned application or service data migrations |
| `resources/` | Non-secret runtime resources shipped with an application |
| `docker/` | Container composition owned by a service or runtime repository |
| `topology/` | Authored infrastructure topology and environment relationships |
| `provisioning/` | Infrastructure resource provisioning definitions |
| `networking/` | Ingress, routing, load balancing, and network policy |
| `observability/` | Metrics, logs, traces, alerts, and dashboards |
| `tools/` | Infrastructure-owned compiled or scripted operational tools |
| `upstream/` | Pinned third-party conformance suites or immutable source snapshots |
| `plans/` | Owned conformance selections and execution plans |
| `adapters/` | Integration code between an upstream suite and systems under test |
| `results/` | Raw, reproducible conformance execution output |
| `evidence/` | Reviewed certification or conformance evidence |
| `localization/` | Documentation translations and locale-specific content |
| `test/` | Tests for a tooling repository; implementation repositories use package-local test directories |
| `fixtures/` | Stable inputs owned by tooling tests rather than interoperability vectors |
| `templates/` | Consumer templates owned by a tooling repository |
| `.cargo/` | Repository-scoped Cargo configuration |
| `.changeset/` | Changesets for a developer platform's distributable packages |
| `gradle/` | Shared Gradle build infrastructure for a developer platform |

Root `contracts/` and nested `apps/<app>/contract/` are intentionally different.
The plural root lane records repository-wide public commitments. The singular
nested lane is one application-owned contract package and is the only location
for that application's protobuf schemas in application collections and platform
workspaces. Likewise, `config/`, `configs/`, and `configuration/` reflect three
different owners; they are not spelling variants.

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
| `application` | One independently released application whose deployment and operations are owned elsewhere |
| `application-collection` | Independent applications colocated without sharing one product protocol or lifecycle |
| `product-workspace` | Cooperating applications, shared foundations, and optional SDKs that jointly implement one product |
| `hosted-service` | A deployed service together with its deployment and operational ownership |
| `platform-workspace` | Shared platform kits, applications, servers, workers, and cross-host conformance |
| `runtime-composition` | Executable host composition without application or protocol business ownership |
| `infrastructure` | Provisioning, configuration, networking, deployment, and operational control planes |
| `conformance-suite` | Pinned upstream suites, owned plans and adapters, results, and certification evidence |
| `taxonomy` | Canonical vocabulary and schemas with generated consumer views and compatibility declarations |
| `documentation-site` | Versioned public or internal documentation whose navigation, contracts, examples, and checks ship together |
| `tooling` | Repository-independent development, policy, generation, or release tooling |

Select exactly one archetype from the repository's primary ownership and
release boundary, not from whichever name makes its current directories pass.
The following tests resolve the most common overlaps:

- Use `protocol-engine`, not `foundational-library`, when the repository owns an
  end-to-end protocol contract and its conformance behavior.
- Use `developer-platform` when the primary product is a coordinated public SDK
  surface across languages; having one incidental binding does not qualify.
- Use `hosted-service` when the repository owns deployed service boundaries,
  deployment artifacts, and operations together. Use `runtime-composition`
  when it owns executable wiring but imports the application or protocol
  behavior from elsewhere.
- Use `infrastructure` when provisioning, topology, networking, and operational
  control are the product of the repository rather than one hosted service.
- Use `platform-workspace` only for a reusable platform spanning kits,
  applications, native servers, and Workers with application-owned contracts.
  It is not a larger spelling of `product-workspace`.
- Use the application decision table below for one application, independent
  colocated applications, or cooperating applications that form one product.

Typed exceptions document externally imposed roots; they do not combine two
archetypes or excuse an architecture that belongs in another profile.

### `foundational-library`

- Required: `crates`, `docs`, `scripts`, `.github`.
- Permitted: `crates`, `bindings`, `gen`, `packages`, `contracts`,
  `conformance`, `vectors`, `fuzz`, `examples`, `docs`, `scripts`, `.github`,
  `.cargo`.

This profile owns reusable technical or domain foundations. It may publish
several focused crates, but it does not own an end-to-end protocol, application
lifecycle, or deployment. Optional bindings and packages expose the same
foundation rather than forming a separate developer product.

### `protocol-engine`

- Required: `crates`, `contracts`, `conformance`, `docs`, `scripts`, `.github`.
- Permitted: `crates`, `bindings`, `gen`, `packages`, `contracts`,
  `conformance`, `vectors`, `fuzz`, `examples`, `docs`, `scripts`, `.github`,
  `.cargo`.

This profile owns an end-to-end protocol contract, its domain behavior, wire
boundaries, and conformance evidence. It does not own a hosted deployment or a
multi-language developer experience merely because it generates bindings.

### `developer-platform`

- Required: `bindings`, `gen`, `packages`, `examples`, `contracts`,
  `conformance`, `docs`, `scripts`, `.github`.
- Permitted: `crates`, `bindings`, `gen`, `packages`, `contracts`,
  `conformance`, `vectors`, `fuzz`, `examples`, `docs`, `scripts`, `.github`,
  `.cargo`, `.changeset`, `gradle`.

This profile owns one coordinated public developer surface across language and
platform bindings. Generated code stays in `gen/`, authored packaging stays in
`packages/`, and examples demonstrate the supported public API rather than
internal engines.

### `application`

- Required: `crates`, `contracts`, `conformance`, `docs`, `scripts`, `.github`.
- Permitted: `crates`, `contracts`, `conformance`, `vectors`, `fuzz`,
  `examples`, `docs`, `scripts`, `.github`, `.cargo`, `config`, `migrations`,
  `resources`.

This profile owns one independently released application. Its domain behavior,
ports, configuration schema, resources, and public contracts remain here.
Production deployment, operational control, credentials, and infrastructure do
not. Rust implementation belongs beneath `crates/<application>`. A protobuf
boundary uses the canonical `crates/proto` and, only when justified,
`crates/proto-codec` structure. If the repository also owns a continuously
operated service's deployment and operations, use `hosted-service` instead.

### `application-collection`

- Required: `apps`, `conformance`, `docs`, `scripts`, `.github`.
- Permitted: `apps`, `crates`, `contracts`, `conformance`, `vectors`, `fuzz`,
  `examples`, `docs`, `scripts`, `.github`, `.cargo`.

This profile colocates several applications that remain independently bounded.
There must be at least two declared applications. They may share repository
automation or small technical utilities, but they do not collectively form one
product protocol or require coordinated runtime evolution. Each application is
independently releasable even if the repository sometimes releases them
together. Every immediate `apps/<app>` lane is declared explicitly.
Application-specific implementation, configuration, resources, migrations,
and contracts stay beneath that application. Protobuf schemas live beneath
`apps/<app>/contract/proto`; a collection does not create a workspace-wide
canonical proto crate. Root `crates/`, when present, contains only genuinely
shared technical support and every package remains role-declared. If changing
one application normally requires coordinated protocol or domain changes in
the others, use `product-workspace` instead.

### `product-workspace`

- Required: `apps`, `crates`, `conformance`, `docs`, `scripts`, `.github`.
- Permitted: `apps`, `crates`, `bindings`, `gen`, `packages`, `contracts`,
  `conformance`, `vectors`, `fuzz`, `examples`, `docs`, `scripts`, `.github`,
  `.cargo`, `deploy`.

This profile owns one cohesive product implemented by at least two cooperating
applications. The applications may have different runtimes and deployment
units, but they share product semantics, a coordinated compatibility boundary,
or a canonical protocol. Shared domain, protocol, codec, client, generated SDK,
and optional facade packages belong in the corresponding root-level `crates/`,
`gen/`, and `packages/` lanes. Canonical protobuf schemas use `crates/proto`;
unlike `application-collection`, protocol ownership is not distributed beneath
each application. Generic build and deployment examples may live in `deploy/`;
environment-specific topology, credentials, secret values, and private rollout
policy remain in hosted-service or infrastructure repositories.

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

This profile owns the shared platform facade, reusable host-neutral kits,
reference applications, native server composition, Worker composition, and
cross-host conformance. Each application owns its protobuf schema beneath
`apps/<app>/contract/proto`; the platform does not centralize app contracts in a
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

This profile owns repository-independent checkers, generators, policy, or
release automation. Consumer templates remain distinct from the tool's own
tests and fixtures. It is the only archetype allowed to disable the requirement
to vendor release-readiness into itself. A root package entrypoint such as this
repository's single-file vendorable core is a distributable file, not a new
directory lane; executable automation remains in `scripts/`.

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
- A repository may declare zero or one crate with role `facade`. A facade is a
  packaging surface, not a repository archetype, and requires at least one
  internal package.
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
  beneath its owning `apps/<app>/contract/proto` directory.
- Nested Cargo packages beneath `crates/proto` are forbidden.
- `bindings/`, `gen/`, and `packages/` declare every tracked immediate sublane.
  A `hosted-service` declares every immediate `services/` sublane; a `taxonomy`
  declares every immediate `views/` sublane; and a `documentation-site`
  declares every immediate `content/` sublane. An `application-collection` or
  `product-workspace` declares every immediate `apps/` sublane. A
  `platform-workspace` additionally declares every immediate `apps/`, `kits/`,
  `servers/`, and `workers/` sublane.
- An `application-collection` and a `product-workspace` each declare at least
  two immediate application sublanes. A repository with one independently
  released application uses `application`.
- Consumer repositories retain the local checker and vendored shared core under
  `scripts/`. Only the `tooling` archetype may set `requireReleaseReadiness` to
  `false`, allowing this package to validate its source core rather than vendor
  a copy of itself.
- Additional repository-specific retired paths may be declared in
  `forbiddenPaths`.

## Cargo Crate Roles

Every Cargo package beneath `crates/` declares exactly one role from this
closed vocabulary. The role records the package's primary architectural
responsibility; it is not a substitute for dependency-boundary checks.

| Role | Permitted responsibility |
| --- | --- |
| `domain` | Core domain values, invariants, and behavior without transport or storage ownership |
| `proto` | Canonical protobuf schemas and generated wire DTOs |
| `proto-codec` | Authored validation and conversion between untrusted wire DTOs and domain values |
| `adapter` | Translation at an inbound, outbound, platform, or FFI boundary |
| `transport` | Protocol transport mechanics and clients without product-domain decisions |
| `provider` | A concrete implementation of a domain-owned external capability port |
| `storage` | Persistence implementation behind a domain-owned storage port |
| `runtime` | Executable lifecycle, dependency wiring, and host composition |
| `facade` | A thin, stable consumer package aggregating explicitly selected internal APIs |
| `support` | Reusable internal technical support with no domain, runtime, or public-facade ownership |
| `test-support` | Reusable test-only builders, fixtures, and harness support |

Choose the narrowest truthful role. For example, a client that owns HTTP or RPC
mechanics is `transport`; a package implementing a business capability through
an external vendor is `provider`; and code translating either boundary into
domain requests is an `adapter`. Mixed responsibilities should be separated or
resolved in architecture review rather than hidden behind `support`.

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

## Facade Role

A facade is optional and independently configurable for every crate-bearing
archetype. Declare it by assigning one crate the `facade` role; do not select a
different archetype and do not add a separate Boolean that could disagree with
the crate declaration:

```js
crates: [
  { path: "crates/domain", role: "domain" },
  { path: "crates/client", role: "transport" },
  { path: "crates/product", role: "facade" },
]
```

Omitting the role means the repository has no facade. The checker permits at
most one and rejects a facade with no internal package to aggregate. A facade
exists only to provide a deliberate, stable consumer surface: feature
selection, explicit named re-exports, and package documentation. It must not
own domain behavior, adapters, runtime composition, storage, protocol
conversion, or generated code. Rust source policy keeps its `lib.rs` thin;
dependency-boundary review must additionally ensure internal crates never
depend back on the facade.

Use a facade when external consumers benefit from one deliberately curated
package while the implementation remains split across several internal
packages. Omit it when consumers already depend on a single natural package or
when every package is an intentionally separate public surface. Repository size
alone is not a reason to add one.

## Choosing an Application Archetype

| Question | `application` | `application-collection` | `product-workspace` |
| --- | --- | --- | --- |
| How many applications? | One | At least two independently bounded applications | At least two cooperating applications |
| Product ownership | The application is the independently released unit | Each application retains its own product and compatibility boundary | The repository owns one product spanning all applications |
| Protocol ownership | One canonical `crates/proto`, when needed | Each `apps/<app>/contract/proto` owns its protocol | One shared canonical `crates/proto`, when needed |
| Shared domain and SDKs | Internal to the one application | Only small, product-neutral technical support | Expected when genuinely shared by the product |
| Release and compatibility | One release unit | Applications can evolve or separate independently | Coordinated across the product components |
| Deployment material | Application-neutral config and resources; host composition elsewhere | Application-owned material stays beneath each app | Generic product containers and examples may use root `deploy/` |
| Facade | Optional | Optional when shared root crates exist | Optional |

Use the ownership and compatibility rows as the deciding test. The number of
directories alone does not determine the archetype.

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
      contract/
        proto/
      config/
      migrations/
      resources/
      src/
      tests/
    second-application/
      contract/
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

A product workspace keeps cooperating deployables beneath `apps/` while shared
product semantics and protocol packages remain canonical:

```text
product-workspace/
  Cargo.toml
  apps/
    agent/
    controller/
    web/
  crates/
    domain/
    client/
    proto/
    proto-codec/          # only with a real wire/domain conversion boundary
    product/              # optional facade
  gen/                    # optional generated SDK sources
  packages/               # optional authored SDK packages
  deploy/                 # optional generic containers and examples
  conformance/
  docs/
  scripts/
    release-readiness/
  .github/
```

```js
context.assertRepositoryShapePolicy({
  archetype: "product-workspace",
  requiredLanes: ["apps", "crates", "conformance", "docs", "scripts", ".github"],
  optionalLanes: ["gen", "packages", "deploy"],
  exceptions: [],
  crates: [
    { path: "crates/domain", role: "domain" },
    { path: "crates/client", role: "transport" },
    { path: "crates/proto", role: "proto" },
    { path: "crates/proto-codec", role: "proto-codec" },
    { path: "crates/product", role: "facade" },
  ],
  subLanes: {
    apps: ["agent", "controller", "web"],
    gen: ["typescript"],
    packages: ["ts-client"],
  },
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
  crates: [{ path: "crates/platform", role: "facade" }],
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
