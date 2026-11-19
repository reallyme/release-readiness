# Dependency maintenance before release

Package preflight runs the dependency maintenance gate after verifying Required
CI for the candidate commit. Publishing reuses that successful preflight and
its prepared artifacts. The gate checks versions and security; it does not
change manifests, update lockfiles, install tools, or rebuild packages.

Run the same check locally before preparing a release:

```sh
node .release-readiness/scripts/run-consumer-check.mjs --check-dependencies
```

For this repository, use `npm run check:dependencies`. Ordinary policy checks,
PR checks and CI rendering do not contact registries. The online release check
fails when a registry or required tool is unavailable.

## Rust coverage

The gate discovers every tracked `Cargo.toml` and `Cargo.lock`, including
private crates and separate tooling and fuzz workspaces. It resolves each
workspace with `cargo metadata --locked --all-features`, checks registry
dependencies throughout the resolved graph, and checks direct requirements
for every workspace member. Renamed dependencies use their registry names.
Build, development, optional and target dependencies are included in Cargo's
metadata. Every tracked lockfile must belong to a reviewed workspace.

For every workspace it runs `cargo update --dry-run`, `cargo outdated
--workspace --format json`, and `cargo audit --json --file <lockfile>`.
Install cargo-outdated and cargo-audit beforehand, using reviewed exact
versions. Current stable releases are cargo-audit 0.23.0 and cargo-outdated
0.19.0. For example, install them once in the preflight verification job:

```yaml
- name: Install dependency maintenance tools
  uses: taiki-e/install-action@75a7c0f87bd666af3cdb75c5b9e9d03ab6044e6f
  with:
    tool: cargo-audit@0.23.0,cargo-outdated@0.19.0
    fallback: none
```

A missing tool, audit failure, advisory ignore, or changed lockfile
blocks preflight. Version holds cannot waive security findings or yanked
versions. Severity and target filters that hide audit results are rejected.
Unsoundness findings block release; informational maintenance notices are
reported with their advisory IDs for review. GitHub Git dependencies are compared with their repository's highest
stable tag; a deliberately newer or fork-specific commit needs a scoped hold.
Other Git hosts and non-crates.io registries currently block the gate because
their stable-release authority is not implemented.

Update constraints and pins deliberately, including feasible major updates.
The recommended requirement is `^LATEST_STABLE` or `=LATEST_STABLE`, keeping the
repository's existing choice of caret or exact requirements. Re-run the gate
after updating. Use a scoped hold for a transitive dependency whose upstream
parent still requires an older version, an MSRV constraint, a supported API,
or another deliberate compatibility decision.

After changing dependencies, validate every workspace locally with:

```sh
node .release-readiness/scripts/run-consumer-check.mjs --check-dependencies --validate
```

That mode adds `cargo fmt --all --check`, workspace Clippy with all targets and
features and `-D warnings`, and workspace tests with all features. Clippy and
tests use `--locked`. Fix API incompatibilities before submitting the changes;
preserve public APIs and supported Rust versions. Preflight reuses the existing
Required CI result instead of repeating those builds for every ecosystem.
Keep repository-native formatting, linting, testing, conformance and MSRV
checks in CI; the freshness gate does not replace them.

## CI actions and installed tools

Actions remain pinned to full commit SHAs. The gate compares each action's
repository with its highest stable version tag, including major/minor action
tags, peeled annotated tags and projects without GitHub release records.
At the same version, a full version tag takes precedence over a moving alias. It also
checks exact crates.io versions installed with `cargo install` or the
`cargo-*` tools passed to `taiki-e/install-action`, the standard Cargo tool
version environment variables, `BUFFA_VERSION`, and `BUF_VERSION`.
Versioned tools such as Buf and Cargo Git dependencies use full stable version
tags; major/minor aliases apply only to actions.
Named and unnamed steps are included. Workflows must use explicit block step
mappings; unsupported syntax fails rather than omitting dependency installs.

Cargo Deny installations must select an exact stable version with checksums
and no source fallback, or use an exact locked source installation. The core
does not require one aging cargo-deny version: the release maintenance gate
requires the current registry release, subject to a scoped version hold.
For example, use `cargo-deny@0.21.0` and the current reviewed installer SHA in
the [Rust release guide](rust-release.md).

Newer stable releases still need review: this gate reports changes; it never
substitutes mutable `latest` references into workflows. An action's newest
tag does not establish that its bundled dependencies have no advisories.
Audit those dependencies separately during maintenance and document any
upstream fixes that are not yet available in a stable action release.

## Deliberate version holds

Track `.github/dependency-maintenance.json` alongside the repository-owned
checker. Only individual freshness findings can be overridden:

```json
{
  "schema": 1,
  "exceptions": [
    {
      "kind": "crate",
      "path": "Cargo.lock",
      "name": "example-dependency",
      "current": "1.4.0",
      "latest": "2.0.0",
      "reason": "The upstream bridge requires the 1.x API; migrate it before updating.",
      "expires": "2026-12-19"
    }
  ]
}
```

Kinds are `crate` for a resolved version or installed Cargo tool, `requirement`
for a member manifest's direct requirement, `action` for an action SHA, and
`action-version` for a versioned tool such as Buf, and `git` for a GitHub source
dependency or tool pinned to a full commit. Use the owning manifest,
lockfile, or workflow as `path`. A requirement's `current` is Cargo's normalized
requirement, such as `^1.4.0`; an action's `current` is its full pinned SHA.
For `git`, `name` is `owner/repository` and `current` is the full commit.
`latest` names the stable upstream version being deliberately held. For an
Action with only a major/minor release tag, use its advertised full commit SHA
instead; the hold then covers that exact target rather than future alias updates.

Every hold needs a concrete reason and expiry. Expired, duplicate, unused,
untracked-path and malformed holds fail. A newly published upstream version
requires reviewing and renewing the exact hold. There is no blanket skip,
security-advisory suppression, or success fallback for network failures.

Prerelease crates require a hold for each resolved lockfile version and an
exact `=VERSION` requirement with its own hold in each member manifest.
These holds name the latest stable release and cannot waive audits or yanks.
