# Repository Archetype Matrix

Repository archetypes describe what a repository owns and releases. They do
not classify a repository by programming language, executable type, or current
directory names. Select exactly one archetype from the repository's primary
responsibility and compatibility boundary.

| Archetype | Repository responsibility | Deciding test |
| --- | --- | --- |
| `foundational-library` | Reusable technical or domain foundations | Consumers compose the library; the repository does not own an end-to-end protocol or deployment |
| `protocol-engine` | Protocol contracts, domain behavior, wire boundaries, adapters, and conformance | The repository implements and verifies a complete protocol lifecycle |
| `developer-platform` | One coordinated public SDK surface across languages and platforms | Bindings, generated sources, packages, and examples release as one developer product |
| `application` | One independently released application | One application owns the behavior; deployment and operations are owned elsewhere |
| `application-collection` | At least two independently releasable applications with optional shared packages | Any application can evolve, move, or be removed without redefining the others' product boundary |
| `product-workspace` | Multiple cooperating applications that jointly implement one product | Components require coordinated compatibility and product releases to remain useful together |
| `hosted-service` | An operated service together with deployment and operational ownership | Behavior, deployment artifacts, and runbooks intentionally ship from one repository |
| `platform-workspace` | A reusable platform spanning kits, reference applications, native hosts, edge hosts, and conformance | The repository provides reusable application and host machinery rather than one product |
| `runtime-composition` | Executable native or edge hosts that compose behavior owned elsewhere | The repository selects applications and runtime bindings but does not own their business behavior |
| `infrastructure` | Provisioning, topology, networking, deployments, observability, and operational control | Environment and provider control are the repository's primary output |
| `conformance-suite` | Pinned upstream suites, owned plans and adapters, results, and evidence | The repository's release artifact is reproducible conformance and certification evidence |
| `taxonomy` | Canonical vocabulary and schemas with generated consumer views | One authored semantic source feeds validated projections and compatibility declarations |
| `documentation-site` | Versioned documentation, examples, navigation, and documentation tests | The documentation experience itself is the released product |
| `tooling` | Repository-independent development, policy, generation, or release tooling | The repository supplies reusable automation rather than product or protocol behavior |

## Application Decision

- If an app can be versioned, deployed, removed, or moved independently, it
  belongs in an `application-collection`.
- If agent, controller, web, or similar components must evolve together for the
  product to remain compatible, it is a `product-workspace`.
- Sharing `crates/domain`, `crates/events`, or `crates/proto` does **not** by
  itself create a product workspace.

Application archetypes are language-neutral. A standalone application, each
member of an application collection, and each product component may use Rust,
TypeScript, or both. The language changes implementation layout and validation,
not ownership or release classification.

## Server and Service Decision

A server is an executable role, not automatically a repository archetype:

- A server that owns application behavior while deployment is managed elsewhere
  is an `application`.
- A server or edge host that only composes applications owned elsewhere is a
  `runtime-composition`.
- A service that owns behavior, deployment, and operations together is a
  `hosted-service`.

Use [`repository-shapes.md`](repository-shapes.md) for the enforced directory
lanes, crate roles, protobuf ownership rules, and configuration examples.
