import { z } from "zod";

export const taskPlanCheckSchema = z
  .object({
    name: z.string().min(1).optional(),
    command: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((check, context) => {
    if (check.name === undefined && check.command === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Task check must include a name or command.",
      });
    }
  });

export const taskPlanTaskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    source_requirement_ids: z.array(z.string().min(1)).min(1),
    scope: z.string().min(1),
    files: z.array(z.string().min(1)).min(1),
    checks: z.array(taskPlanCheckSchema).min(1),
    dependencies: z.array(z.string().min(1)).optional(),
    adds_behavior: z.boolean(),
  })
  .strict();

export const taskPlanSchema = z
  .object({
    id: z.string().min(1),
    phase_id: z.string().min(1),
    tasks: z.array(taskPlanTaskSchema).min(1),
  })
  .strict();

export const taskPlanValidatorOptionsSchema = z
  .object({
    source_requirement_ids: z.array(z.string().min(1)).min(1),
    max_tasks: z.number().int().positive(),
    max_scope_characters: z.number().int().positive(),
    max_files_per_task: z.number().int().positive(),
    max_checks_per_task: z.number().int().positive(),
    max_dependencies_per_task: z.number().int().nonnegative(),
    min_scope_words: z.number().int().positive(),
  })
  .strict();

export type TaskPlanCheck = z.infer<typeof taskPlanCheckSchema>;
export type TaskPlanTask = z.infer<typeof taskPlanTaskSchema>;
export type TaskPlan = z.infer<typeof taskPlanSchema>;
export type TaskPlanValidatorOptions = z.infer<typeof taskPlanValidatorOptionsSchema>;

export function validateTaskPlan(plan: unknown, options: TaskPlanValidatorOptions): TaskPlan {
  const parsedOptions = taskPlanValidatorOptionsSchema.parse(options);
  const parsedPlan = taskPlanSchema.parse(plan);

  validatePlanSize(parsedPlan, parsedOptions);
  validateTaskIds(parsedPlan.tasks);
  validateTaskRequirements(parsedPlan.tasks, parsedOptions.source_requirement_ids);
  validateTaskScopes(parsedPlan.tasks, parsedOptions);
  validateTaskDependencies(parsedPlan.tasks, parsedOptions);

  return parsedPlan;
}

export function isBehaviorAddingTask(task: TaskPlanTask): boolean {
  return task.adds_behavior;
}

function validatePlanSize(plan: TaskPlan, options: TaskPlanValidatorOptions): void {
  if (plan.tasks.length > options.max_tasks) {
    throw new Error(`Task plan ${plan.id} has ${plan.tasks.length} tasks; limit is ${options.max_tasks}.`);
  }
}

function validateTaskIds(tasks: readonly TaskPlanTask[]): void {
  const seen = new Set<string>();

  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new Error(`Duplicate task id ${task.id}.`);
    }
    seen.add(task.id);
  }
}

function validateTaskRequirements(tasks: readonly TaskPlanTask[], sourceRequirementIds: readonly string[]): void {
  const knownRequirementIds = new Set(sourceRequirementIds);
  const coveredRequirementIds = new Set<string>();

  for (const task of tasks) {
    for (const requirementId of task.source_requirement_ids) {
      if (!knownRequirementIds.has(requirementId)) {
        throw new Error(`Task ${task.id} source_requirement_ids references unknown requirement ${requirementId}.`);
      }

      coveredRequirementIds.add(requirementId);
    }
  }

  for (const requirementId of sourceRequirementIds) {
    if (!coveredRequirementIds.has(requirementId)) {
      throw new Error(`Task plan missing coverage for source requirement ${requirementId}.`);
    }
  }
}

function validateTaskScopes(tasks: readonly TaskPlanTask[], options: TaskPlanValidatorOptions): void {
  for (const task of tasks) {
    if (task.scope.length > options.max_scope_characters) {
      throw new Error(
        `Task ${task.id} scope has ${task.scope.length} characters; limit is ${options.max_scope_characters}.`,
      );
    }

    if (task.files.length > options.max_files_per_task) {
      throw new Error(`Task ${task.id} files has ${task.files.length} entries; limit is ${options.max_files_per_task}.`);
    }

    if (task.checks.length > options.max_checks_per_task) {
      throw new Error(`Task ${task.id} checks has ${task.checks.length} entries; limit is ${options.max_checks_per_task}.`);
    }

    if (countWords(task.scope) < options.min_scope_words) {
      throw new Error(`Task ${task.id} scope is ambiguous; add concrete execution detail.`);
    }

    if (hasAmbiguousScope(task.scope)) {
      throw new Error(`Task ${task.id} scope is ambiguous; replace vague implementation language with concrete steps.`);
    }
  }
}

function validateTaskDependencies(tasks: readonly TaskPlanTask[], options: TaskPlanValidatorOptions): void {
  const taskIds = new Set(tasks.map((task) => task.id));

  for (const task of tasks) {
    const dependencies = task.dependencies ?? [];

    if (dependencies.length > options.max_dependencies_per_task) {
      throw new Error(
        `Task ${task.id} dependencies has ${dependencies.length} entries; limit is ${options.max_dependencies_per_task}.`,
      );
    }

    const seenDependencies = new Set<string>();
    for (const dependency of dependencies) {
      if (!taskIds.has(dependency)) {
        throw new Error(`Task ${task.id} dependencies references unknown task ${dependency}.`);
      }

      if (dependency === task.id) {
        throw new Error(`Task ${task.id} dependencies must not reference itself.`);
      }

      if (seenDependencies.has(dependency)) {
        throw new Error(`Task ${task.id} dependencies contains duplicate task ${dependency}.`);
      }

      seenDependencies.add(dependency);
    }
  }

  rejectDependencyCycles(tasks);
}

function rejectDependencyCycles(tasks: readonly TaskPlanTask[]): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  for (const task of tasks) {
    visitTask(task, tasksById, visiting, visited, []);
  }
}

function visitTask(
  task: TaskPlanTask,
  tasksById: ReadonlyMap<string, TaskPlanTask>,
  visiting: Set<string>,
  visited: Set<string>,
  path: readonly string[],
): void {
  if (visited.has(task.id)) {
    return;
  }

  if (visiting.has(task.id)) {
    throw new Error(`Task dependency cycle detected: ${[...path, task.id].join(" -> ")}.`);
  }

  visiting.add(task.id);
  for (const dependencyId of task.dependencies ?? []) {
    const dependency = tasksById.get(dependencyId);
    if (dependency) {
      visitTask(dependency, tasksById, visiting, visited, [...path, task.id]);
    }
  }
  visiting.delete(task.id);
  visited.add(task.id);
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function hasAmbiguousScope(scope: string): boolean {
  return /\b(do it|implement everything|fix stuff|make it work|handle things|various|etc\.?|as needed)\b/i.test(scope);
}
