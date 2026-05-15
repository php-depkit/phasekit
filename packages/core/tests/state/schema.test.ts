import { describe, expect, test } from "bun:test";

import {
  defaultPhasesState,
  defaultProjectState,
  defaultRequirementsState,
  defaultRulesState,
  parseStateFile,
  phasesStateSchema,
  projectStateSchema,
  requirementsStateSchema,
  rulesStateSchema,
  runStateSchema,
} from "../../src/index";

describe("state schemas", () => {
  test("provide canonical empty defaults", () => {
    expect(projectStateSchema.parse(defaultProjectState)).toEqual({});
    expect(requirementsStateSchema.parse(defaultRequirementsState)).toEqual({
      requirements: [],
    });
    expect(phasesStateSchema.parse(defaultPhasesState)).toEqual({ phases: [] });
    expect(rulesStateSchema.parse(defaultRulesState)).toEqual({ rules: [] });
  });

  test("stores the confirmed stack in project.json", () => {
    expect(projectStateSchema.parse({ stack: "Next.js + TypeScript + SQLite" })).toEqual({
      stack: "Next.js + TypeScript + SQLite",
    });
  });

  test("validates the canonical state files", () => {
    expect(
      requirementsStateSchema.parse({
        requirements: [
          {
            id: "REQ-1",
            text: "A user can ingest a PRD.",
            sources: [{ path: "docs/prd.md", locator: "line:12" }],
          },
        ],
      }),
    ).toEqual({
      requirements: [
        {
          id: "REQ-1",
          text: "A user can ingest a PRD.",
          sources: [{ path: "docs/prd.md", locator: "line:12" }],
        },
      ],
    });

    expect(
      phasesStateSchema.parse({
        phases: [
          {
            id: "1",
            source_requirement_ids: ["REQ-1"],
            expected_behavior: "The command ingests a PRD into requirement state.",
            relevant_context: ["packages/core/src/ingest"],
            likely_change_areas: ["packages/core/src/ingest", ".planning/requirements.json"],
            test_strategy: ["Run targeted ingest tests."],
            integration_risks: ["Requirement IDs must remain stable across re-ingest."],
            done_criteria: ["The requirement can be traced from source to phase."],
            status: "pending",
          },
        ],
      }),
    ).toEqual({
      phases: [
        {
          id: "1",
          source_requirement_ids: ["REQ-1"],
          expected_behavior: "The command ingests a PRD into requirement state.",
          relevant_context: ["packages/core/src/ingest"],
          likely_change_areas: ["packages/core/src/ingest", ".planning/requirements.json"],
          test_strategy: ["Run targeted ingest tests."],
          integration_risks: ["Requirement IDs must remain stable across re-ingest."],
          done_criteria: ["The requirement can be traced from source to phase."],
          status: "pending",
        },
      ],
    });

    expect(
      rulesStateSchema.parse({
        rules: [
          {
            id: "rule-1",
            category: "architecture",
            text: "Do not treat markdown as canonical state.",
          },
        ],
      }),
    ).toEqual({
      rules: [
        {
          id: "rule-1",
          category: "architecture",
          text: "Do not treat markdown as canonical state.",
        },
      ],
    });

    expect(
      runStateSchema.parse({
        id: "run-1",
        current_phase: "1",
        current_plan: "1.1",
        current_stage: "execution",
        claimed_tasks: [
          {
            id: "task-1",
            owner_agent_id: "executor-1",
            started_at: "2026-05-15T00:00:00.000Z",
          },
        ],
        completed_checks: ["bun test"],
        changed_files: ["packages/core/src/ingest/index.ts"],
        commit_ids: [],
        blockers: [
          {
            reason: "Need clarification on auth policy.",
            next_step: "Ask the user which auth policy applies.",
            at: "2026-05-15T00:01:00.000Z",
          },
        ],
        last_successful_stage_transition: {
          from: "planning",
          to: "execution",
          at: "2026-05-15T00:02:00.000Z",
        },
      }),
    ).toEqual({
      id: "run-1",
      current_phase: "1",
      current_plan: "1.1",
      current_stage: "execution",
      claimed_tasks: [
        {
          id: "task-1",
          owner_agent_id: "executor-1",
          started_at: "2026-05-15T00:00:00.000Z",
        },
      ],
      completed_checks: ["bun test"],
      changed_files: ["packages/core/src/ingest/index.ts"],
      commit_ids: [],
      blockers: [
        {
          reason: "Need clarification on auth policy.",
          next_step: "Ask the user which auth policy applies.",
          at: "2026-05-15T00:01:00.000Z",
        },
      ],
      last_successful_stage_transition: {
        from: "planning",
        to: "execution",
        at: "2026-05-15T00:02:00.000Z",
      },
    });
  });

  test("surfaces actionable state errors", () => {
    expect(() => {
      parseStateFile("requirements.json", requirementsStateSchema, {
        requirements: [
          {
            id: "REQ-1",
            text: "A user can ingest a PRD.",
            sources: [],
          },
        ],
      });
    }).toThrow(
      "Invalid requirements.json: requirements.0.sources: Array must contain at least 1 element(s)",
    );
  });
});
