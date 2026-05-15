import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  getNextAction,
  getStatus,
  initializePlanningState,
  writeJsonFile,
  type PhasesState,
  type RunState,
} from "../../src/index";

const temporaryDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "phasekit-status-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function phase(status: PhasesState["phases"][number]["status"] = "pending"): PhasesState["phases"][number] {
  return {
    id: "P1",
    source_requirement_ids: ["REQ-1"],
    expected_behavior: "The project has a status engine.",
    relevant_context: ["packages/core/src/status"],
    likely_change_areas: ["packages/core/src/status"],
    test_strategy: ["Run status tests."],
    integration_risks: [],
    done_criteria: ["Status reports next action."],
    status,
  };
}

function run(overrides: Partial<RunState> = {}): RunState {
  return {
    id: "run-1",
    current_phase: "P1",
    current_plan: "plan-1",
    current_stage: "planning",
    claimed_tasks: [],
    completed_checks: [],
    changed_files: [],
    commit_ids: [],
    blockers: [],
    ...overrides,
  };
}

async function writePhases(rootDir: string, phases: PhasesState["phases"]): Promise<void> {
  await writeJsonFile(join(rootDir, ".planning", "phases.json"), { phases });
}

async function writeRun(rootDir: string, state: RunState): Promise<void> {
  await writeJsonFile(join(rootDir, ".planning", "runs", `${state.id}.json`), state);
}

describe("status and next action", () => {
  test("reports a clean project without creating state", async () => {
    const rootDir = await createTempDirectory();

    const status = await getStatus({ rootDir });

    expect(status.state).toBe("clean");
    expect(status.project.initialized).toBe(false);
    expect(status.current_phase).toBeNull();
    expect(status.current_plan).toBeNull();
    expect(status.current_run).toBeNull();
    expect(status.blockers).toEqual([]);
    expect(status.next_action.kind).toBe("initialize_project");
    expect(status.agent).toMatchObject({
      state: "clean",
      next_action_kind: "initialize_project",
      current_phase_id: null,
      current_run_id: null,
      current_stage: null,
    });
  });

  test("rejects incomplete initialized state instead of reporting clean", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await unlink(join(rootDir, ".planning", "phases.json"));

    await expect(getStatus({ rootDir })).rejects.toThrow(
      "Incomplete Phasekit state: .planning/phases.json is missing.",
    );
  });

  test("reports an ingested project ready to start a run", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writePhases(rootDir, [phase("pending")]);

    const status = await getStatus({ rootDir });

    expect(status.state).toBe("ready");
    expect(status.current_phase?.id).toBe("P1");
    expect(status.current_phase?.status).toBe("pending");
    expect(status.next_action).toMatchObject({
      kind: "start_run",
      phase_id: "P1",
      run_id: null,
      current_stage: null,
      target_stage: null,
      allowed_next_stages: [],
    });
  });

  test("reports an active run and only the next allowed stage", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writePhases(rootDir, [phase("in_progress")]);
    await writeRun(rootDir, run({ current_stage: "planning" }));

    const status = await getStatus({ rootDir });

    expect(status.state).toBe("running");
    expect(status.current_plan).toEqual({ id: "plan-1" });
    expect(status.current_run).toMatchObject({
      id: "run-1",
      stage: "planning",
      state: "active",
    });
    expect(status.next_action).toMatchObject({
      kind: "advance_run_stage",
      run_id: "run-1",
      current_stage: "planning",
      target_stage: "execution",
      allowed_next_stages: ["execution"],
    });
  });

  test("does not skip required stages when computing next action", () => {
    const nextAction = getNextAction({
      currentRun: {
        id: "run-1",
        phase_id: "P1",
        plan: { id: "plan-1" },
        stage: "execution",
        state: "active",
        claimed_task_ids: [],
        changed_files: [],
        completed_checks: [],
      },
    });

    expect(nextAction.target_stage).toBe("review");
    expect(nextAction.allowed_next_stages).toEqual(["review"]);
  });

  test("reports a blocked run without advancing", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writePhases(rootDir, [phase("in_progress")]);
    await writeRun(
      rootDir,
      run({
        current_stage: "context",
        blockers: [
          {
            reason: "Need user decision on scope.",
            next_step: "Ask the user to choose the scope.",
          },
        ],
      }),
    );

    const status = await getStatus({ rootDir });

    expect(status.state).toBe("blocked");
    expect(status.blockers).toHaveLength(1);
    expect(status.next_action).toMatchObject({
      kind: "resolve_blocker",
      label: "Ask the user to choose the scope.",
      target_stage: null,
      allowed_next_stages: ["planning"],
    });
  });

  test("reports a failed task through explicit execution blockers", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writePhases(rootDir, [phase("in_progress")]);
    await writeRun(
      rootDir,
      run({
        current_stage: "execution",
        claimed_tasks: [{ id: "task-1", owner_agent_id: "executor-1" }],
        blockers: [
          {
            reason: "Task acceptance check failed.",
            next_step: "Repair task-1 and rerun its checks.",
          },
        ],
      }),
    );

    const status = await getStatus({ rootDir });

    expect(status.state).toBe("failed");
    expect(status.current_run?.state).toBe("failed_task");
    expect(status.next_action).toMatchObject({
      kind: "repair_task",
      label: "Repair task-1 and rerun its checks.",
      current_stage: "execution",
      target_stage: null,
      allowed_next_stages: ["review"],
    });
  });

  test("reports a completed phase", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writePhases(rootDir, [phase("complete")]);
    await writeRun(rootDir, run({ current_stage: "complete" }));

    const status = await getStatus({ rootDir });

    expect(status.state).toBe("complete");
    expect(status.current_phase?.status).toBe("complete");
    expect(status.current_run?.state).toBe("complete");
    expect(status.next_action.kind).toBe("no_action");
  });

  test("reports an interrupted run to resume before advancing", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writePhases(rootDir, [phase("in_progress")]);
    await writeRun(
      rootDir,
      run({
        current_stage: "execution",
        claimed_tasks: [{ id: "task-1", started_at: "2026-05-15T00:00:00.000Z" }],
        changed_files: ["packages/core/src/status/index.ts"],
      }),
    );

    const status = await getStatus({ rootDir });

    expect(status.state).toBe("interrupted");
    expect(status.current_run?.state).toBe("interrupted");
    expect(status.next_action).toMatchObject({
      kind: "resume_run",
      current_stage: "execution",
      target_stage: "execution",
      allowed_next_stages: ["review"],
    });
  });
});
