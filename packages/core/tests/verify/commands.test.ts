import { describe, expect, test } from "bun:test";

import {
  defaultConfig,
  discoverVerificationCommands,
  parseStateFile,
  phasekitConfigSchema,
} from "../../src/index";

describe("verification command discovery", () => {
  test("discovers supported package scripts in deterministic order", () => {
    expect(
      discoverVerificationCommands({
        packageMetadata: [
          {
            packageManager: "bun",
            scripts: {
              lint: "tsc -p tsconfig.json --noEmit --pretty false",
              test: "bun test",
              build: "tsc -p tsconfig.json",
              typecheck: "tsc -p tsconfig.json --noEmit",
            },
          },
        ],
      }),
    ).toEqual([
      {
        kind: "test",
        command: "bun run test",
        source: "discovered",
        requires_confirmation: false,
        confirmation_reasons: [],
      },
      {
        kind: "typecheck",
        command: "bun run typecheck",
        source: "discovered",
        requires_confirmation: false,
        confirmation_reasons: [],
      },
      {
        kind: "lint",
        command: "bun run lint",
        source: "discovered",
        requires_confirmation: false,
        confirmation_reasons: [],
      },
      {
        kind: "build",
        command: "bun run build",
        source: "discovered",
        requires_confirmation: false,
        confirmation_reasons: [],
      },
    ]);
  });

  test("configured commands override discovered commands", () => {
    expect(
      discoverVerificationCommands({
        config: {
          commands: {
            test: {
              command: "bun test packages/core/tests/verify",
            },
          },
        },
        packageMetadata: [
          {
            packageManager: "bun",
            scripts: {
              test: "bun test",
              typecheck: "tsc -p tsconfig.json --noEmit",
            },
          },
        ],
      }),
    ).toEqual([
      {
        kind: "test",
        command: "bun test packages/core/tests/verify",
        source: "configured",
        requires_confirmation: false,
        confirmation_reasons: [],
      },
      {
        kind: "typecheck",
        command: "bun run typecheck",
        source: "discovered",
        requires_confirmation: false,
        confirmation_reasons: [],
      },
    ]);
  });

  test("requires confirmation for ambiguous discovered commands", () => {
    expect(
      discoverVerificationCommands({
        packageMetadata: [
          {
            packageManager: "bun",
            scripts: {
              "test:integration": "bun test tests/integration",
              "test:unit": "bun test tests/unit",
            },
          },
        ],
      }),
    ).toEqual([
      {
        kind: "test",
        command: "bun run test:integration",
        source: "discovered",
        requires_confirmation: true,
        confirmation_reasons: ["discovered command is ambiguous"],
      },
    ]);
  });

  test("requires confirmation for unsafe discovered commands", () => {
    expect(
      discoverVerificationCommands({
        packageMetadata: [
          {
            packageManager: "bun",
            scripts: {
              lint: "eslint . && rm -rf generated",
            },
          },
        ],
      }),
    ).toEqual([
      {
        kind: "lint",
        command: "bun run lint",
        source: "discovered",
        requires_confirmation: true,
        confirmation_reasons: [
          "discovered package script contains shell control syntax",
          "discovered package script appears to mutate files",
        ],
      },
    ]);
  });

  test("requires confirmation for mutating discovered commands", () => {
    expect(
      discoverVerificationCommands({
        packageMetadata: [
          {
            packageManager: "bun",
            scripts: {
              lint: "eslint . --fix",
              build: "rm dist",
            },
          },
        ],
      }),
    ).toEqual([
      {
        kind: "lint",
        command: "bun run lint",
        source: "discovered",
        requires_confirmation: true,
        confirmation_reasons: ["discovered package script appears to mutate files"],
      },
      {
        kind: "build",
        command: "bun run build",
        source: "discovered",
        requires_confirmation: true,
        confirmation_reasons: ["discovered package script appears to mutate files"],
      },
    ]);
  });

  test("discovers deterministically across package metadata order", () => {
    const firstOrder = discoverVerificationCommands({
      packageMetadata: [
        {
          packageManager: "npm",
          scripts: {
            test: "vitest run",
          },
        },
        {
          packageManager: "bun",
          scripts: {
            test: "bun test",
          },
        },
      ],
    });
    const reversedOrder = discoverVerificationCommands({
      packageMetadata: [
        {
          packageManager: "bun",
          scripts: {
            test: "bun test",
          },
        },
        {
          packageManager: "npm",
          scripts: {
            test: "vitest run",
          },
        },
      ],
    });

    expect(firstOrder).toEqual(reversedOrder);
    expect(firstOrder).toEqual([
      {
        kind: "test",
        command: "bun run test",
        source: "discovered",
        requires_confirmation: true,
        confirmation_reasons: ["discovered command is ambiguous"],
      },
    ]);
  });

  test("requires confirmation when emitted command text contains shell control syntax", () => {
    expect(
      discoverVerificationCommands({
        packageMetadata: [
          {
            packageManager: "bun",
            scripts: {
              "test:unit;rm": "bun test tests/unit",
            },
          },
        ],
      }),
    ).toEqual([
      {
        kind: "test",
        command: "bun run test:unit;rm",
        source: "discovered",
        requires_confirmation: true,
        confirmation_reasons: [
          "discovered command is ambiguous",
          "discovered command contains shell control syntax",
        ],
      },
    ]);
  });

  test("treats package metadata as static command text", () => {
    expect(
      discoverVerificationCommands({
        packageMetadata: [
          {
            packageManager: "bun",
            scripts: {
              test: "node -e 'throw new Error(should-not-run)'",
            },
          },
        ],
      }),
    ).toEqual([
      {
        kind: "test",
        command: "bun run test",
        source: "discovered",
        requires_confirmation: false,
        confirmation_reasons: [],
      },
    ]);
  });

  test("keeps default quality review and verify behavior strict", () => {
    expect(defaultConfig.quality).toEqual({
      review: "always",
      verify: "always",
    });
  });

  test("rejects invalid verification config without falling back", () => {
    expect(() => {
      parseStateFile("config.json", phasekitConfigSchema, {
        ...defaultConfig,
        verification: {
          commands: {
            test: {
              command: "",
            },
          },
        },
      });
    }).toThrow("Invalid config.json: verification.commands.test.command: String must contain at least 1 character(s)");
  });
});
