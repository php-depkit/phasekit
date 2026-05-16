import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import { readJsonFile, writeJsonFile } from "../state/json";
import {
  phasesStateSchema,
  runStateSchema,
  type PhasesState,
  type RunState,
} from "../state/schema";

export type CreateRunOptions = {
  rootDir?: string;
  phaseId: string;
  phases?: PhasesState;
  now?: Date;
};

export type CreateRunResult = {
  run: RunState;
  resumed: boolean;
  path: string;
};

export async function createPhaseRun(options: CreateRunOptions): Promise<CreateRunResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const planningDir = join(rootDir, ".planning");
  const phases = options.phases ?? (await readJsonFile(join(planningDir, "phases.json"), phasesStateSchema));
  validateTargetPhase(phases, options.phaseId);

  const existingRun = await findActiveRun(planningDir, options.phaseId);

  if (existingRun) {
    return {
      run: existingRun,
      resumed: true,
      path: runFilePath(planningDir, existingRun.id),
    };
  }

  const run: RunState = {
    id: runIdForPhase(options.phaseId),
    current_phase: options.phaseId,
    current_plan: null,
    current_stage: "created",
    started_at: (options.now ?? new Date()).toISOString(),
    claimed_tasks: [],
    completed_checks: [],
    changed_files: [],
    commit_ids: [],
    blockers: [],
  };
  const path = runFilePath(planningDir, run.id);

  await writeRunState(rootDir, run);

  return { run, resumed: false, path };
}

export async function writeRunState(rootDir: string, run: RunState): Promise<void> {
  const parsedRun = runStateSchema.parse(run);
  await writeJsonFile(runFilePath(join(rootDir, ".planning"), parsedRun.id), parsedRun);
}

export async function readRunState(rootDir: string, runId: string): Promise<RunState> {
  return readRunFile(join(rootDir, ".planning"), `${runId}.json`);
}

export function runIdForPhase(phaseId: string): string {
  return `phase-${encodeURIComponent(phaseId)}`;
}

function validateTargetPhase(phases: PhasesState, phaseId: string): void {
  const phase = phases.phases.find((candidate) => candidate.id === phaseId);

  if (!phase) {
    throw new Error(`Cannot create run: phase ${phaseId} was not found in .planning/phases.json.`);
  }

  if (phase.status === "complete") {
    throw new Error(`Cannot create run: phase ${phaseId} is already complete.`);
  }

  if (phase.status === "blocked") {
    throw new Error(`Cannot create run: phase ${phaseId} is blocked and must be resolved first.`);
  }
}

async function findActiveRun(planningDir: string, phaseId: string): Promise<RunState | null> {
  const runs = await readRunStates(planningDir);
  const activeRuns = runs.filter((run) => run.current_stage !== "complete");

  if (activeRuns.length > 1) {
    const runSummaries = activeRuns
      .map((run) => `${run.id} for phase ${run.current_phase}`)
      .sort()
      .join(", ");
    throw new Error(
      `Cannot create run: multiple active runs exist (${runSummaries}). Resolve ambiguous .planning/runs entries before continuing.`,
    );
  }

  const activeRun = activeRuns[0];

  if (!activeRun) {
    return null;
  }

  if (activeRun.current_phase !== phaseId) {
    throw new Error(
      `Cannot create run for phase ${phaseId}: active run ${activeRun.id} is already in progress for phase ${activeRun.current_phase}. Complete or resolve that run before starting another phase.`,
    );
  }

  return activeRun;
}

async function readRunStates(planningDir: string): Promise<RunState[]> {
  let fileNames: string[];

  try {
    fileNames = await readdir(join(planningDir, "runs"));
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }

    throw error;
  }

  return Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith(".json"))
      .sort()
      .map((fileName) => readRunFile(planningDir, fileName)),
  );
}

async function readRunFile(planningDir: string, fileName: string): Promise<RunState> {
  const expectedRunId = fileName.slice(0, -".json".length);
  const run = await readJsonFile(runFilePath(planningDir, expectedRunId), runStateSchema);

  if (run.id !== expectedRunId) {
    throw new Error(
      `Invalid run state ${expectedRunId}: file contains id ${JSON.stringify(
        run.id,
      )}; expected ${JSON.stringify(expectedRunId)}.`,
    );
  }

  return run;
}

function runFilePath(planningDir: string, runId: string): string {
  validateRunIdForPath(runId);
  return join(planningDir, "runs", `${runId}.json`);
}

function validateRunIdForPath(runId: string): void {
  const fileName = `${runId}.json`;

  if (!runId || fileName !== basename(fileName) || runId.includes("\\")) {
    throw new Error(
      `Unsafe run id ${JSON.stringify(runId)}. Run IDs must be file names stored directly under .planning/runs.`,
    );
  }
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
