# Rust toolchains and dependency review

Pin `rust-toolchain.toml` and release CI to Rust **1.100.0**. Use Rust
**1.96** as the recommended minimum supported Rust version (MSRV) for new
public crates. Keep lower supported versions where they are useful to
consumers and verified in CI. A crate can declare a higher minimum when its
API, dependencies, or supported targets require it. Use the exact patch in
`rust-version` when that patch is the minimum.
[Rust 1.100 release](https://blog.rust-lang.org/2026/11/12/Rust-1.100.0/) ·
[Cargo MSRV guidance](https://doc.rust-lang.org/cargo/reference/rust-version.html)

## Required CI checks

The pinned runner requires `assertRustReleasePolicy` for repositories with a
tracked root `Cargo.toml`. Use it directly in any archetype or pass the same
object as `rustRelease` to `assertReallyMeRustProtoRepositoryPolicy`.

```toml
# rust-toolchain.toml
[toolchain]
channel = "1.100.0"
profile = "minimal"
components = ["rustfmt", "clippy"]
```

```js
context.assertRustReleasePolicy({
  release: {
    workflow: ".github/workflows/rust-ci.yml",
    job: "release",
    step: "Test on the release toolchain",
  },
  artifacts: [
    {
      workflow: ".github/workflows/crates-release.yml",
      job: "publish",
      step: "Publish example-api",
      run: "cargo +1.100.0 publish --locked --package example-api",
    },
  ],
  msrv: [
    {
      package: "example-api",
      workflow: ".github/workflows/rust-ci.yml",
      job: "msrv",
      step: "Test example-api at its declared MSRV",
    },
  ],
  dependencyReview: {
    workflow: ".github/workflows/rust-ci.yml",
    job: "dependencies",
    step: "Check locked dependencies",
  },
});
```

With `example-api` declaring `rust-version = "1.96"`, wire these exact named
steps into the corresponding CI jobs after checkout and toolchain setup:

```yaml
# In job release
- name: Test on the release toolchain
  run: cargo +1.100.0 test --locked --workspace --all-features

# In job msrv
- name: Test example-api at its declared MSRV
  run: cargo +1.96.0 test --locked --package example-api --all-features

# In job dependencies, in this order
- name: Install cargo-deny
  run: cargo +1.100.0 install cargo-deny --version '=0.20.2' --locked
- name: Check locked dependencies
  run: cargo +1.100.0 deny --locked --workspace --all-features --config deny.toml check advisories licenses sources
```

Add an MSRV entry for every publishable workspace member. Cargo metadata
resolves inherited manifest fields and publication settings. Use `msrv: []`
for a fully private workspace. Declare Cargo build, package, and publication
steps under `artifacts` when the repository ships them. The checker validates
the named commands and their exact toolchain without executing them. Run the
verification jobs on source changes and make them required in the repository's
merge and release workflows. Before publishing, require successful checks and
package preflight for the exact commit being released. Keep publishing
credentials in the publishing job. The release workflow verifies the check
results for its selected revision. Use unfiltered change triggers so every
source change is covered. If using `paths`, include
the checker, toolchain file, workspace manifests, and lockfile. The dependency
workflow also needs coverage for `deny.toml`. Extend repository CI for
additional supported targets, feature combinations, and any separate tooling
or fuzzing lockfiles.

## Lockfiles and security patches

Commit `Cargo.lock` with dependency changes. The CI audit checks the locked
workspace graph, including new direct and transitive dependencies, against
RustSec advisories and the repository's license and source rules. Review the
audit configuration for target exclusions and advisory suppressions. Every
shipped target and its dependency graph need coverage. Use the
[shared Cargo Deny template](../templates/deny.toml) for the license baseline
and retain the repository's source restrictions and reviewed exceptions.

Handle upgrades in a separate reviewed dependency change. A new version alone
is routine maintenance. Prioritize applicable security fixes. Run the audit
regularly as well as on changes so new advisories can surface against unchanged
lockfiles. For a targeted patch, run the following with the affected crate and
reviewed fixed version:

```sh
cargo +1.100.0 update --dry-run --package CRATE@CURRENT_VERSION --precise FIXED_VERSION
cargo +1.100.0 update --package CRATE@CURRENT_VERSION --precise FIXED_VERSION
```

Review the manifest and lockfile diff, then rerun release tests, MSRV tests,
and Cargo Deny. If an exact manifest requirement blocks the fix, update that
requirement in the same reviewed dependency change. Release-readiness validates
the CI wiring and keeps the lockfile untouched. CI performs the audit and
requires successful locked resolution.
[Cargo update reference](https://doc.rust-lang.org/cargo/commands/cargo-update.html) ·
[Cargo Deny advisory checks](https://embarkstudios.github.io/cargo-deny/checks/advisories/cfg.html)
