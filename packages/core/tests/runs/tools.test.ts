import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  claimRunTask,
  completeRunTask,
  initializePlanningState,
  readRunState,
  recordRunBlocker,
  taskCompletionEvidenceSchema,
  writeJsonFile,
  type RunState,
  type TaskPlan,
} from "../../src/index";

const temporaryDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "phasekit-run-tools-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function plan(overrides: Partial<TaskPlan> = {}): TaskPlan {
  return {
    id: "plan-1",
    phase_id: "P6-T3",
    tasks: [
      {
        id: "task-1",
        title: "Add run tool tests",
        source_requirement_ids: ["REQ-1"],
        scope: "Add focused run tool tests for task lifecycle behavior.",
        files: ["packages/core/tests/runs/tools.test.ts"],
        checks: [{ command: "bun test packages/core/tests/runs" }],
        adds_behavior: true,
      },
      {
        id: "task-2",
        title: "Export run tools",
        source_requirement_ids: ["REQ-1"],
        scope: "Export the run lifecycle tools from the core package index.",
        files: ["packages/core/src/index.ts"],
        checks: [{ command: "bun run typecheck" }],
        dependencies: ["task-1"],
        adds_behavior: false,
      },
    ],
    ...overrides,
  };
}

function run(overrides: Partial<RunState> = {}): RunState {
  return {
    id: "run-1",
    current_phase: "P6-T3",
    current_plan: "plan-1",
    current_stage: "execution",
    started_at: "2026-05-16T00:00:00.000Z",
    claimed_tasks: [],
    completed_checks: [],
    changed_files: [],
    commit_ids: [],
    blockers: [],
    ...overrides,
  };
}

async function writeRun(rootDir: string, state: RunState = run()): Promise<void> {
  await writeJsonFile(join(rootDir, ".planning", "runs", `${state.id}.json`), state);
}

async function createRunFixture(state: RunState = run()): Promise<string> {
  const rootDir = await createTempDirectory();
  await initializePlanningState(rootDir);
  await writeRun(rootDir, state);
  return rootDir;
}

describe("run task tools", () => {
  test("claims tasks deterministically in plan order and persists run state", async () => {
    const rootDir = await createRunFixture();

    const claimed = await claimRunTask({
      rootDir,
      runId: "run-1",
      plan: plan(),
      taskId: "task-1",
      ownerAgentId: "executor-1",
      now: new Date("2026-05-16T00:01:00.000Z"),
    });

    expect(claimed.claimed_tasks).toEqual([
      {
        id: "task-1",
        owner_agent_id: "executor-1",
        started_at: "2026-05-16T00:01:00.000Z",
      },
    ]);
    await expect(readRunState(rootDir, "run-1")).resolves.toEqual(claimed);
  });

  test("rejects blocked runs, complete runs, unknown tasks, parallel claims, and out-of-order claims", async () => {
    const blockedRoot = await createRunFixture(
      run({ blockers: [{ reason: "Need a decision.", next_step: "Ask the user to decide." }] }),
    );
    await expect(claimRunTask({ rootDir: blockedRoot, runId: "run-1", plan: plan(), taskId: "task-1" })).rejects.toThrow(
      "Cannot claim a task for run run-1: run has blockers that must be resolved first.",
    );

    const completeRoot = await createRunFixture(run({ current_stage: "complete" }));
    await expect(claimRunTask({ rootDir: completeRoot, runId: "run-1", plan: plan(), taskId: "task-1" })).rejects.toThrow(
      "Cannot claim a task for run run-1: run is already complete.",
    );

    const unknownRoot = await createRunFixture();
    await expect(claimRunTask({ rootDir: unknownRoot, runId: "run-1", plan: plan(), taskId: "missing" })).rejects.toThrow(
      "Cannot claim task missing: task is not in plan plan-1.",
    );

    const parallelRoot = await createRunFixture(run({ claimed_tasks: [{ id: "task-1" }] }));
    await expect(claimRunTask({ rootDir: parallelRoot, runId: "run-1", plan: plan(), taskId: "task-1" })).rejects.toThrow(
      "Cannot claim task task-1: task is already claimed.",
    );

    const outOfOrderRoot = await createRunFixture();
    await expect(claimRunTask({ rootDir: outOfOrderRoot, runId: "run-1", plan: plan(), taskId: "task-2" })).rejects.toThrow(
      "Cannot claim task task-2: next sequential task is task-1.",
    );
  });

  test("rejects unmet dependencies and completed task claims", async () => {
    const unmetRoot = await createRunFixture();
    const dependencyFirstPlan = plan({
      tasks: [
        {
          ...plan().tasks[1]!,
          dependencies: ["task-1"],
        },
        plan().tasks[0]!,
      ],
    });

    await expect(
      claimRunTask({ rootDir: unmetRoot, runId: "run-1", plan: dependencyFirstPlan, taskId: "task-2" }),
    ).rejects.toThrow("Cannot claim task task-2: dependency task-1 is not complete.");

    const completedRoot = await createRunFixture(
      run({ claimed_tasks: [{ id: "task-1", completed_at: "2026-05-16T00:02:00.000Z" }] }),
    );
    await expect(claimRunTask({ rootDir: completedRoot, runId: "run-1", plan: plan(), taskId: "task-1" })).rejects.toThrow(
      "Cannot claim task task-1: task is already complete.",
    );
  });

  test("completes only the active claimed task with structured check and changed-file evidence", async () => {
    const rootDir = await createRunFixture(run({ claimed_tasks: [{ id: "task-1", owner_agent_id: "executor-1" }] }));

    const completed = await completeRunTask({
      rootDir,
      runId: "run-1",
      plan: plan(),
      taskId: "task-1",
      evidence: {
        check_results: [{ command: "bun test packages/core/tests/runs", status: "passed" }],
        changed_files: ["packages/core/tests/runs/tools.test.ts"],
      },
      now: new Date("2026-05-16T00:03:00.000Z"),
    });

    expect(completed.claimed_tasks[0]).toEqual({
      id: "task-1",
      owner_agent_id: "executor-1",
      completed_at: "2026-05-16T00:03:00.000Z",
      completed_checks: ["bun test packages/core/tests/runs"],
      changed_files: ["packages/core/tests/runs/tools.test.ts"],
    });
    expect(completed.completed_checks).toEqual(["bun test packages/core/tests/runs"]);
    expect(completed.changed_files).toEqual(["packages/core/tests/runs/tools.test.ts"]);
    await expect(readRunState(rootDir, "run-1")).resolves.toEqual(completed);
  });

  test("rejects completion with changed files outside the task plan and records a scope-drift blocker", async () => {
    const rootDir = await createRunFixture(run({ claimed_tasks: [{ id: "task-1", owner_agent_id: "executor-1" }] }));

    await expect(
      completeRunTask({
        rootDir,
        runId: "run-1",
        plan: plan(),
        taskId: "task-1",
        evidence: {
          check_results: [{ command: "bun test packages/core/tests/runs", status: "passed" }],
          changed_files: ["packages/core/tests/runs/tools.test.ts", "packages/core/src/index.ts"],
        },
        now: new Date("2026-05-16T00:05:00.000Z"),
      }),
    ).rejects.toThrow(
      "Cannot complete task task-1: changed-file evidence includes files outside the task plan: packages/core/src/index.ts.",
    );

    const blocked = await readRunState(rootDir, "run-1");
    expect(blocked.claimed_tasks[0]).toEqual({
      id: "task-1",
      owner_agent_id: "executor-1",
    });
    expect(blocked.completed_checks).toEqual([]);
    expect(blocked.changed_files).toEqual([]);
    expect(blocked.blockers).toEqual([
      {
        reason: "Scope drift: Task task-1 changed files outside its planned scope: packages/core/src/index.ts.",
        next_step: "Stop task task-1, review the unplanned files, and re-plan before completing the task.",
        at: "2026-05-16T00:05:00.000Z",
      },
    ]);
    await expect(claimRunTask({ rootDir, runId: "run-1", plan: plan(), taskId: "task-1" })).rejects.toThrow(
      "Cannot claim a task for run run-1: run has blockers that must be resolved first.",
    );
  });

  test("rejects completion for unclaimed, wrong active, unknown, and already completed tasks", async () => {
    const evidence = {
      check_results: [{ command: "bun test packages/core/tests/runs", status: "passed" as const }],
      changed_files: ["packages/core/tests/runs/tools.test.ts"],
    };

    const unclaimedRoot = await createRunFixture();
    await expect(completeRunTask({ rootDir: unclaimedRoot, runId: "run-1", plan: plan(), taskId: "task-1", evidence })).rejects.toThrow(
      "Cannot complete task task-1: task has not been claimed.",
    );

    const wrongActiveRoot = await createRunFixture(run({ claimed_tasks: [{ id: "task-2" }] }));
    await expect(completeRunTask({ rootDir: wrongActiveRoot, runId: "run-1", plan: plan(), taskId: "task-1", evidence })).rejects.toThrow(
      "Cannot complete task task-1: task has not been claimed.",
    );

    const unknownRoot = await createRunFixture();
    await expect(completeRunTask({ rootDir: unknownRoot, runId: "run-1", plan: plan(), taskId: "missing", evidence })).rejects.toThrow(
      "Cannot complete task missing: task is not in plan plan-1.",
    );

    const completedRoot = await createRunFixture(run({ claimed_tasks: [{ id: "task-1", completed_at: "2026-05-16T00:02:00.000Z" }] }));
    await expect(completeRunTask({ rootDir: completedRoot, runId: "run-1", plan: plan(), taskId: "task-1", evidence })).rejects.toThrow(
      "Cannot complete task task-1: task is already complete.",
    );
  });

  test("requires native structured evidence and rejects markdown summaries or file existence proof", async () => {
    expect(() => taskCompletionEvidenceSchema.parse({ markdown_summary: "Done." })).toThrow();
    expect(() => taskCompletionEvidenceSchema.parse({ check_results: [{ command: "bun test", status: "failed" }] })).toThrow();
    expect(() => taskCompletionEvidenceSchema.parse({ check_results: [{}], proof_files: ["RUN-SUMMARY.md"] })).toThrow();

    const rootDir = await createRunFixture(run({ claimed_tasks: [{ id: "task-1" }] }));
    await expect(
      completeRunTask({
        rootDir,
        runId: "run-1",
        plan: plan(),
        taskId: "task-1",
        evidence: { check_results: [{ command: "bun test packages/core/tests/runs", status: "passed" }] },
      }),
    ).rejects.toThrow("Cannot complete task task-1: changed-file evidence is required for behavior or file-changing tasks.");

    await expect(readRunState(rootDir, "run-1")).resolves.toMatchObject({
      blockers: [
        {
          reason: "Task task-1 is missing changed-file evidence required for behavior or file-changing tasks.",
          next_step:
            "Record changed-file evidence for task task-1 before completing it, or re-plan if the task no longer changes files.",
        },
      ],
    });

    const unplannedCheckRoot = await createRunFixture(run({ claimed_tasks: [{ id: "task-1" }] }));
    await expect(
      completeRunTask({
        rootDir: unplannedCheckRoot,
        runId: "run-1",
        plan: plan(),
        taskId: "task-1",
        evidence: {
          check_results: [{ command: "bun test packages/core/tests/other", status: "passed" }],
          changed_files: ["packages/core/tests/runs/tools.test.ts"],
        },
      }),
    ).rejects.toThrow(
      "Cannot complete task task-1: check evidence bun test packages/core/tests/other is not in the task plan.",
    );
    await expect(readRunState(unplannedCheckRoot, "run-1")).resolves.toMatchObject({
      blockers: [
        {
          reason: "Task task-1 submitted unplanned check evidence: bun test packages/core/tests/other.",
          next_step: "Stop task task-1, run only the checks in the task plan, or re-plan before completing the task.",
        },
      ],
    });
  });

  test("requires evidence for every planned check before completing a task", async () => {
    const rootDir = await createRunFixture(run({ claimed_tasks: [{ id: "task-1" }] }));
    const multiCheckPlan = plan({
      tasks: [
        {
          ...plan().tasks[0]!,
          checks: [{ command: "bun test packages/core/tests/runs" }, { command: "bun run typecheck" }],
        },
      ],
    });

    await expect(
      completeRunTask({
        rootDir,
        runId: "run-1",
        plan: multiCheckPlan,
        taskId: "task-1",
        evidence: {
          check_results: [{ command: "bun test packages/core/tests/runs", status: "passed" }],
          changed_files: ["packages/core/tests/runs/tools.test.ts"],
        },
        now: new Date("2026-05-16T00:06:00.000Z"),
      }),
    ).rejects.toThrow("Cannot complete task task-1: missing required check evidence for bun run typecheck.");

    const blocked = await readRunState(rootDir, "run-1");
    expect(blocked.claimed_tasks[0]).toEqual({ id: "task-1" });
    expect(blocked.blockers).toEqual([
      {
        reason: "Task task-1 is missing required check evidence for: bun run typecheck.",
        next_step: "Run and record passing evidence for every check in task task-1 before completing it.",
        at: "2026-05-16T00:06:00.000Z",
      },
    ]);
  });

  test("requires both check name and command to match when both are planned", async () => {
    const rootDir = await createRunFixture(run({ claimed_tasks: [{ id: "task-1" }] }));
    const namedCheckPlan = plan({
      tasks: [
        {
          ...plan().tasks[0]!,
          checks: [{ name: "run tests", command: "bun test packages/core/tests/runs" }],
        },
      ],
    });

    await expect(
      completeRunTask({
        rootDir,
        runId: "run-1",
        plan: namedCheckPlan,
        taskId: "task-1",
        evidence: {
          check_results: [{ name: "run tests", command: "bun run lint", status: "passed" }],
          changed_files: ["packages/core/tests/runs/tools.test.ts"],
        },
      }),
    ).rejects.toThrow("Cannot complete task task-1: check evidence bun run lint is not in the task plan.");
  });

  test("records actionable blockers, including scope drift, and stops progression", async () => {
    const rootDir = await createRunFixture();

    const blocked = await recordRunBlocker({
      rootDir,
      runId: "run-1",
      blocker: {
        kind: "scope_drift",
        reason: "Task requires generated artifacts from P6-T4.",
        next_step: "Stop and ask the orchestrator to re-plan the task scope.",
      },
      now: new Date("2026-05-16T00:04:00.000Z"),
    });

    expect(blocked.blockers).toEqual([
      {
        reason: "Scope drift: Task requires generated artifacts from P6-T4.",
        next_step: "Stop and ask the orchestrator to re-plan the task scope.",
        at: "2026-05-16T00:04:00.000Z",
      },
    ]);
    await expect(claimRunTask({ rootDir, runId: "run-1", plan: plan(), taskId: "task-1" })).rejects.toThrow(
      "Cannot claim a task for run run-1: run has blockers that must be resolved first.",
    );
  });
});
