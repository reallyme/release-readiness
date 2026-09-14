#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ReallyMe LLC
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { createReleaseReadinessContext } from "./release-readiness/core.mjs";

const context = createReleaseReadinessContext({
  scriptUrl: import.meta.url,
  requireTrackedFiles: true,
});

const {
  assertContains,
  assertNotContains,
  assertReallyMeRustProtoRepositoryPolicy,
  fail,
} = context;

const generatedFreshnessMode = process.argv.includes("--generated-freshness");

// Replace every REPLACE_* value when installing this template. Keep
// repository-specific facts here instead of forking shared policy logic.
const repositoryPolicy = {
  generatedFreshnessMode,
  vendoredCore: {
    scriptPath: "scripts/check_release_readiness.mjs",
    corePath: "scripts/release-readiness/core.mjs",
    version: "0.6.2",
  },
  workflowActions: {},
  nodeWorkflows: {
    nodeVersion: "24",
  },
  cargoFuzz: {
    workflow: ".github/workflows/fuzz.yml",
    version: "0.13.2",
    minimumInstallations: 2,
    requiredInstallSteps: [
      { job: "immediate", name: "Install cargo-fuzz" },
      { job: "scheduled", name: "Install cargo-fuzz" },
    ],
  },
  cargoWorkspace: {
    requireWorkspaceLints: true,
    requirePublishInclude: true,
    validatePublishablePathDependencies: true,
  },
  // Opt in after mapping the repository against docs/repository-shapes.md.
  // repositoryShape: {
  //   archetype: "protocol-engine",
  //   requiredLanes: ["crates", "contracts", "conformance", "docs", "scripts", ".github"],
  //   optionalLanes: ["bindings", "gen", "vectors", "fuzz", "examples"],
  //   exceptions: [],
  //   crates: [
  //     { path: "crates/REPLACE_DOMAIN_CRATE", role: "domain" },
  //     { path: "crates/proto", role: "proto" },
  //     { path: "crates/proto-codec", role: "proto-codec" },
  //     // Optional: { path: "crates/REPLACE_FACADE_CRATE", role: "facade" },
  //   ],
  //   subLanes: {
  //     bindings: ["ffi", "jni", "wasm"],
  //     gen: ["swift", "kotlin", "java", "typescript"],
  //   },
  //   forbiddenPaths: [],
  //   requireReleaseReadiness: true,
  // },
  cargoMetadata: {
    reallyMeLatestStableDependencies: true,
  },
  rustSource: {
    // Govern every tracked Rust source file, including conformance, fuzz,
    // examples, bindings, and workspace crates.
    roots: ["."],
    generatedPrefixes: ["REPLACE_GENERATED_RUST_DIRECTORY"],
    // A repository may set targets below the 500-line hard ceiling and use a
    // tracked TSV for existing files between that target and the ceiling. Each
    // entry is path<TAB>line-count and may shrink, but may never grow.
    baselinePath: null,
    productionTargetLines: 500,
    productionHardLines: 500,
    testTargetLines: 800,
    testHardLines: 800,
    moduleHardLines: 100,
    forbidWildcardImports: true,
    forbidInlineTests: true,
    forbidSubstantiveFacades: true,
    forbidPanickingProductionCode: true,
    forbidDynamicErrorSurfaces: true,
  },
  // Enable each policy when the repository contains authored source in that
  // language. Generated bindings belong in generatedPrefixes, never roots-only
  // exceptions. One native command may cover multiple verification roles.
  // typescriptSource: {
  //   roots: ["packages/ts/src", "packages/ts/tests"],
  //   generatedPrefixes: ["gen/typescript"],
  //   tsconfigPaths: ["packages/ts/tsconfig.json"],
  //   staticAnalysis: {
  //     files: [
  //       {
  //         path: "eslint.config.mjs",
  //         required: [
  //           "@typescript-eslint/no-explicit-any",
  //           "@typescript-eslint/ban-ts-comment",
  //           "@typescript-eslint/consistent-type-assertions",
  //           "@typescript-eslint/no-non-null-assertion",
  //           "@typescript-eslint/only-throw-error",
  //         ],
  //       },
  //     ],
  //   },
  //   verification: [
  //     {
  //       roles: ["typecheck", "lint", "test"],
  //       command: "npm",
  //       args: ["run", "check"],
  //     },
  //   ],
  // },
  // swiftSource: {
  //   roots: ["packages/swift/Sources", "packages/swift/Tests"],
  //   generatedPrefixes: ["gen/swift"],
  //   facadeFiles: ["packages/swift/Sources/ReallyMeIdentity/Exports.swift"],
  //   configuration: {
  //     files: [
  //       {
  //         path: "Package.swift",
  //         required: ["StrictConcurrency", "warnings-as-errors"],
  //       },
  //     ],
  //   },
  //   verification: [
  //     {
  //       roles: ["format", "lint", "build", "test"],
  //       command: "scripts/check-swift.sh",
  //       args: [],
  //     },
  //   ],
  // },
  // kotlinSource: {
  //   roots: ["packages/kotlin/src"],
  //   generatedPrefixes: ["gen/kotlin", "gen/java"],
  //   facadeFiles: ["packages/kotlin/src/commonMain/kotlin/Identity.kt"],
  //   configuration: {
  //     files: [
  //       {
  //         path: "packages/kotlin/build.gradle.kts",
  //         required: ["explicitApi()", "allWarningsAsErrors = true"],
  //       },
  //     ],
  //   },
  //   verification: [
  //     {
  //       roles: ["format", "static-analysis", "compile", "test"],
  //       command: "./gradlew",
  //       args: ["check"],
  //       options: { cwd: "packages/kotlin" },
  //     },
  //   ],
  // },
  spdx: {
    extensions: [
      ".cjs",
      ".cts",
      ".js",
      ".jsx",
      ".kt",
      ".kts",
      ".mjs",
      ".mts",
      ".proto",
      ".py",
      ".rs",
      ".sh",
      ".swift",
      ".toml",
      ".ts",
      ".tsx",
      ".yaml",
      ".yml",
    ],
    exclusions: [
      { path: "REPLACE_GENERATED_RUST_DIRECTORY", reason: "generated" },
      { path: "REPLACE_GENERATED_TYPESCRIPT_DIRECTORY", reason: "generated" },
    ],
    requireExclusionsMatched: true,
    requireExclusionReasons: true,
  },
  protobufBoundary: {
    protoPath: "REPLACE_PROTO_PATH",
    operationRequest: "REPLACE_COMPONENTOperationRequest",
    operationResponse: "REPLACE_COMPONENTOperationResponse",
    protoReadme: "REPLACE_PROTO_README",
    protoCargo: "REPLACE_PROTO_CARGO",
    wirePath: "REPLACE_PROCESS_ADAPTER_PATH",
    codecPath: "REPLACE_PROTO_CODEC_PATH",
    // Leave true for service-capable schemas. Set false only for repositories
    // that intentionally publish messages and no protobuf service.
    allowServices: true,
    // Declare every public SDK transport adapter here. Each adapter must expose
    // both generated operation-response entrypoints. Use requiredNeedles and
    // forbiddenNeedles for lane-specific hardening invariants.
    sdkAdapters: [],
  },
  // Add granularProviderBoundary when the repository delegates selected
  // operations to a host provider. The shared checker then enforces exact
  // message surfaces, unique request/result parity, request/response
  // correlation, typed outcomes, service separation, and every declared adapter.
  // granularProviderBoundary: {
  //   protoPath: "REPLACE_PROVIDER_PROTO_PATH",
  //   codecPath: "REPLACE_PROVIDER_CODEC_PATH",
  //   runtimePath: "REPLACE_PROVIDER_RUNTIME_PATH",
  //   requiredCodecNeedles: [],
  //   requiredRuntimeNeedles: [],
  //   operations: [
  //     {
  //       fieldName: "REPLACE_OPERATION_FIELD",
  //       requestType: "REPLACE_REQUEST_MESSAGE",
  //       resultType: "REPLACE_RESULT_MESSAGE",
  //       number: 1,
  //     },
  //   ],
  //   adapters: [],
  //   retiredPaths: [],
  // },
  retiredPaths: [],
  protobufRelease: {
    workflow: ".github/workflows/protobuf-ci.yml",
    workflowMode: "delegated",
    installBufUses:
      "bufbuild/buf-setup-action@REPLACE_BUF_SETUP_ACTION_FULL_COMMIT_SHA",
    hardeningPolicy: {
      hardeningScript: "REPLACE_HARDENING_SCRIPT",
      protoSchema: "REPLACE_PROTO_SCHEMA",
      generatedRust: "REPLACE_GENERATED_RUST_FILE",
      generatedView: "REPLACE_GENERATED_VIEW_FILE",
      protoCargo: "REPLACE_PROTO_CARGO",
      requiredScriptNeedles: [
        '"--check-idempotent"',
        "deserialize_zeroizing_bytes",
        "zeroize_unknown_fields",
        "deny_unknown_fields",
      ],
      forbiddenScriptNeedles: [],
      requiredCargoNeedles: ['"buffa/json"', "zeroize"],
      // Every bytes/string field in the schema must appear exactly once.
      scalarFieldClassifications: [
        {
          message: "REPLACE_MESSAGE",
          field: "REPLACE_SECRET_BYTE_FIELD",
          kind: "bytes",
          sensitivity: "sensitive",
        },
      ],
      requiredGeneratedNeedles: [
        '.field("REPLACE_SECRET_BYTE_FIELD", &"<redacted>")',
        "::zeroize::Zeroize::zeroize(&mut self.REPLACE_SECRET_BYTE_FIELD);",
        "#[serde(default, deny_unknown_fields)]",
      ],
      forbiddenGeneratedNeedles: [
        '.field("REPLACE_SECRET_BYTE_FIELD", &self.REPLACE_SECRET_BYTE_FIELD)',
      ],
      requiredViewNeedles: [
        'formatter.write_str("REPLACE_REDACTED_OWNED_VIEW(<redacted>)")',
      ],
    },
    generatedFreshness: {
      generatedPaths: [
        "REPLACE_GENERATED_RUST_DIRECTORY",
        "REPLACE_GENERATED_TYPESCRIPT_DIRECTORY",
        "gen",
      ],
      commands: [
        ["buf", ["lint"]],
        ["buf", ["generate"]],
        ["node", ["REPLACE_HARDENING_SCRIPT"]],
        ["cargo", ["fmt", "--package", "REPLACE_PROTO_CRATE_NAME"]],
      ],
    },
  },
  text: {
    files: [
      {
        path: "REPLACE_ROOT_CARGO_TOML",
        required: ["overflow-checks = true"],
        forbidden: ["[patch.crates-io]"],
      },
    ],
  },
  workflows: [
    {
      path: ".github/workflows/protobuf-ci.yml",
      required: ["node scripts/check_release_readiness.mjs --generated-freshness"],
      forbidden: [],
      runSteps: [],
      usesSteps: [],
    },
  ],
};

const componentPolicy = {
  contractFile: "REPLACE_COMPONENT_CONTRACT_FILE",
  requiredInvariant: "REPLACE_COMPONENT_REQUIRED_INVARIANT",
  forbiddenInvariant: "REPLACE_COMPONENT_FORBIDDEN_INVARIANT",
};

const assertNoTemplateMarkers = (value, path = "repositoryPolicy") => {
  if (typeof value === "string") {
    if (value.includes("REPLACE_")) {
      fail(`${path} still contains an unresolved template marker`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertNoTemplateMarkers(entry, `${path}[${index}]`);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [name, entry] of Object.entries(value)) {
      assertNoTemplateMarkers(entry, `${path}.${name}`);
    }
  }
};

assertNoTemplateMarkers(repositoryPolicy);
assertNoTemplateMarkers(componentPolicy, "componentPolicy");
assertReallyMeRustProtoRepositoryPolicy(repositoryPolicy);

// Keep only product-specific semantics below this line. Shared release,
// workflow, Cargo, protobuf, ProtoJSON, hardening, and freshness invariants
// belong in the central core or the declarative policy above.
assertContains(componentPolicy.contractFile, componentPolicy.requiredInvariant);
assertNotContains(componentPolicy.contractFile, componentPolicy.forbiddenInvariant);
