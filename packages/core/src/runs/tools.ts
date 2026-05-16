import { z } from "zod";

import { readRunState, writeRunState } from "./persistence";
import { type TaskPlan, type TaskPlanTask, taskPlanSchema } from "./tasks";
import { runBlockerSchema, type RunBlocker } from "./lifecycle";
import type { RunState } from "../state/schema";

export const taskCompletionCheckResultSchema = z
  .object({
    name: z.string().min(1).optional(),
    command: z.string().min(1).optional(),
    status: z.literal("passed"),
    completed_at: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((check, context) => {
    if (check.name === undefined && check.command === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Completion check evidence must include a name or command.",
      });
    }
  });

export const taskCompletionEvidenceSchema = z
  .object({
    check_results: z.array(taskCompletionCheckResultSchema).min(1),
    changed_files: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const recordRunBlockerInputSchema = z
  .object({
    reason: z.string().min(1),
    next_step: z.string().min(1),
    kind: z.literal("scope_drift").optional(),
  })
  .strict();

export type TaskCompletionCheckResult = z.infer<typeof taskCompletionCheckResultSchema>;
export type TaskCompletionEvidence = z.infer<typeof taskCompletionEvidenceSchema>;
export type RecordRunBlockerInput = z.infer<typeof recordRunBlockerInputSchema>;

export type ClaimRunTaskOptions = {
  rootDir?: string;
  runId: string;
  plan: TaskPlan;
  taskId: string;
  ownerAgentId?: string;
  now?: Date;
};

export type CompleteRunTaskOptions = {
  rootDir?: string;
  runId: string;
  plan: TaskPlan;
  taskId: string;
  evidence: TaskCompletionEvidence;
  now?: Date;
};

export type RecordRunBlockerOptions = {
  rootDir?: string;
  runId: string;
  blocker: RecordRunBlockerInput;
  now?: Date;
};

export async function claimRunTask(options: ClaimRunTaskOptions): Promise<RunState> {
  const rootDir = options.rootDir ?? process.cwd();
  const plan = taskPlanSchema.parse(options.plan);
  const run = await readRunState(rootDir, options.runId);

  validateRunCanUsePlan(run, plan);
  rejectBlockedRun(run, "claim a task");
  rejectNonExecutionRun(run, "claim a task");

  const requestedTask = plan.tasks.find((task) => task.id === options.taskId);

  if (!requestedTask) {
    throw new Error(`Cannot claim task ${options.taskId}: task is not in plan ${plan.id}.`);
  }

  const claimedTask = run.claimed_tasks.find((task) => task.id === requestedTask.id);
  if (claimedTask?.completed_at) {
    throw new Error(`Cannot claim task ${requestedTask.id}: task is already complete.`);
  }

  if (claimedTask) {
    throw new Error(`Cannot claim task ${requestedTask.id}: task is already claimed.`);
  }

  const activeTask = run.claimed_tasks.find((task) => !task.completed_at);
  if (activeTask) {
    throw new Error(`Cannot claim task ${requestedTask.id}: task ${activeTask.id} is already claimed and not complete.`);
  }

  const expectedTask = findNextClaimableTask(run, plan);

  if (!expectedTask) {
    throw new Error(`Cannot claim task ${options.taskId}: all tasks in plan ${plan.id} are already complete.`);
  }

  if (expectedTask.id !== requestedTask.id) {
    throw new Error(`Cannot claim task ${requestedTask.id}: next sequential task is ${expectedTask.id}.`);
  }

  const nextRun: RunState = {
    ...run,
    current_plan: run.current_plan ?? plan.id,
    claimed_tasks: [
      ...run.claimed_tasks,
      {
        id: requestedTask.id,
        ...(options.ownerAgentId ? { owner_agent_id: options.ownerAgentId } : {}),
        started_at: (options.now ?? new Date()).toISOString(),
      },
    ],
  };

  await writeRunState(rootDir, nextRun);
  return nextRun;
}

export async function completeRunTask(options: CompleteRunTaskOptions): Promise<RunState> {
  const rootDir = options.rootDir ?? process.cwd();
  const plan = taskPlanSchema.parse(options.plan);
  const evidence = taskCompletionEvidenceSchema.parse(options.evidence);
  const run = await readRunState(rootDir, options.runId);

  validateRunCanUsePlan(run, plan);
  rejectBlockedRun(run, "complete a task");
  rejectNonExecutionRun(run, "complete a task");

  const task = requirePlanTask(plan, options.taskId);
  const claimedTask = run.claimed_tasks.find((candidate) => candidate.id === task.id);

  if (!claimedTask) {
    throw new Error(`Cannot complete task ${task.id}: task has not been claimed.`);
  }

  if (claimedTask.completed_at) {
    throw new Error(`Cannot complete task ${task.id}: task is already complete.`);
  }

  const activeTask = run.claimed_tasks.find((candidate) => !candidate.completed_at);
  if (activeTask?.id !== task.id) {
    throw new Error(`Cannot complete task ${task.id}: active claimed task is ${activeTask?.id ?? "none"}.`);
  }

  if (requiresChangedFileEvidence(task) && (evidence.changed_files?.length ?? 0) === 0) {
    throw new Error(`Cannot complete task ${task.id}: changed-file evidence is required for behavior or file-changing tasks.`);
  }

  validateCheckEvidenceMatchesTask(task, evidence.check_results);

  const completedAt = (options.now ?? new Date()).toISOString();
  const checkSummaries = evidence.check_results.map(formatCheckResult);
  const changedFiles = evidence.changed_files ?? [];
  const unplannedChangedFiles = changedFiles.filter((file) => !task.files.includes(file));

  if (unplannedChangedFiles.length > 0) {
    const nextRun = addScopeDriftBlocker(run, task, unplannedChangedFiles, options.now ?? new Date());
    await writeRunState(rootDir, nextRun);
    throw new Error(
      `Cannot complete task ${task.id}: changed-file evidence includes files outside the task plan: ${unplannedChangedFiles.join(", ")}.`,
    );
  }

  const nextRun: RunState = {
    ...run,
    claimed_tasks: run.claimed_tasks.map((candidate) =>
      candidate.id === task.id
        ? {
            ...candidate,
            completed_at: completedAt,
            completed_checks: checkSummaries,
            changed_files: changedFiles,
          }
        : candidate,
    ),
    completed_checks: mergeUnique(run.completed_checks, checkSummaries),
    changed_files: mergeUnique(run.changed_files, changedFiles),
  };

  await writeRunState(rootDir, nextRun);
  return nextRun;
}

export async function recordRunBlocker(options: RecordRunBlockerOptions): Promise<RunState> {
  const rootDir = options.rootDir ?? process.cwd();
  const blockerInput = recordRunBlockerInputSchema.parse(options.blocker);
  const run = await readRunState(rootDir, options.runId);

  if (run.current_stage === "complete") {
    throw new Error(`Cannot record blocker for run ${run.id}: run is already complete.`);
  }

  const reason = blockerInput.kind === "scope_drift" ? `Scope drift: ${blockerInput.reason}` : blockerInput.reason;
  const blocker = runBlockerSchema.parse({
    reason,
    next_step: blockerInput.next_step,
    at: (options.now ?? new Date()).toISOString(),
  });
  const nextRun: RunState = {
    ...run,
    blockers: [...run.blockers, blocker],
  };

  await writeRunState(rootDir, nextRun);
  return nextRun;
}

function validateRunCanUsePlan(run: RunState, plan: TaskPlan): void {
  if (run.current_phase !== plan.phase_id) {
    throw new Error(`Run ${run.id} is for phase ${run.current_phase}, not plan phase ${plan.phase_id}.`);
  }

  if (run.current_plan && run.current_plan !== plan.id) {
    throw new Error(`Run ${run.id} is using plan ${run.current_plan}, not plan ${plan.id}.`);
  }
}

function rejectBlockedRun(run: RunState, action: string): void {
  if (run.blockers.length > 0) {
    throw new Error(`Cannot ${action} for run ${run.id}: run has blockers that must be resolved first.`);
  }
}

function rejectNonExecutionRun(run: RunState, action: string): void {
  if (run.current_stage === "complete") {
    throw new Error(`Cannot ${action} for run ${run.id}: run is already complete.`);
  }

  if (run.current_stage !== "execution") {
    throw new Error(`Cannot ${action} for run ${run.id}: run stage is ${run.current_stage}; expected execution.`);
  }
}

function findNextClaimableTask(run: RunState, plan: TaskPlan): TaskPlanTask | null {
  for (const task of plan.tasks) {
    if (isTaskComplete(run, task.id)) {
      continue;
    }

    const unmetDependency = (task.dependencies ?? []).find((dependencyId) => !isTaskComplete(run, dependencyId));
    if (unmetDependency) {
      throw new Error(`Cannot claim task ${task.id}: dependency ${unmetDependency} is not complete.`);
    }

    return task;
  }

  return null;
}

function requirePlanTask(plan: TaskPlan, taskId: string): TaskPlanTask {
  const task = plan.tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    throw new Error(`Cannot complete task ${taskId}: task is not in plan ${plan.id}.`);
  }

  return task;
}

function isTaskComplete(run: RunState, taskId: string): boolean {
  return run.claimed_tasks.some((task) => task.id === taskId && Boolean(task.completed_at));
}

function requiresChangedFileEvidence(task: TaskPlanTask): boolean {
  return task.adds_behavior || task.files.length > 0;
}

function validateCheckEvidenceMatchesTask(task: TaskPlanTask, checkResults: readonly TaskCompletionCheckResult[]): void {
  for (const result of checkResults) {
    const matchesPlannedCheck = task.checks.some(
      (check) => (result.command && check.command === result.command) || (result.name && check.name === result.name),
    );

    if (!matchesPlannedCheck) {
      throw new Error(`Cannot complete task ${task.id}: check evidence ${formatCheckResult(result)} is not in the task plan.`);
    }
  }
}

function addScopeDriftBlocker(
  run: RunState,
  task: TaskPlanTask,
  unplannedChangedFiles: readonly string[],
  now: Date,
): RunState {
  const files = unplannedChangedFiles.join(", ");
  const blocker = runBlockerSchema.parse({
    reason: `Scope drift: Task ${task.id} changed files outside its planned scope: ${files}.`,
    next_step: `Stop task ${task.id}, review the unplanned files, and re-plan before completing the task.`,
    at: now.toISOString(),
  });

  return {
    ...run,
    blockers: [...run.blockers, blocker],
  };
}

function formatCheckResult(result: TaskCompletionCheckResult): string {
  return result.command ?? result.name ?? "unknown check";
}

function mergeUnique<T>(left: readonly T[], right: readonly T[]): T[] {
  return [...new Set([...left, ...right])];
}
