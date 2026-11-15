<!-- SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited -->
<!-- SPDX-License-Identifier: MIT OR Apache-2.0 -->

# CI for public ReallyMe repositories

Track `.github/release-readiness.json`, a generated `.github/workflows/ci.yml`,
and the [CLA workflow](../templates/README.md#public-repository-cla). Configure
the GitHub ruleset to require the `Required CI` job and the separate
`CLAAssistant` result. Switch the ruleset after verifying the new check names
on a pilot PR.

## Lane configuration

```json
{
  "schema": 1,
  "lanes": {
    "policy": { "workflow": "release-readiness.yml" },
    "code": { "workflow": "code-checks.yml", "paths": ["crates/", "tests/"] },
    "proto": {
      "workflow": "protobuf-ci.yml",
      "paths": ["proto/", "gen/", "crates/proto/"]
    },
    "swift": {
      "workflow": "swift-ci.yml",
      "paths": ["Package.swift", "Package.resolved", "packages/swift/", "crates/"]
    },
    "formal": {
      "workflow": "formal-verification.yml",
      "paths": ["crates/runtime/", "crates/types/", "formal/"]
    }
  }
}
```

The `policy` lane always runs. Use `code`, `proto`, `security`, `fuzz`, `wasm`,
`swift`, `android`, `conformance`, or `formal` where the repository needs those checks.
Tracked protobuf schemas require a `proto` lane, including in repos without SDKs.
Each lane names a tracked reusable workflow in `.github/workflows/`. Keep the
commands in that workflow or its existing local scripts so developers can run
the same verification locally. Remove the adapter's standalone triggers and
workflow-level concurrency when moving it under the shared workflow.

The shared workflow runs for PRs targeting `main`, pushes to `main`, merge queue
candidates, and manual dispatches. It cancels superseded PR runs. The scope job
compares the candidate with its base: the test merge's first parent for a PR,
the queue base for a merge group, and the previous `main` commit for a push.
It uses exact file paths or directory prefixes ending in `/`. Omit `paths` to
start a lane immediately on every candidate. Each configured path must cover
tracked files. Include shared native inputs in SDK lanes, along with the SDK
sources and fixtures.

Changes to the lane configuration, `.github/workflows/`, `.github/actions/`,
`.github/scripts/`, `scripts/`, and the shared Rust, npm, and Buf inputs activate
every lane. Shell commands can resolve helpers through environment variables,
working directories, or other scripts, so changes under these automation
directories always trigger the checks. List build and verification inputs
outside those paths in the lanes that use them. Repository metadata such as
issue templates and `CODEOWNERS` only activates unscoped lanes. An unavailable
comparison base activates every lane. Manual dispatch runs the full suite.

Set `"mergeQueue": true` when the repository merges through a GitHub merge
queue. The queue tests the exact commit that `main` then fast-forwards to, so
the generated workflow drops its `push` trigger rather than run the same tree a
second time. Release qualification accepts that queue run once the SHA is on
`main`. A direct push to `main` then runs no CI, so dispatch the workflow for
such a commit before releasing it.

Use standard GitHub-hosted runner labels. A matrix can select a runner from a
static axis or from static `include` rows. Give every include row a runner and
cover every base combination when the rows supply the runner. For example:

```yaml
runs-on: ${{ matrix.runner }}
strategy:
  matrix:
    include:
      - target: aarch64-apple-ios
        runner: macos-15
      - target: aarch64-linux-android
        runner: ubuntu-24.04
```

Keep self-hosted conformance and jobs that upload security results in separate
workflows with their own trigger and permission controls. Run bounded fuzz
checks in the `fuzz` lane and keep longer fuzz campaigns and recurring
advisory scans in their scheduled workflows. Use `android` for the minified JNI
runtime gate. Keep the production bridge and shared schema fixtures in the SDK
checks that own them. Avoid rerunning commands in a standalone push or PR
workflow once the same commands are wired into a lane.

## Reusable lane

The policy lane checks out the candidate and the release-readiness package at
a full commit SHA. It runs the pinned checker in the job that returns the
verified SHA. Replace the placeholder below with the reviewed commit.
Other lanes use the same workflow output and run their repository-specific
commands. Return the candidate SHA from the final successful job.
For a lane with multiple jobs, make the receipt job depend on every required
job and verify that each succeeded before writing its output. For a single-job
lane, write the output after verification.

```yaml
on:
  workflow_call:
    outputs:
      verified_sha:
        value: ${{ jobs.verify.outputs.verified_sha }}

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    outputs:
      verified_sha: ${{ steps.verified.outputs.sha }}
    steps:
      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          persist-credentials: false
      - name: Checkout release-readiness
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          repository: reallyme/release-readiness
          ref: FULL_RELEASE_READINESS_COMMIT_SHA
          path: .release-readiness
          persist-credentials: false
      - name: Setup Node
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
        with:
          node-version: "26"
      - name: Run release readiness checks
        run: node .release-readiness/scripts/run-consumer-check.mjs
      - name: Record verified source
        id: verified
        shell: bash
        run: |
          sha=$(git rev-parse --verify HEAD)
          test "$sha" = "$GITHUB_SHA"
          echo "sha=$sha" >>"$GITHUB_OUTPUT"
```

Stage new lane workflows and the config before rendering. Review the generated
file, stage it and the CLA workflow, then run both local checks before pushing.
`actionlint` catches GitHub expression and workflow schema errors.

```sh
node .release-readiness/scripts/run-consumer-check.mjs --render-ci > .github/workflows/ci.yml
git add .github/workflows/ci.yml .github/workflows/cla.yaml
RELEASE_READINESS_PUBLIC_REPO=true node .release-readiness/scripts/run-consumer-check.mjs --check-workflows
actionlint
```

Run the policy check from the candidate merge checkout when the rollout lands
alongside another branch. The combined tree can introduce requirements such as
a formal lane for newly tracked Kani harnesses.

When moving checks into reusable workflows, verify the affected job's setup
from a clean checkout with empty dependency caches. Each hosted job needs
its own setup for the commands it runs:

- Install the native libraries selected by the tested features in every job
  that uses them, including MSRV jobs that test with `--all-features`.
- Run `cargo fetch --locked` before offline proofs that resolve Cargo metadata
  across targets. Fetch from the workspace that owns the lockfile the proofs use.
- Install dependencies from every npm lockfile the check uses. A conformance
  package that builds an SDK in another directory may need both installs.

Rehearse the consumer's tooling tests with the GitHub Actions environment they
will inherit. Include a public push event payload and its matching
`GITHUB_REPOSITORY` with `GITHUB_ACTIONS=true`. When a test invokes the pinned
runner in a scratch checkout, give its child process its own matching event
data or clear `GITHUB_ACTIONS`, `GITHUB_EVENT_PATH`, and `GITHUB_REPOSITORY` for
local-mode fixtures. Give local publisher fixtures only the environment they
need so they exercise their intended path without inheriting live release
inputs or credentials.

## Android runtime

Use the [Android runtime workflow](../templates/android-runtime.yml) for the
`android` lane. Set its release-readiness pin to the reviewed full commit SHA.
The standard builds one release publication per qualified SHA. It tests the
published library as an external dependency of a small minified consumer app.
This covers the AAR, its consumer keep rules, and the JNI loading path in one
device run. [Android library optimization guidance](https://developer.android.com/topic/performance/app-optimization/library-optimization)

The template uses three tracked repository scripts.

- `scripts/stage-android-publication.sh MAVEN_REPOSITORY` builds the JNI
  libraries once, verifies every shipped ABI and the AAR's native contents,
  and stages the unsigned release AAR and Maven metadata in an isolated file
  repository.
- `scripts/prepare-android-runtime.sh APK_PATH AVD_NAME MAVEN_REPOSITORY` creates
  the AVD in `ANDROID_AVD_HOME` and builds the minified consumer APK before boot.
  Use `avdmanager create avd --device "$ANDROID_AVD_DEVICE"` with the
  repository's system image. The template supplies `pixel` for 16 KiB runtime
  checks. Preserve an existing verified profile when migrating a different
  image, along with the tested SDK tools and emulator launch options.
  Resolve the repo's own Maven coordinates exclusively from the staged
  repository. The consumer's build must use the published dependency and its
  consumer rules as a downstream repo would.
- `scripts/test-android-runtime.sh DEVICE_SERIAL` runs the minified consumer and
  exits successfully only after its JNI assertions pass. Keep repository-specific
  checks such as required device page size here. Use an image that covers the
  release requirement and verify the page size on the device when claiming
  16 KB support. Use the explicit serial for every ADB command.
  [Android 16 KB guidance](https://developer.android.com/guide/practices/page-sizes#test)

Start with one device profile. Add another when it exercises a distinct
supported behavior, such as Crypto's minimum-API provider fallback. Reuse the
same staged Maven files and consumer build across such profiles. The external
minified consumer can use either an activity smoke test or instrumentation
targeting its minified variant. Build any companion test APK before boot.
Gradle instrumentation can
also cover library-only behaviors with its debug variant where that provides
distinct coverage. [Android Gradle test build types](https://developer.android.com/reference/tools/gradle-api/9.2/com/android/build/api/dsl/TestedExtension#testBuildType())

After starting the emulator, wait for its explicit ADB serial before installing
the APK. The pinned package provides a bounded readiness check with a diagnostic
for the first probe that still fails. It checks the ADB transport, Android boot
property, system-user unlock, package and mount service registration, package
lookup, and writable internal storage. The service checks require the exact
positive response because `service check` can return success with `not found`.
The template gives each cold boot up to 420 seconds across all probes. It
proceeds as soon as the device is ready. When migrating a gate with a larger
tested cold-boot allowance, preserve it within the helper's 600-second limit
and account for it in the job timeout.

```sh
ADB="$ANDROID_HOME/platform-tools/adb" \
  node .release-readiness/scripts/android-runtime.mjs wait "$ANDROID_SERIAL" 420
ADB="$ANDROID_HOME/platform-tools/adb" \
  node .release-readiness/scripts/android-runtime.mjs install "$ANDROID_SERIAL" "$APK_PATH"
```

Exit code `75` identifies a readiness timeout or the package service's
`Broken pipe` during installation. The template can restart the emulator once
after a cold-boot timeout. After an install disconnect, it waits five seconds,
rechecks readiness for up to 60 seconds, and retries the same APK on the same
device. Installation gets at most three attempts. The workflow captures guest
logs before teardown and clears only the main log buffer before testing.
An APK rejection or runtime assertion failure keeps its original exit status.
The `wait` command accepts a
deadline in seconds after the serial, and `diagnostics DEVICE_SERIAL` can
collect guest logs from a local test device. [Android Debug Bridge](https://developer.android.com/tools/adb#devicestatus) · [Android log buffers](https://developer.android.com/tools/logcat)

After the device test succeeds, the workflow uploads the checked Maven
publication and its SHA-256 manifest. Maven preflight's
`Verify release candidate` step returns `ci_run_id` and
`android_artifact_id` from a qualifying CI run at the selected source SHA.
That run must have produced a retained, tested Android publication. If the
evidence is missing, dispatch CI on `main` while it points to the selected SHA.

The Android job restores a Gradle cache on every run and saves it from
successful runs on `main`, which prevents PR code from seeding the shared
cache. In merge-queue repositories, the queue jobs can restore it. After a
cache key change or eviction, use a manual CI dispatch on `main` to refresh
the cache. A dispatch to regenerate missing Android release evidence also
refreshes it.

```yaml
- name: Download tested Android publication
  uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333
  with:
    artifact-ids: ${{ steps.candidate.outputs.android_artifact_id }}
    run-id: ${{ steps.candidate.outputs.ci_run_id }}
    github-token: ${{ github.token }}
    path: ${{ runner.temp }}/android-publication
    merge-multiple: true
    digest-mismatch: error
```

Give the release-candidate verification step the ID `candidate`. After the
download, verify the staged files for `SOURCE_SHA` before packaging the
preflight evidence.

```sh
node .release-readiness/scripts/android-runtime.mjs verify-publication "$RUNNER_TEMP/android-publication/repository" "$SOURCE_SHA" "$RELEASE_VERSION"
```

Keep the existing Maven preflight and publish workflows. Preflight carries
forward the verified publication. Publish signs and promotes those versioned
files. Both steps reuse the AAR and skip native compilation and emulator
tests. [GitHub artifact download inputs](https://github.com/actions/download-artifact/blob/9000827ccba6bdab643e8b6fd33ac0654aef8333/action.yml)

## Formal verification

Add a `formal` lane as part of merging a repository's formal-methods work.
Repositories with `formal-verification.yml`, `formal-methods.yml`, tracked
TLA+ or Tamarin models, or tracked Kani proof attributes must declare the lane. Start with the
[formal verification workflow](../templates/formal-verification.yml), or adapt
the branch's existing jobs. Move required proof jobs out of any independently
triggered workflow when enabling the lane.

Set `paths` to cover the proof harnesses, every model and model configuration
used by the proofs, and the implementation and local dependencies they verify.
The runner checks coverage of tracked Kani harness files, `.tla` and `.spthy`
files, and `.cfg` files beside a TLA+ model. The repository owns the mapping
from proof harnesses to production code. Use an unscoped lane when proof inputs
span the repository.
A shared workflow change activates the lane automatically, as do Cargo
manifests, lockfiles, toolchain files, and Cargo configuration in nested workspaces.

Run a bounded suite through `Required CI`. Give every job an explicit timeout
and group related harnesses so they share tool installation. Independent proof
jobs run in parallel. Put deeper bounds or exhaustive runs
in a separately named scheduled or manual workflow if needed. Release preflight
reuses the exact-SHA CI result, or an unchanged earlier proof result when the
lane was skipped.

Use the template's unconditional `Verify proof obligations` step. It checks the
candidate SHA and tracked files before and after running a Bash script under
`scripts/` with fail-fast and pipeline failure handling. Keep verifier and
result checks together in that script so developers can run the same command
locally. A single proof job returns `verified_sha` directly.
When there are several jobs, make a final job depend on all of them and use
the default success condition. The job that reports `verified_sha` sets its
output to `github.sha`. Each proof job checks out the event candidate with the
pinned checkout action and `persist-credentials: false`. Use read-only
permissions and named setup steps.

Pin each verifier and verify downloaded binaries and JARs by digest. The
command must require the intended results before returning success.
For Kani, require the expected harnesses and explicit satisfaction
of required cover goals. For TLC, require the configured state-space
exploration to complete with its invariants and temporal properties satisfied.
For Tamarin, check that every required lemma was verified. Document the
production functions or models, assumptions, bounds, and feature profiles
covered by each proof. [Kani](https://model-checking.github.io/kani/) ·
[TLC](https://lamport.azurewebsites.net/tla/tools.html) ·
[Tamarin](https://tamarin-prover.com/manual/master/book/003_example.html)

## Publishing and version synchronization

Add a `release` object alongside `lanes` when the repository publishes
packages. Declare every shipped ecosystem and retain its tracked preflight and
publish workflows. A Cargo workspace can exist without a crates.io release.
Use `tagPrefix` for the repository's existing tag convention. A Swift repo's
Swift release owns the canonical tag. In a repo without Swift, the crates
release owns it if the repo publishes crates. Use `tagJob` to name the
canonical tag job in the owning publish workflow. It can also publish the
package. A workflow that creates a draft and finalizes it after a registry
publish can declare a downstream `finalizeJob`. Only those declared jobs
receive `contents: write` across the package workflows. Repos that release
only to npm or Maven can retain a separately
reviewed GitHub release workflow if they use one.

```json
{
  "tagPrefix": "v",
  "crates": {
    "preflight": "crates-package-preflight.yml",
    "publish": "crates-release.yml",
    "artifacts": ["crate-archives-{version}-{sha}", "crate-attestation-{version}-{sha}"]
  },
  "npm": {
    "preflight": "npm-package-preflight.yml",
    "publish": "npm-package-release.yml",
    "manifests": ["packages/ts/package.json"],
    "artifacts": ["npm-tarball-{version}-{sha}"]
  },
  "swift": {
    "preflight": "swift-package-preflight.yml",
    "publish": "swift-package-release.yml",
    "tagJob": "swift-release",
    "artifacts": ["swift-xcframework-{version}-{sha}"]
  },
  "maven": {
    "preflight": "kotlin-android-package-preflight.yml",
    "publish": "kotlin-android-package-release.yml",
    "manifests": ["packages/kotlin/build.gradle.kts", "packages/android/build.gradle.kts"],
    "artifacts": ["maven-publication-{version}-{sha}"]
  }
}
```

Use `otherReleases` alongside `lanes` for distinct release types that retain
their own workflow checks, such as GitHub binary promotion, a conformance
framework release, or an inherited upstream publisher. Each entry gives the
tracked `workflow` filename and its `reason`. This makes names such as
`release.yml` and `release-plz.yml` explicit during adoption. Tracked package
preflight and release workflows belong to the corresponding package channel.

Before expensive preparation, check out the exact source SHA and invoke the
pinned runner with the selected ecosystem, phase, version, and full tag.
Both workflows start with a dedicated, unconditional verification job
containing the `Verify release candidate` step. Every other job must depend
on it, directly or through another job. Preserve GitHub's default success
condition. Jobs may use ordinary conditions, such as an input that enables an
optional upload. Give the workflow read-only permissions and the verifier
`contents: read` and `actions: read`. Grant any additional scopes for
registry OIDC or attestations in the jobs that use them. Supply the command's
values through environment variables and its token as `GH_TOKEN`. Install the pinned Rust
toolchain first when the repository ships crates, because the checker reads
locked workspace metadata.

```sh
node .release-readiness/scripts/run-consumer-check.mjs --check-release swift preflight "$RELEASE_VERSION" "$RELEASE_TAG" "$SOURCE_SHA"
```

The check verifies every Cargo workspace member, declared npm package and
tracked adjacent npm lockfile, declared Gradle Kotlin version literal, and the
canonical tag. SwiftPM reads the version from the tag. A `packageVersion`
literal in `Package.swift` must also match. Cargo workspace members with
`publish = false` are skipped, and at least one member must be publishable.

Preflight requires a successful `Required CI` job from a qualifying run and
attempt for the exact SHA, and confirms that `main` contains the SHA. Qualifying
runs are pushes and manual dispatches on `main`, plus merge-queue runs when
`mergeQueue` is set.

A path-scoped lane that the run skipped was only shown to be unaffected by the
latest change. That is not evidence for the tree if an earlier commit left the
lane failing, was pushed without CI, or used `[skip ci]`. Each skipped lane must
therefore carry forward an earlier result. The check looks through the 100 most
recent successful CI runs on `main`, plus merge-queue runs when configured, for
an ancestor of the release SHA where that lane ran and passed. It then accepts
the lane only if none of its inputs changed since, using the same path rules as
the scope job, including the shared paths and the lane configuration. A
shallow release checkout works because the check fetches each compared
ancestor by SHA. The history search has a shared 45-second budget per preflight.
The release log names the run and commit used for each carried lane. If a lane
has no result within the search, dispatch CI on `main` while it points to the
selected SHA. The dispatch runs every lane. An unscoped lane always runs.

When an Android lane is configured, Maven preflight checks that the selected run
has a tested publication built from the release SHA before searching history.

Set each manually dispatched package preflight's run name to
`Preflight <ecosystem> <version> <full-source-sha>` using its dispatch inputs.
For a Swift workflow that receives `version` and `source_sha`:

```yaml
run-name: Preflight swift ${{ inputs.version }} ${{ inputs.source_sha }}
```

Set `id: candidate` on the preflight verification step. Add this upload step
after it in the same job. The runner writes the receipt with the selected CI
attempt and the earlier results reused for any skipped lanes.

```yaml
- name: Record verified CI
  uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9
  with:
    name: release-readiness-ci-${{ github.run_attempt }}-${{ steps.candidate.outputs.ci_run_id }}
    path: ${{ runner.temp }}/release-readiness-ci.json
    if-no-files-found: error
```

Keep the receipt available for the same release retry window as the prepared
package artifacts. The `artifacts` field names everything publish needs from
preflight. It accepts fixed names and the `{version}` and `{sha}` placeholders.
Upload the package bytes and any evidence the publisher needs to verify them.
For example, upload the tested npm tarball or the reviewed crate archives and
their attestation. Keep existing signature, manifest and package checks.

Add a release input summary to every crates.io, npm, Swift, and Maven preflight.
Generate it from the consumer checkout using the ecosystem name `crates`,
`npm`, `swift`, or `maven`. The renderer reads that ecosystem's publish workflow
from the repository's tracked configuration.

```sh
node .release-readiness/scripts/run-consumer-check.mjs --render-preflight-summary swift
```

Paste the generated step after the package or attestation upload in an
existing preflight job. Once the preflight succeeds, copy the `gh workflow run`
command from the Actions summary and run it to start the publish workflow with
both inputs filled in. Edit `version` or `source_sha` before running the command
to select another candidate that passed this ecosystem's preflight. The summary
also lists the values separately for the GitHub form. The step uses the existing
dispatch inputs and requires no additional checkout or job.

Use this dispatch input wording for every corresponding publish workflow.

```yaml
on:
  workflow_dispatch:
    inputs:
      version:
        description: Release version from the successful package preflight
        required: true
        type: string
      source_sha:
        description: Copy the full source SHA from this ecosystem's successful package preflight summary
        required: true
        type: string
```

Publish calls `--check-release swift publish` with the same version, tag and
SHA. It confirms the SHA is still on `main` and selects a successful
preflight with its CI receipt and every declared package artifact. Expose the
outputs from `id: candidate` in the verification job:

```yaml
outputs:
  preflight_run_id: ${{ steps.candidate.outputs.preflight_run_id }}
  package_artifact_ids: ${{ steps.candidate.outputs.package_artifact_ids }}
```

Each direct branch of publish starts with a job that downloads the selected
artifacts. Put the download before package-specific checks and any publishing
steps in that job. Later jobs can depend on that job and download the same
package again where they need local files. For a verifier named `verify`:

```yaml
- name: Download verified package
  uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333
  with:
    run-id: ${{ needs.verify.outputs.preflight_run_id }}
    artifact-ids: ${{ needs.verify.outputs.package_artifact_ids }}
    github-token: ${{ github.token }}
    digest-mismatch: error
    path: build/release
```

Grant the download job `actions: read`. Publish the downloaded bytes after the
repository's signature, manifest or other package checks pass. GitHub's
artifact digest covers the downloaded archive. Preserve any additional
package-level digest or attestation required by the registry or repository.

### Local Maven Central bundle

Every repository declaring a Maven release channel must track an executable
`./scripts/maven-central-bundle.local.sh`. This applies to JVM publications
and Android AARs. Start a new helper with the [bundle template](../templates/maven-central-bundle.local.sh).

Provide a tracked, executable
`scripts/stage-maven-central-bundle.sh VERSION SOURCE_SHA REPOSITORY_DIR`
when adopting the template. The staging script qualifies the exact version
and source SHA against successful Maven preflight evidence. It stages the
unsigned files in Maven repository layout in the absolute directory it
receives. It can use the same repository-specific verification and download
logic as the Maven publish workflow. Reuse the tested AAR and any JVM
publications already staged by preflight. For local JNI builds, honor
`ANDROID_NDK_HOME` or `ANDROID_NDK_VERSION` when supplied. Otherwise use the
SDK manager to resolve the latest stable NDK and report the selected revision.

Load the local GPG signing key ID and passphrase through
`MAVEN_SIGNING_KEY_ID` and `MAVEN_SIGNING_PASSWORD`, then run the bundle helper
with the preflight version and full source SHA.

```sh
./scripts/maven-central-bundle.local.sh "$RELEASE_VERSION" "$SOURCE_SHA"
```

The template signs in isolated staging, verifies every detached signature,
and writes checksums before assembling the ZIP. It keeps previous ZIPs and
uses a numbered filename for same-version reruns. It prints the completed
ZIP path for upload through Central Portal. An existing repository helper
can keep its own staging interface and should preserve these properties.
[Central Portal bundle format](https://central.sonatype.org/publish/publish-portal-upload/)

### Release sequence and retries

Dispatch every ecosystem's preflight in parallel while `main` points at the
release commit. Wait for all preflights to pass at the same version and SHA
before publishing to any registry.

After `main` advances, rerun a failed preflight from its original GitHub run.
GitHub preserves that run's SHA and ref and allows reruns for 30 days. A publish
retry verifies the selected ecosystem's retained preflight receipt for the same
version and SHA and uses the prepared artifacts from that preflight. [GitHub rerun behavior](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)

Keep Swift preflight in two steps. Build and verify the source FFI, then verify
the consumer against the packaged XCFramework. Publish the exact preflight
artifacts and preserve the release identity when retrying one ecosystem.
Artifact promotion, signing, registry receipts, and tag creation remain in
the repository's release workflows. [GitHub Actions workflow reuse](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) · [GitHub workflow jobs API](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt)
