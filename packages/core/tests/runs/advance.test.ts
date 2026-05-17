import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { advanceRunStage, initializePlanningState, writeJsonFile, type RunState } from "../../src";

const temporaryDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "phasekit-advance-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

function run(overrides: Partial<RunState> = {}): RunState {
  return {
    id: "phase-P11-T1",
    current_phase: "P11-T1",
    current_plan: "plan-1",
    current_stage: "execution",
    started_at: "2026-05-17T00:00:00.000Z",
    claimed_tasks: [],
    completed_checks: [],
    changed_files: [],
    commit_ids: [],
    blockers: [],
    ...overrides,
  };
}

describe("advance run stage", () => {
  test("advances only to the next allowed stage and persists transition evidence", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, ".planning", "runs", "phase-P11-T1.json"), run());

    const updated = await advanceRunStage({
      rootDir,
      runId: "phase-P11-T1",
      targetStage: "review",
      now: new Date("2026-05-17T00:01:00.000Z"),
    });

    expect(updated.current_stage).toBe("review");
    expect(updated.last_successful_stage_transition).toEqual({
      from: "execution",
      to: "review",
      at: "2026-05-17T00:01:00.000Z",
    });

    expect(await readFile(join(rootDir, ".planning", "runs", "phase-P11-T1.json"), "utf8")).toContain(
      '"last_successful_stage_transition"',
    );
  });

  test("rejects skipped transitions, including attempts to skip review or verification", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, ".planning", "runs", "phase-P11-T1.json"), run());

    await expect(
      advanceRunStage({ rootDir, runId: "phase-P11-T1", targetStage: "verification" }),
    ).rejects.toThrow('Invalid run stage transition from "execution" to "verification": expected next stage: review.');
  });

  test("rejects advancement while blockers remain", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(
      join(rootDir, ".planning", "runs", "phase-P11-T1.json"),
      run({ blockers: [{ reason: "Need user decision", next_step: "Ask user." }] }),
    );

    await expect(advanceRunStage({ rootDir, runId: "phase-P11-T1", targetStage: "review" })).rejects.toThrow(
      "Cannot advance run phase-P11-T1: resolve blockers before advancing stages.",
    );
  });
});
