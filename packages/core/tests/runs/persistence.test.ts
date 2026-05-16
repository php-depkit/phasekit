import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  createPhaseRun,
  initializePlanningState,
  readRunState,
  runIdForPhase,
  writeJsonFile,
  writeRunState,
  type PhasesState,
  type RunState,
} from "../../src/index";

const temporaryDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "phasekit-runs-"));
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
    id: "P6-T1",
    source_requirement_ids: ["REQ-1"],
    expected_behavior: "Runs are persisted and resumable.",
    relevant_context: ["packages/core/src/runs"],
    likely_change_areas: ["packages/core/src/runs"],
    test_strategy: ["Run run persistence tests."],
    integration_risks: [],
    done_criteria: ["A run can be resumed after interruption."],
    status,
  };
}

async function writePhases(rootDir: string, phases: PhasesState["phases"]): Promise<void> {
  await writeJsonFile(join(rootDir, ".planning", "phases.json"), { phases });
}

function run(overrides: Partial<RunState> = {}): RunState {
  return {
    id: "phase-P6-T1",
    current_phase: "P6-T1",
    current_plan: null,
    current_stage: "created",
    started_at: "2026-05-16T00:00:00.000Z",
    claimed_tasks: [],
    completed_checks: [],
    changed_files: [],
    commit_ids: [],
    blockers: [],
    ...overrides,
  };
}

describe("run persistence", () => {
  test("creates and persists a deterministic run for a valid phase", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writePhases(rootDir, [phase("pending")]);

    const result = await createPhaseRun({
      rootDir,
      phaseId: "P6-T1",
      now: new Date("2026-05-16T00:00:00.000Z"),
    });

    expect(result).toEqual({
      resumed: false,
      path: join(rootDir, ".planning", "runs", "phase-P6-T1.json"),
      run: {
        id: "phase-P6-T1",
        current_phase: "P6-T1",
        current_plan: null,
        current_stage: "created",
        started_at: "2026-05-16T00:00:00.000Z",
        claimed_tasks: [],
        completed_checks: [],
        changed_files: [],
        commit_ids: [],
        blockers: [],
      },
    });
    await expect(readRunState(rootDir, result.run.id)).resolves.toEqual(result.run);
    expect(await readFile(result.path, "utf8")).toBe(`{
  "blockers": [],
  "changed_files": [],
  "claimed_tasks": [],
  "commit_ids": [],
  "completed_checks": [],
  "current_phase": "P6-T1",
  "current_plan": null,
  "current_stage": "created",
  "id": "phase-P6-T1",
  "started_at": "2026-05-16T00:00:00.000Z"
}
`);
  });

  test("resumes an existing active run for the same phase", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writePhases(rootDir, [phase("in_progress")]);
    const existingRun: RunState = {
      id: "phase-P6-T1",
      current_phase: "P6-T1",
      current_plan: "plan-1",
      current_stage: "execution",
      started_at: "2026-05-16T00:00:00.000Z",
      claimed_tasks: [{ id: "task-1", owner_agent_id: "executor-1" }],
      completed_checks: ["bun test packages/core/tests/runs"],
      changed_files: ["packages/core/src/runs/persistence.ts"],
      commit_ids: ["abc123"],
      blockers: [],
      last_successful_stage_transition: {
        from: "planning",
        to: "execution",
        at: "2026-05-16T00:01:00.000Z",
      },
    };
    await writeJsonFile(join(rootDir, ".planning", "runs", `${existingRun.id}.json`), existingRun);

    const result = await createPhaseRun({
      rootDir,
      phaseId: "P6-T1",
      now: new Date("2026-05-17T00:00:00.000Z"),
    });

    expect(result.resumed).toBe(true);
    expect(result.run).toEqual(existingRun);
  });

  test("rejects duplicate active runs for the same phase", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writePhases(rootDir, [phase("in_progress")]);
    await writeJsonFile(join(rootDir, ".planning", "runs", "phase-P6-T1-a.json"), run({ id: "phase-P6-T1-a" }));
    await writeJsonFile(join(rootDir, ".planning", "runs", "phase-P6-T1-b.json"), run({ id: "phase-P6-T1-b" }));

    await expect(createPhaseRun({ rootDir, phaseId: "P6-T1" })).rejects.toThrow(
      "Cannot create run: multiple active runs exist (phase-P6-T1-a for phase P6-T1, phase-P6-T1-b for phase P6-T1). Resolve ambiguous .planning/runs entries before continuing.",
    );
  });

  test("rejects creating a run when another phase has an active run", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writePhases(rootDir, [phase("pending"), { ...phase("in_progress"), id: "P6-T2" }]);
    await writeJsonFile(
      join(rootDir, ".planning", "runs", "phase-P6-T2.json"),
      run({ id: "phase-P6-T2", current_phase: "P6-T2" }),
    );

    await expect(createPhaseRun({ rootDir, phaseId: "P6-T1" })).rejects.toThrow(
      "Cannot create run for phase P6-T1: active run phase-P6-T2 is already in progress for phase P6-T2. Complete or resolve that run before starting another phase.",
    );
  });

  test("rejects multiple active runs across phases as ambiguous", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writePhases(rootDir, [phase("in_progress"), { ...phase("in_progress"), id: "P6-T2" }]);
    await writeJsonFile(join(rootDir, ".planning", "runs", "phase-P6-T1.json"), run());
    await writeJsonFile(
      join(rootDir, ".planning", "runs", "phase-P6-T2.json"),
      run({ id: "phase-P6-T2", current_phase: "P6-T2" }),
    );

    await expect(createPhaseRun({ rootDir, phaseId: "P6-T1" })).rejects.toThrow(
      "Cannot create run: multiple active runs exist (phase-P6-T1 for phase P6-T1, phase-P6-T2 for phase P6-T2). Resolve ambiguous .planning/runs entries before continuing.",
    );
  });

  test("rejects unsafe run IDs when writing run state", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);

    await expect(writeRunState(rootDir, run({ id: "../escape" }))).rejects.toThrow(
      'Unsafe run id "../escape". Run IDs must be file names stored directly under .planning/runs.',
    );
    await expect(writeRunState(rootDir, run({ id: "nested/escape" }))).rejects.toThrow(
      'Unsafe run id "nested/escape". Run IDs must be file names stored directly under .planning/runs.',
    );
  });

  test("rejects unsafe run IDs when reading run state", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);

    await expect(readRunState(rootDir, "../escape")).rejects.toThrow(
      'Unsafe run id "../escape". Run IDs must be file names stored directly under .planning/runs.',
    );
    await expect(readRunState(rootDir, "nested/escape")).rejects.toThrow(
      'Unsafe run id "nested/escape". Run IDs must be file names stored directly under .planning/runs.',
    );
  });

  test("rejects run files whose internal id does not match the file name", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, ".planning", "runs", "safe.json"), run({ id: "other" }));

    await expect(readRunState(rootDir, "safe")).rejects.toThrow(
      'Invalid run state safe: file contains id "other"; expected "safe".',
    );
  });

  test("rejects missing, complete, and blocked target phases", async () => {
    await expect(createPhaseRun({ phaseId: "missing", phases: { phases: [] } })).rejects.toThrow(
      "Cannot create run: phase missing was not found in .planning/phases.json.",
    );
    await expect(createPhaseRun({ phaseId: "P6-T1", phases: { phases: [phase("complete")] } })).rejects.toThrow(
      "Cannot create run: phase P6-T1 is already complete.",
    );
    await expect(createPhaseRun({ phaseId: "P6-T1", phases: { phases: [phase("blocked")] } })).rejects.toThrow(
      "Cannot create run: phase P6-T1 is blocked and must be resolved first.",
    );
  });

  test("encodes phase IDs before using them in run file names", () => {
    expect(runIdForPhase("feature/auth reset")).toBe("phase-feature%2Fauth%20reset");
  });
});
