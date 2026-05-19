import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";

import { loadPhasekitConfig } from "../config/loader";
import { evaluateCommitGate, type CommitChangeKind } from "../git/policy";
import { readJsonFile } from "../state/json";
import { phasesStateSchema, requirementsStateSchema, phaseSchema } from "../state/schema";
import { verificationResultSchema, type VerificationResult } from "../verify/schemas";
import { createPhaseRun, readRunState, writeRunState } from "./persistence";
import { taskPlanValidatorOptionsSchema, validateTaskPlan, type TaskPlan } from "./tasks";
import { advanceRunStage, claimRunTask, completeRunTask } from "./tools";

type Phase = typeof phaseSchema._type;

export type RunPhaseOrchestrationInput = {
  rootDir?: string;
  phaseId: string;
  plan?: unknown;
  executionEvidence?: {
    task_id: string;
    evidence: unknown;
  }[];
  planValidationOptions?: unknown;
  verificationResult?: unknown;
  verificationRequestId?: string;
  changeKind?: CommitChangeKind;
};

type ContextSnapshot = {
  sampled_paths: string[];
  likely_change_files: string[];
  nearby_tests: string[];
  nearby_config_neighbors: string[];
};

export type RunPhaseOrchestrationResult = {
  run_id: string;
  stage: string;
  phase: { id: string; source_requirement_ids: string[] };
  linked_requirements: { id: string; text: string }[];
  context_snapshot: ContextSnapshot;
  planning: {
    required: boolean;
    accepted_plan_id: string | null;
    validator_options: {
      source_requirement_ids: string[];
      max_tasks: number;
      max_scope_characters: number;
      max_files_per_task: number;
      max_checks_per_task: number;
      max_dependencies_per_task: number;
      min_scope_words: number;
    };
  };
  review_required: boolean;
  verification_required: boolean;
  commit_gate: ReturnType<typeof evaluateCommitGate> | null;
  next_required:
    | { kind: "execution_evidence"; pending_task_ids: string[] }
    | {
        kind: "review_verification_request";
        stage: "review" | "verification";
        request_id: string;
        run_id: string;
        phase_id: string;
        linked_requirement_ids: string[];
      }
    | null;
};

const defaultPlanValidationOptions = {
  max_tasks: 8,
  max_scope_characters: 500,
  max_files_per_task: 8,
  max_checks_per_task: 4,
  max_dependencies_per_task: 3,
  min_scope_words: 6,
} as const;

export async function orchestrateRunPhase(input: RunPhaseOrchestrationInput): Promise<RunPhaseOrchestrationResult> {
  const rootDir = input.rootDir ?? process.cwd();
  const planningDir = join(rootDir, ".planning");
  const [phasesState, requirementsState] = await Promise.all([
    readJsonFile(join(planningDir, "phases.json"), phasesStateSchema),
    readJsonFile(join(planningDir, "requirements.json"), requirementsStateSchema),
  ]);
  const phase = phasesState.phases.find((candidate) => candidate.id === input.phaseId);
  if (!phase) {
    throw new Error(`Cannot run phase ${input.phaseId}: phase was not found in .planning/phases.json.`);
  }

  const linkedRequirements = phase.source_requirement_ids.map((requirementId) => {
    const requirement = requirementsState.requirements.find((candidate) => candidate.id === requirementId);
    if (!requirement) {
      throw new Error(
        `Cannot run phase ${phase.id}: linked requirement ${requirementId} is missing from .planning/requirements.json.`,
      );
    }

    return { id: requirement.id, text: requirement.text };
  });

  const contextSnapshot = await gatherContextSnapshot(rootDir, phase);
  const { run } = await createPhaseRun({ rootDir, phaseId: input.phaseId });
  let currentRun = run;
  const startedStage = currentRun.current_stage;

  if (currentRun.current_stage === "created") {
    currentRun = await advanceRunStage({ rootDir, runId: currentRun.id, targetStage: "context" });
  }

  const validatorOptions = taskPlanValidatorOptionsSchema.parse({
    source_requirement_ids: phase.source_requirement_ids,
    ...defaultPlanValidationOptions,
    ...(input.planValidationOptions ?? {}),
  });

  let parsedPlan: TaskPlan | null = null;
  if (currentRun.current_stage === "context") {
    parsedPlan = validateTaskPlan(
      input.plan ?? createDefaultTaskPlan(phase, contextSnapshot, validatorOptions.max_checks_per_task),
      validatorOptions,
    );
    if (parsedPlan.phase_id !== phase.id) {
      throw new Error(`Task plan ${parsedPlan.id} targets phase ${parsedPlan.phase_id}, expected ${phase.id}.`);
    }

    currentRun = {
      ...currentRun,
      current_plan: parsedPlan.id,
    };
    await writeRunState(rootDir, currentRun);

    currentRun = await advanceRunStage({ rootDir, runId: currentRun.id, targetStage: "planning" });
    currentRun = await advanceRunStage({ rootDir, runId: currentRun.id, targetStage: "execution" });
  }

  const activePlan = parsedPlan ?? resolveActivePlan({
    phase,
    contextSnapshot,
    currentRunPlanId: currentRun.current_plan ?? undefined,
    providedPlan: input.plan,
    maxChecksPerTask: validatorOptions.max_checks_per_task,
  });

  if (currentRun.current_stage === "execution" && input.executionEvidence !== undefined) {
    const executionEvidence = input.executionEvidence;

    for (const taskCompletion of executionEvidence) {
      const hasClaimedTask = currentRun.claimed_tasks.some(
        (task) => task.id === taskCompletion.task_id && !task.completed_at,
      );
      if (!hasClaimedTask) {
        currentRun = await claimRunTask({
          rootDir,
          runId: currentRun.id,
          plan: activePlan,
          taskId: taskCompletion.task_id,
        });
      }

      currentRun = await completeRunTask({
        rootDir,
        runId: currentRun.id,
        plan: activePlan,
        taskId: taskCompletion.task_id,
        evidence: taskCompletion.evidence,
      });
    }

    const completedTaskIds = new Set(currentRun.claimed_tasks.filter((task) => Boolean(task.completed_at)).map((task) => task.id));
    const allTasksComplete = activePlan.tasks.length > 0 && activePlan.tasks.every((task) => completedTaskIds.has(task.id));

    if (allTasksComplete) {
      currentRun = await advanceRunStage({ rootDir, runId: currentRun.id, targetStage: "review" });
      currentRun = await ensureIssuedVerificationRequest(rootDir, currentRun);
    }
  }

  let parsedVerificationResult: VerificationResult | null = null;
  if (input.verificationResult !== undefined) {
    parsedVerificationResult = verificationResultSchema.parse(input.verificationResult) as VerificationResult;
  }

  if (startedStage !== "execution" && currentRun.current_stage === "review" && parsedVerificationResult !== null) {
    assertVerificationRequestMatchesRun({
      run: currentRun,
      requestId: input.verificationRequestId,
      phaseId: phase.id,
    });
    assertVerificationMatchesRun({
      verification: parsedVerificationResult,
      runId: currentRun.id,
      phaseId: phase.id,
      requirementIds: phase.source_requirement_ids,
    });
    if (parsedVerificationResult.review_status === "passed") {
      currentRun = await advanceRunStage({ rootDir, runId: currentRun.id, targetStage: "verification" });
      currentRun = await ensureIssuedVerificationRequest(rootDir, currentRun);
    }
  }

  let commitGate: ReturnType<typeof evaluateCommitGate> | null = null;
  if (startedStage === "verification" && currentRun.current_stage === "verification" && parsedVerificationResult !== null) {
    assertVerificationRequestMatchesRun({
      run: currentRun,
      requestId: input.verificationRequestId,
      phaseId: phase.id,
    });
    assertVerificationMatchesRun({
      verification: parsedVerificationResult,
      runId: currentRun.id,
      phaseId: phase.id,
      requirementIds: phase.source_requirement_ids,
    });
    const config = await loadPhasekitConfig({ projectRoot: rootDir });
    commitGate = evaluateCommitGate({
      config,
      changes: { kind: input.changeKind ?? "implementation" },
      verification_result: parsedVerificationResult,
    });

    if (commitGate.status === "allowed" || commitGate.status === "disabled") {
      currentRun = await advanceRunStage({ rootDir, runId: currentRun.id, targetStage: "complete" });
    }
  }

  const persisted = await readRunState(rootDir, currentRun.id);

  return {
    run_id: persisted.id,
    stage: persisted.current_stage,
    phase: { id: phase.id, source_requirement_ids: [...phase.source_requirement_ids] },
    linked_requirements: linkedRequirements,
    context_snapshot: contextSnapshot,
    planning: {
      required: false,
      accepted_plan_id: parsedPlan?.id ?? persisted.current_plan,
      validator_options: validatorOptions,
    },
    review_required: true,
    verification_required: true,
    commit_gate: commitGate,
    next_required: buildNextRequiredEvidence(persisted, activePlan, phase),
  };
}

function createDefaultTaskPlan(phase: Phase, context: ContextSnapshot, maxChecksPerTask: number): TaskPlan {
  const files = context.likely_change_files.length > 0
    ? context.likely_change_files
    : phase.likely_change_areas.length > 0
      ? phase.likely_change_areas
      : [phase.relevant_context[0] ?? "packages/core/src/index.ts"];
  const checks = [
    ...phase.test_strategy,
    ...context.nearby_tests.map((testPath) => `Review nearby test coverage in ${testPath}`),
    ...context.nearby_config_neighbors.map((configPath) => `Verify config/package neighbor in ${configPath}`),
  ]
    .slice(0, maxChecksPerTask)
    .map((strategy: string) =>
    /\b(bun|npm|pnpm|yarn|mise)\b/.test(strategy) ? { command: strategy } : { name: strategy },
    );

  return {
    id: `plan-${phase.id}-auto-v1`,
    phase_id: phase.id,
    tasks: files.map((file: string, index: number) => ({
      id: `task-${index + 1}`,
      title: `Implement ${phase.id} task ${index + 1}`,
      source_requirement_ids: [...phase.source_requirement_ids],
      scope: `Implement ${phase.id} behavior for ${file} with required checks and explicit sequential scope.`,
      files: [file],
      checks,
      dependencies: index > 0 ? [`task-${index}`] : undefined,
      adds_behavior: true,
    })),
  };
}

function resolveActivePlan(input: {
  phase: Phase;
  contextSnapshot: ContextSnapshot;
  currentRunPlanId: string | undefined;
  providedPlan: unknown;
  maxChecksPerTask: number;
}): TaskPlan {
  if (input.providedPlan !== undefined) {
    return input.providedPlan as TaskPlan;
  }

  const generatedPlan = createDefaultTaskPlan(input.phase, input.contextSnapshot, input.maxChecksPerTask);
  if (input.currentRunPlanId && input.currentRunPlanId !== generatedPlan.id) {
    throw new Error(`Run references plan ${input.currentRunPlanId}; phasekit_run_phase requires the matching plan payload to resume execution.`);
  }

  return generatedPlan;
}

function assertVerificationMatchesRun(input: {
  verification: VerificationResult;
  runId: string;
  phaseId: string;
  requirementIds: string[];
}): void {
  if (input.verification.id !== `verify-${input.runId}`) {
    throw new Error(`Verification result ${input.verification.id} is not bound to active run ${input.runId}.`);
  }

  if (input.verification.scope.kind !== "phase" || input.verification.scope.phase_id !== input.phaseId) {
    throw new Error(`Verification scope must target active phase ${input.phaseId}.`);
  }

  const expectedRequirementIds = [...input.requirementIds].sort();
  const actualRequirementIds = [...input.verification.linked_requirement_ids].sort();
  if (
    expectedRequirementIds.length !== actualRequirementIds.length ||
    expectedRequirementIds.some((requirementId, index) => requirementId !== actualRequirementIds[index])
  ) {
    throw new Error(`Verification linked requirements do not match active phase ${input.phaseId}.`);
  }
}

function buildNextRequiredEvidence(
  run: Awaited<ReturnType<typeof readRunState>>,
  plan: TaskPlan,
  phase: Phase,
): RunPhaseOrchestrationResult["next_required"] {
  if (run.current_stage === "execution") {
    const completed = new Set(run.claimed_tasks.filter((task) => task.completed_at).map((task) => task.id));
    const pendingPlanTaskIds = plan.tasks.filter((task) => !completed.has(task.id)).map((task) => task.id);
    const pendingClaimedTaskIds = run.claimed_tasks
      .filter((task) => !task.completed_at)
      .map((task) => task.id)
      .filter((taskId) => !pendingPlanTaskIds.includes(taskId));
    return {
      kind: "execution_evidence",
      pending_task_ids: [...pendingPlanTaskIds, ...pendingClaimedTaskIds],
    };
  }

  if (run.current_stage === "review" || run.current_stage === "verification") {
    const issuedRequest = getIssuedVerificationRequest(run);
    return {
      kind: "review_verification_request",
      stage: run.current_stage,
      request_id: issuedRequest?.request_id ?? createReviewVerificationRequestId(run, phase.id),
      run_id: run.id,
      phase_id: phase.id,
      linked_requirement_ids: [...phase.source_requirement_ids],
    };
  }

  return null;
}

async function gatherContextSnapshot(rootDir: string, phase: Phase): Promise<ContextSnapshot> {
  const candidates = new Set<string>([
    ...phase.relevant_context,
    ...phase.likely_change_areas,
    "package.json",
    "tsconfig.json",
    "mise.toml",
    "bunfig.toml",
    ".planning/config.json",
  ]);

  for (const path of phase.likely_change_areas) {
    for (const nearby of deriveNearbyTestAndConfigCandidates(path)) {
      candidates.add(nearby);
    }
  }

  const sampled: string[] = [];

  for (const candidate of [...candidates]) {
    const absolute = join(rootDir, candidate);
    try {
      const entries = await readdir(absolute);
      if (entries.length > 0) {
        sampled.push(relative(rootDir, absolute));
        sampled.push(relative(rootDir, join(absolute, entries[0]!)));
      }
    } catch {
      if (candidate.includes(".")) {
        try {
          await access(absolute, constants.R_OK);
          sampled.push(candidate);
        } catch {
          // best-effort only
        }
      }
    }
  }

  const sampledSet = new Set(sampled.sort());
  const likelyChangeFiles = phase.likely_change_areas.filter((path) => sampledSet.has(path));
  const nearbyCandidates = phase.likely_change_areas.flatMap((path) => deriveNearbyTestAndConfigCandidates(path));

  return {
    sampled_paths: [...sampledSet],
    likely_change_files: likelyChangeFiles,
    nearby_tests: nearbyCandidates.filter((path) => /\.(test|spec)\./.test(path) && sampledSet.has(path)).sort(),
    nearby_config_neighbors: nearbyCandidates.filter((path) => /(package\.json|tsconfig\.json|bunfig\.toml|mise\.toml)$/.test(path) && sampledSet.has(path)).sort(),
  };
}

async function ensureIssuedVerificationRequest(rootDir: string, run: Awaited<ReturnType<typeof readRunState>>): Promise<Awaited<ReturnType<typeof readRunState>>> {
  const existing = getIssuedVerificationRequest(run);
  if (existing) {
    return run;
  }

  if (run.current_stage !== "review" && run.current_stage !== "verification") {
    throw new Error(`Cannot issue review/verification request for run ${run.id} at stage ${run.current_stage}.`);
  }

  const stage = run.current_stage;

  const issuedRun = {
    ...run,
    issued_verification_request: {
      stage,
      request_id: createReviewVerificationRequestId(run, run.current_phase),
      issued_at: new Date().toISOString(),
    },
  };
  await writeRunState(rootDir, issuedRun);
  return issuedRun;
}

function assertVerificationRequestMatchesRun(input: {
  run: Awaited<ReturnType<typeof readRunState>>;
  requestId: string | undefined;
  phaseId: string;
}): void {
  const issuedRequest = getIssuedVerificationRequest(input.run);
  const expected = createReviewVerificationRequestId(input.run, input.phaseId);
  if (!issuedRequest || issuedRequest.request_id !== expected) {
    throw new Error(
      `Run ${input.run.id} phase ${input.phaseId} at ${input.run.current_stage} has no issued review/verification request. Call phasekit_run_phase again to receive the next required request.`,
    );
  }

  if (!input.requestId) {
    throw new Error(
      `Verification response for run ${input.run.id} phase ${input.phaseId} at ${input.run.current_stage} requires issued request id ${expected}.`,
    );
  }

  if (input.requestId !== expected) {
    throw new Error(`Verification request id ${input.requestId} does not match active run-bound request ${expected}.`);
  }
}

function createReviewVerificationRequestId(
  run: Pick<Awaited<ReturnType<typeof readRunState>>, "id" | "current_stage" | "last_successful_stage_transition" | "started_at">,
  phaseId: string,
): string {
  if (run.current_stage !== "review" && run.current_stage !== "verification") {
    throw new Error(`Cannot issue review/verification request for run ${run.id} at stage ${run.current_stage}.`);
  }

  const issuedSeed = run.last_successful_stage_transition?.at ?? run.started_at;
  return `review-verify-${run.current_stage}-${run.id}-${phaseId}-${encodeURIComponent(issuedSeed)}`;
}

function getIssuedVerificationRequest(run: Awaited<ReturnType<typeof readRunState>>) {
  if (
    run.issued_verification_request &&
    run.issued_verification_request.stage === run.current_stage &&
    (run.current_stage === "review" || run.current_stage === "verification")
  ) {
    return run.issued_verification_request;
  }

  return null;
}

function deriveNearbyTestAndConfigCandidates(path: string): string[] {
  const extension = extname(path);
  const stem = extension.length > 0 ? basename(path, extension) : basename(path);
  const directory = dirname(path);

  const nearby = [
    join(directory, `${stem}.test${extension || ".ts"}`),
    join(directory, `${stem}.spec${extension || ".ts"}`),
    join(directory, "package.json"),
  ];

  if (path.includes("/src/")) {
    const mirrored = path.replace("/src/", "/tests/");
    nearby.push(extension.length > 0 ? mirrored.replace(extension, `.test${extension}`) : `${mirrored}.test.ts`);
  }

  return nearby;
}
