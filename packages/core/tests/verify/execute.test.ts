import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { executeVerificationScope, initializePlanningState, readJsonFile, readRunState, verificationResultSchema, writeJsonFile } from "../../src/index";

const temporaryDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "phasekit-verify-exec-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("executeVerificationScope", () => {
  test("executes approved checks and persists verification result", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, ".planning", "config.json"), {
      verification: {
        commands: {
          test: { command: "bun test" },
        },
      },
    });
    await writeJsonFile(join(rootDir, "package.json"), {
      scripts: { test: "bun test" },
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [{ id: "P11-T3", source_requirement_ids: ["REQ-1"], expected_behavior: "Verify scoped checks for phase P11-T3.", relevant_context: ["a"], likely_change_areas: ["a"], test_strategy: ["x"], integration_risks: ["gate"], done_criteria: ["x"], status: "pending" }],
    });

    const result = await executeVerificationScope({
      rootDir,
      scope: { kind: "phase", phase_id: "P11-T3" },
      reviewStatus: "passed",
      commandExecutor: async () => ({ ok: true, summary: "ok" }),
    });

    expect(result.status).toBe("passed");
    expect(result.review_status).toBe("passed");
    expect(result.verification_status).toBe("passed");
    expect(result.command_evidence.length).toBeGreaterThan(0);
    expect(result.linked_requirement_ids).toEqual(["REQ-1"]);
    expect(result.integration_risks).toEqual([{ id: "risk-1", description: "gate", status: "covered" }]);
    const persisted = await readJsonFile(join(rootDir, ".planning", "verifications", "phase-P11-T3.json"), verificationResultSchema);
    expect(persisted).toMatchObject({ id: "verify-phase-P11-T3", scope: { kind: "phase", phase_id: "P11-T3" } });
  });

  test("approved missing-check IDs execute only approved discovered checks", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, "package.json"), {
      scripts: { "test:unit": "bun test" },
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [{ id: "P11-T3", source_requirement_ids: ["REQ-1"], expected_behavior: "Verify scoped checks for phase P11-T3.", relevant_context: ["a"], likely_change_areas: ["a"], test_strategy: ["x"], integration_risks: [], done_criteria: ["x"], status: "pending" }],
    });

    const result = await executeVerificationScope({
      rootDir,
      scope: { kind: "phase", phase_id: "P11-T3" },
      commandExecutor: async () => ({ ok: true, summary: "ok" }),
    });

    expect(result.status).toBe("blocked");
    expect(result.missing_check_proposals.length).toBeGreaterThan(0);
    expect(result.command_evidence[0]?.status).toBe("skipped");

    const approved = await executeVerificationScope({
      rootDir,
      scope: { kind: "phase", phase_id: "P11-T3" },
      approvedMissingCheckIds: result.missing_check_proposals.map((proposal) => proposal.id),
      reviewStatus: "passed",
      commandExecutor: async () => ({ ok: true, summary: "ok" }),
    });

    expect(approved.status).toBe("passed");
    expect(approved.missing_check_proposals).toEqual([]);
    expect(approved.command_evidence[0]?.status).toBe("passed");

    await writeJsonFile(join(rootDir, ".planning", "config.json"), {
      verification: {
        commands: {
          test: { command: "bun test" },
        },
      },
    });

    const configured = await executeVerificationScope({
      rootDir,
      scope: { kind: "phase", phase_id: "P11-T3" },
      reviewStatus: "passed",
      commandExecutor: async () => ({ ok: true, summary: "ok" }),
    });

    expect(configured.status).toBe("passed");
    expect(configured.missing_check_proposals).toEqual([]);
    expect(configured.command_evidence[0]?.status).toBe("passed");
  });

  test("failed verification reopens run execution with actionable focused repair tasks", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, "package.json"), {
      scripts: { test: "bun test" },
    });
    await writeJsonFile(join(rootDir, ".planning", "config.json"), {
      verification: {
        commands: {
          test: { command: "bun test" },
        },
      },
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [{ id: "P11-T3", source_requirement_ids: ["REQ-1"], expected_behavior: "Verify scoped checks for phase P11-T3.", relevant_context: ["a"], likely_change_areas: ["a"], test_strategy: ["x"], integration_risks: [], done_criteria: ["x"], status: "pending" }],
    });
    await writeJsonFile(join(rootDir, ".planning", "runs", "phase-P11-T3.json"), {
      id: "phase-P11-T3",
      current_phase: "P11-T3",
      current_plan: "plan-1",
      current_stage: "verification",
      started_at: "2026-05-18T00:00:00.000Z",
      claimed_tasks: [],
      completed_checks: [],
      changed_files: [],
      commit_ids: [],
      blockers: [],
    });

    const result = await executeVerificationScope({
      rootDir,
      scope: { kind: "phase", phase_id: "P11-T3" },
      reviewStatus: "passed",
      commandExecutor: async () => ({ ok: false, summary: "failed" }),
    });

    expect(result.status).toBe("failed");
    const run = await readRunState(rootDir, "phase-P11-T3");
    expect(run.current_stage).toBe("execution");
    expect(run.blockers).toEqual([]);
    expect(run.claimed_tasks[0]).toMatchObject({ id: "repair-P11-T3-test-1" });
  });

  test("executes approved checks for task, group, and all scopes", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, ".planning", "config.json"), {
      verification: {
        commands: {
          test: { command: "bun test" },
          lint: { command: "bun run lint" },
        },
      },
    });
    await writeJsonFile(join(rootDir, "package.json"), {
      scripts: { test: "bun test", lint: "bun test" },
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [
        { id: "P11-T3", source_requirement_ids: ["REQ-1"], expected_behavior: "Verify scoped checks for phase P11-T3.", relevant_context: ["a"], likely_change_areas: ["a"], test_strategy: ["x"], integration_risks: ["risk-a"], done_criteria: ["x"], status: "pending" },
        { id: "P11-T4", source_requirement_ids: ["REQ-2"], expected_behavior: "Verify scoped checks for phase P11-T4.", relevant_context: ["b"], likely_change_areas: ["b"], test_strategy: ["y"], integration_risks: ["risk-b"], done_criteria: ["y"], status: "pending" },
      ],
    });

    const task = await executeVerificationScope({
      rootDir,
      scope: { kind: "task", phase_id: "P11-T3", plan_id: "plan-1", task_id: "task-1" },
      reviewStatus: "passed",
      commandExecutor: async () => ({ ok: true, summary: "ok" }),
    });
    expect(task.status).toBe("passed");
    const group = await executeVerificationScope({
      rootDir,
      scope: { kind: "group", group_id: "release-1", phase_ids: ["P11-T3", "P11-T4"] },
      reviewStatus: "passed",
      commandExecutor: async () => ({ ok: true, summary: "ok" }),
    });
    expect(group.status).toBe("passed");
    const all = await executeVerificationScope({
      rootDir,
      scope: { kind: "all" },
      reviewStatus: "passed",
      commandExecutor: async () => ({ ok: true, summary: "ok" }),
    });
    expect(all.status).toBe("passed");
  });

  test("discovered package scripts are proposed but not executed without approval", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, "package.json"), {
      scripts: { test: "bun test" },
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [{ id: "P11-T3", source_requirement_ids: ["REQ-1"], expected_behavior: "Verify scoped checks for phase P11-T3.", relevant_context: ["a"], likely_change_areas: ["a"], test_strategy: ["x"], integration_risks: [], done_criteria: ["x"], status: "pending" }],
    });

    let executed = 0;
    const result = await executeVerificationScope({
      rootDir,
      scope: { kind: "phase", phase_id: "P11-T3" },
      commandExecutor: async () => {
        executed += 1;
        return { ok: true, summary: "ok" };
      },
    });

    expect(result.status).toBe("blocked");
    expect(executed).toBe(0);
    expect(result.missing_check_proposals[0]?.reason).toContain("not explicitly approved in verification config");
    expect(result.review_status).toBe("skipped");
  });
});
