import { describe, expect, test } from "bun:test";

import { defaultConfig, parseStateFile, phasekitConfigSchema } from "../../src/index";

describe("config defaults", () => {
  test("match the approved PRD defaults", () => {
    expect(defaultConfig).toEqual({
      commit: {
        mode: "ask",
        planning_commits: false,
      },
      quality: {
        review: "always",
        verify: "always",
      },
      greenfield: {
        recommend_stack: true,
        ask_before_locking_stack: true,
      },
      models: {
        orchestrator: "anthropic/claude-sonnet-4.5",
        context_scout: "anthropic/claude-haiku-4.5",
        prd_ingestor: "anthropic/claude-sonnet-4.5",
        grill_me: "anthropic/claude-sonnet-4.5",
        planner: "anthropic/claude-opus-4.5",
        executor: "anthropic/claude-sonnet-4.5",
        reviewer: "anthropic/claude-sonnet-4.5",
        verifier: "anthropic/claude-opus-4.5",
      },
    });
  });

  test("validates config defaults", () => {
    expect(phasekitConfigSchema.parse(defaultConfig)).toEqual(defaultConfig);
  });

  test("surfaces actionable config errors", () => {
    expect(() => {
      parseStateFile("config.json", phasekitConfigSchema, {
        ...defaultConfig,
        commit: {
          ...defaultConfig.commit,
          mode: "later",
        },
      });
    }).toThrow(
      "Invalid config.json: commit.mode: Invalid enum value. Expected 'ask' | 'auto' | 'off', received 'later'",
    );
  });

  test("rejects unknown nested config keys with an actionable error", () => {
    expect(() => {
      parseStateFile("config.json", phasekitConfigSchema, {
        ...defaultConfig,
        commit: {
          ...defaultConfig.commit,
          planing_commits: false,
        },
      });
    }).toThrow("Invalid config.json: commit: Unrecognized key(s) in object: 'planing_commits'");
  });
});
