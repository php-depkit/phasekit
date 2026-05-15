import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ZodType } from "zod";

import { getAllowedNextRunStages } from "../runs/lifecycle";
import {
  defaultPhasesState,
  defaultProjectState,
  defaultRequirementsState,
} from "../state/defaults";
import { readJsonFile } from "../state/json";
import {
  phasesStateSchema,
  projectStateSchema,
  requirementsStateSchema,
  runStateSchema,
  type PhasesState,
  type ProjectState,
  type RequirementsState,
  type RunState,
} from "../state/schema";
import type { RunBlocker, RunStage } from "../runs/lifecycle";

export type StatusRunState = "active" | "blocked" | "failed_task" | "interrupted" | "complete";

export type StatusProject = {
  initialized: boolean;
  stack?: string;
};

export type StatusPhase = {
  id: string;
  status: "pending" | "in_progress" | "blocked" | "complete";
  expected_behavior: string;
};

export type StatusPlan = {
  id: string;
};

export type StatusRun = {
  id: string;
  phase_id: string;
  plan: StatusPlan | null;
  stage: RunStage;
  state: StatusRunState;
  claimed_task_ids: string[];
  changed_files: string[];
  completed_checks: string[];
};

export type NextActionKind =
  | "initialize_project"
  | "ingest_project"
  | "plan_phases"
  | "start_run"
  | "advance_run_stage"
  | "resume_run"
  | "resolve_blocker"
  | "repair_task"
  | "complete_phase"
  | "no_action";

export type NextAction = {
  kind: NextActionKind;
  label: string;
  reason: string;
  phase_id: string | null;
  run_id: string | null;
  current_stage: RunStage | null;
  target_stage: RunStage | null;
  allowed_next_stages: RunStage[];
};

export type PhasekitStatus = {
  state: "clean" | "ready" | "running" | "blocked" | "failed" | "interrupted" | "complete";
  project: StatusProject;
  current_phase: StatusPhase | null;
  current_plan: StatusPlan | null;
  current_run: StatusRun | null;
  blockers: RunBlocker[];
  next_action: NextAction;
  human: {
    summary: string;
  };
  agent: {
    state: PhasekitStatus["state"];
    next_action_kind: NextActionKind;
    current_phase_id: string | null;
    current_run_id: string | null;
    current_stage: RunStage | null;
  };
};

export type StatusStateInput = {
  initialized?: boolean;
  project?: ProjectState;
  requirements?: RequirementsState;
  phases?: PhasesState;
  runs?: RunState[];
};

export type GetStatusOptions = {
  rootDir?: string;
  runId?: string;
  state?: StatusStateInput;
};

async function readOptionalPlanningState(rootDir: string, runId?: string): Promise<StatusStateInput> {
  const planningDir = join(rootDir, ".planning");
  let project: ProjectState;

  try {
    project = await readJsonFile(join(planningDir, "project.json"), projectStateSchema);
  } catch (error) {
    if (isNotFoundError(error)) {
      return { initialized: false };
    }

    throw error;
  }

  const [requirements, phases, runs] = await Promise.all([
    readRequiredPlanningFile(planningDir, "requirements.json", requirementsStateSchema),
    readRequiredPlanningFile(planningDir, "phases.json", phasesStateSchema),
    readRuns(planningDir, runId),
  ]);

  return { initialized: true, project, requirements, phases, runs };
}

async function readRequiredPlanningFile<T>(planningDir: string, fileName: string, schema: ZodType<T>): Promise<T> {
  try {
    return await readJsonFile(join(planningDir, fileName), schema);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new Error(`Incomplete Phasekit state: .planning/${fileName} is missing.`);
    }

    throw error;
  }
}

async function readRuns(planningDir: string, runId?: string): Promise<RunState[]> {
  const runsDir = join(planningDir, "runs");

  if (runId) {
    try {
      return [await readJsonFile(join(runsDir, `${runId}.json`), runStateSchema)];
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new Error(`Run state not found: ${runId}`);
      }

      throw error;
    }
  }

  let fileNames: string[];

  try {
    fileNames = await readdir(runsDir);
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
      .map((fileName) => readJsonFile(join(runsDir, fileName), runStateSchema)),
  );
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export async function getStatus(options: GetStatusOptions = {}): Promise<PhasekitStatus> {
  const state = options.state ?? (await readOptionalPlanningState(options.rootDir ?? process.cwd(), options.runId));
  const normalizedState = normalizeStatusState(state);
  const selectedRun = selectRun(normalizedState.runs, options.runId);
  const currentPhase = selectCurrentPhase(normalizedState.phases, selectedRun);
  const currentRun = selectedRun ? toStatusRun(selectedRun) : null;
  const currentPlan = currentRun?.plan ?? null;
  const blockers = currentRun?.state === "complete" ? [] : selectedRun?.blockers ?? [];
  const nextAction = getNextAction({
    initialized: normalizedState.initialized,
    requirements: normalizedState.requirements,
    phases: normalizedState.phases,
    currentPhase,
    currentRun,
    blockers,
  });
  const statusState = getStatusState(normalizedState.initialized, currentRun, currentPhase, nextAction);

  return {
    state: statusState,
    project: {
      initialized: normalizedState.initialized,
      ...normalizedState.project,
    },
    current_phase: currentPhase,
    current_plan: currentPlan,
    current_run: currentRun,
    blockers,
    next_action: nextAction,
    human: {
      summary: summarizeStatus(statusState, currentPhase, currentRun, nextAction),
    },
    agent: {
      state: statusState,
      next_action_kind: nextAction.kind,
      current_phase_id: currentPhase?.id ?? null,
      current_run_id: currentRun?.id ?? null,
      current_stage: currentRun?.stage ?? null,
    },
  };
}

function normalizeStatusState(state: StatusStateInput): Required<StatusStateInput> {
  return {
    initialized: state.initialized ?? true,
    project: state.project ?? defaultProjectState,
    requirements: state.requirements ?? defaultRequirementsState,
    phases: state.phases ?? defaultPhasesState,
    runs: state.runs ?? [],
  };
}

function selectRun(runs: RunState[], runId?: string): RunState | null {
  if (runId) {
    return runs.find((run) => run.id === runId) ?? null;
  }

  return runs.find((run) => run.current_stage !== "complete") ?? runs.at(-1) ?? null;
}

function selectCurrentPhase(phases: PhasesState, run: RunState | null): StatusPhase | null {
  const phase = run
    ? phases.phases.find((candidate) => candidate.id === run.current_phase)
    : phases.phases.find((candidate) => candidate.status === "in_progress") ??
      phases.phases.find((candidate) => candidate.status === "blocked") ??
      phases.phases.find((candidate) => candidate.status === "pending") ??
      phases.phases.at(-1);

  if (!phase) {
    return null;
  }

  return {
    id: phase.id,
    status: phase.status,
    expected_behavior: phase.expected_behavior,
  };
}

function toStatusRun(run: RunState): StatusRun {
  return {
    id: run.id,
    phase_id: run.current_phase,
    plan: run.current_plan ? { id: run.current_plan } : null,
    stage: run.current_stage,
    state: classifyRun(run),
    claimed_task_ids: run.claimed_tasks.map((task) => task.id),
    changed_files: run.changed_files,
    completed_checks: run.completed_checks,
  };
}

function classifyRun(run: RunState): StatusRunState {
  if (run.current_stage === "complete") {
    return "complete";
  }

  if (run.blockers.length > 0 && run.current_stage === "execution" && run.claimed_tasks.length > 0) {
    return "failed_task";
  }

  if (run.blockers.length > 0) {
    return "blocked";
  }

  if (run.current_stage === "execution" && (run.claimed_tasks.length > 0 || run.changed_files.length > 0)) {
    return "interrupted";
  }

  return "active";
}

export function getNextAction(input: {
  initialized?: boolean;
  requirements?: RequirementsState;
  phases?: PhasesState;
  currentPhase?: StatusPhase | null;
  currentRun?: StatusRun | null;
  blockers?: RunBlocker[];
}): NextAction {
  const initialized = input.initialized ?? true;
  const requirements = input.requirements ?? defaultRequirementsState;
  const phases = input.phases ?? defaultPhasesState;
  const currentPhase = input.currentPhase ?? null;
  const currentRun = input.currentRun ?? null;
  const blockers = input.blockers ?? [];

  if (!initialized) {
    return action("initialize_project", "Initialize Phasekit state", "No canonical .planning state was found.");
  }

  if (currentRun && currentRun.state !== "complete") {
    if (currentRun.state === "failed_task") {
      return action(
        "repair_task",
        blockers[0]?.next_step ?? "Repair the failed task before continuing.",
        "The current execution task is blocked and must be repaired before advancing.",
        currentRun,
      );
    }

    if (currentRun.state === "blocked") {
      return action(
        "resolve_blocker",
        blockers[0]?.next_step ?? "Resolve the current blocker before continuing.",
        "The current run has explicit blockers.",
        currentRun,
      );
    }

    if (currentRun.state === "interrupted") {
      return action(
        "resume_run",
        `Resume run ${currentRun.id} at ${currentRun.stage}.`,
        "The run has explicit in-progress execution state and should resume before advancing.",
        currentRun,
        currentRun.stage,
      );
    }

    const allowedNextStages = [...getAllowedNextRunStages(currentRun.stage)];
    const targetStage = allowedNextStages[0] ?? null;

    if (!targetStage) {
      return action(
        "complete_phase",
        `Record phase ${currentRun.phase_id} completion.`,
        "The run is at its terminal stage; phase completion must be recorded explicitly.",
        currentRun,
      );
    }

    return action(
      "advance_run_stage",
      `Advance run ${currentRun.id} to ${targetStage}.`,
      "Only the next allowed run stage may be selected.",
      currentRun,
      targetStage,
      allowedNextStages,
    );
  }

  if (currentRun?.state === "complete" && currentPhase?.status !== "complete") {
    return action(
      "complete_phase",
      `Record phase ${currentRun.phase_id} completion.`,
      "The run is complete, but the phase has not been marked complete in canonical state.",
      currentRun,
    );
  }

  if (!currentPhase) {
    if (requirements.requirements.length > 0) {
      return action("plan_phases", "Create phases from ingested requirements.", "Requirements exist but no phase plan is recorded.");
    }

    return action("ingest_project", "Ingest product intent.", "No requirements or phases are recorded.");
  }

  if (currentPhase.status === "complete" && phases.phases.every((phase) => phase.status === "complete")) {
    return action(
      "no_action",
      "No next action is required.",
      "All recorded phases are complete.",
      null,
      null,
      [],
      currentPhase.id,
    );
  }

  if (currentPhase.status === "blocked") {
    return action(
      "resolve_blocker",
      `Resolve blockers for phase ${currentPhase.id}.`,
      "The current phase is explicitly blocked.",
      null,
      null,
      [],
      currentPhase.id,
    );
  }

  return action(
    "start_run",
    `Start a run for phase ${currentPhase.id}.`,
    "A phase is ready and no active run is recorded.",
    null,
    null,
    [],
    currentPhase.id,
  );
}

function action(
  kind: NextActionKind,
  label: string,
  reason: string,
  run: StatusRun | null = null,
  targetStage: RunStage | null = null,
  allowedNextStages: RunStage[] = run ? [...getAllowedNextRunStages(run.stage)] : [],
  phaseId: string | null = run?.phase_id ?? null,
): NextAction {
  return {
    kind,
    label,
    reason,
    phase_id: phaseId,
    run_id: run?.id ?? null,
    current_stage: run?.stage ?? null,
    target_stage: targetStage,
    allowed_next_stages: allowedNextStages,
  };
}

function getStatusState(
  initialized: boolean,
  currentRun: StatusRun | null,
  currentPhase: StatusPhase | null,
  nextAction: NextAction,
): PhasekitStatus["state"] {
  if (!initialized) {
    return "clean";
  }

  if (currentRun?.state === "failed_task") {
    return "failed";
  }

  if (currentRun?.state === "blocked" || currentPhase?.status === "blocked") {
    return "blocked";
  }

  if (currentRun?.state === "interrupted") {
    return "interrupted";
  }

  if (currentRun && currentRun.state !== "complete") {
    return "running";
  }

  if (nextAction.kind === "no_action") {
    return "complete";
  }

  return "ready";
}

function summarizeStatus(
  state: PhasekitStatus["state"],
  phase: StatusPhase | null,
  run: StatusRun | null,
  nextAction: NextAction,
): string {
  const phaseText = phase ? `phase ${phase.id}` : "no current phase";
  const runText = run ? `run ${run.id} at ${run.stage}` : "no active run";

  return `${state}: ${phaseText}, ${runText}. Next: ${nextAction.label}`;
}
