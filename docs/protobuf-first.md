# Protobuf-first release checks

Protocol Buffers are the authoritative definition for data exchanged across a
protobuf boundary. Changes to that contract start with the `.proto` schema.
Regenerate the bindings from the reviewed schema and keep externally specified
protocols on their required wire formats. The organization-wide guidance is in
[Engineering Philosophy](https://github.com/reallyme/.github/blob/main/ENGINEERING_PHILOSOPHY.md)
and [Architecture Standards](https://github.com/reallyme/.github/blob/main/ARCHITECTURE.md).

## Repository contract

Any archetype that opts in declares its shared schemas, a tracked contract
document, and a named CI verification step. Use `contracts/README.md` or the
tracked document that owns the boundary, such as an application contract's
README. Link both engineering references above in that document. Record the
boundary's schema ownership, supported transports, compatibility commitments,
and verification commands there. CI reads the tracked contract. A local,
ignored `AGENTS.md` may link to it for developer guidance.

The verification command runs Buf schema checks, checks compatibility
against the appropriate reviewed baseline, and verifies that regenerated output
matches the sources. It also runs the owning boundary's build or native
verification with generated request and response types. Use a schema-aware
ProtoJSON codec wherever the boundary accepts or returns JSON. Keep handwritten
wire DTOs and handwritten JSON codecs out of that path. Public convenience and
domain types may map to generated messages at the boundary.

For a published schema, run `buf breaking` against a reviewed baseline for the
last published contract. Keep that check required alongside generation and SDK
conformance. The verification step runs the repository's declared command, so
review that command and its inputs before adopting the policy.

```js
context.assertProtobufFirstPolicy({
  contractPath: "contracts/README.md",
  schemaPaths: ["crates/proto/proto/example/v1/operation.proto"],
  verification: {
    workflow: ".github/workflows/protobuf-ci.yml",
    job: "protobuf",
    step: "Check protobuf contract",
    run: "node scripts/check-protobuf-contract.mjs",
  },
});
```

The same configuration can be passed as `protobufRelease.protobufFirst` to
`assertReallyMeRustProtoRepositoryPolicy`, or as `protobufFirst` to
`assertReallyMeProtobufReleasePolicy`. The standalone check works for
repositories without SDKs and does not assume a particular generator, SDK
layout, or Rust operation envelope. The Rust protobuf preset retains its
separate generator and freshness checks.

## Cross-SDK error contract

| Failure | Contract |
| --- | --- |
| Shared operation | The same failure has the same protobuf error branch and reason across every shipped SDK, including Swift, TypeScript/WASM, and Kotlin/JNI where applicable. Map the reason into each SDK's existing public error type. |
| Local provider setup | Use an SDK-owned code when callers can diagnose the failure or recover differently. Swift's `symbolNotFound` points callers to the native library's exports. Use a generic provider failure when every caller has the same recovery path and the distinction adds no diagnostic value. |
| Shared provider setup | Define a protobuf reason when consumers across a shared boundary need to distinguish the failure. |
| Platform-specific codes | Keep codes unique within the owning SDK's public error surface. Include the SDK namespace when multiple SDKs write local codes to a shared diagnostic stream. |

The Swift crypto adapter preserves `symbolNotFound` for Swift callers and maps
it to the shared backend failure when it emits a portable error. See the
[Swift error adapter](https://github.com/reallyme/crypto/blob/HEAD/packages/swift/Sources/ReallyMeCryptoProtoAdapters/ProtoErrorAndJwkAdapters.swift).

When the repository ships SDKs, add `sdkConformance` to the policy. Declare
every shipped SDK lane and the tracked shared fixtures each lane consumes.

```js
sdkConformance: {
  sharedFixtures: ["conformance/operation-vectors.json"],
  lanes: [
    {
      sdk: "swift",
      workflow: ".github/workflows/sdk-conformance.yml",
      job: "swift",
      step: "Check Swift wire conformance",
      run: "./scripts/check-swift-wire.sh",
    },
    {
      sdk: "typescript-wasm",
      workflow: ".github/workflows/sdk-conformance.yml",
      job: "wasm",
      step: "Check WASM wire conformance",
      run: "npm run check:wire",
      workingDirectory: "packages/ts",
    },
    {
      sdk: "kotlin-jni",
      workflow: ".github/workflows/sdk-conformance.yml",
      job: "jni",
      step: "Check JNI wire conformance",
      run: "./gradlew checkWire",
    },
  ],
},
```

Each native command runs shared success and failure fixtures through the
SDK's public entry points and real bridge. Decode the bytes at the boundary
with generated bindings. Assert the expected result or protobuf error branch
and reason, then assert the public SDK error for failure cases. Exercise both
binary and ProtoJSON entry points where supported. Test local setup and code uniqueness in the SDK
that owns those codes. The [Codec WASM parity tests](https://github.com/reallyme/codec/blob/HEAD/packages/ts/test/proto-json-parity.test.mjs)
illustrate binary and ProtoJSON operation coverage and typed wire failures.

Include SDK-native compiler or lint checks in each command. Scope them to the
protobuf boundary and verify that request and response types and serializers use
the generated schema. This catches a handwritten wire DTO that happens to
produce the right bytes for the current fixtures.

Release-readiness checks the declared inputs, schema constraints, and exact
workflow steps. The declared jobs and steps run without `if` conditions and
propagate failures. Workflow change triggers must cover the declared schema,
contract, checker, and shared fixture files. Prefer unfiltered source-change
triggers so adapter and test changes also run conformance. Set
`workingDirectory` when the step runs outside the repository root, including
when it inherits run defaults. Native CI executes the commands
on their respective platforms. The shared checker cannot establish the
inventory of shipped SDKs, whether tests exercise the real bridge, or whether a
repository's lint rules cover all wire code. Review those against the contract.
