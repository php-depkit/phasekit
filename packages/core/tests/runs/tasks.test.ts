import { describe, expect, test } from "bun:test";

import {
  isBehaviorAddingTask,
  taskPlanSchema,
  validateTaskPlan,
  type TaskPlan,
  type TaskPlanValidatorOptions,
} from "../../src/index";

const validatorOptions: TaskPlanValidatorOptions = {
  source_requirement_ids: ["REQ-1", "REQ-2"],
  max_tasks: 3,
  max_scope_characters: 180,
  max_files_per_task: 3,
  max_checks_per_task: 2,
  max_dependencies_per_task: 2,
  min_scope_words: 8,
};

function task(overrides: Partial<TaskPlan["tasks"][number]> = {}): TaskPlan["tasks"][number] {
  return {
    id: "task-1",
    title: "Add task plan validator",
    source_requirement_ids: ["REQ-1", "REQ-2"],
    scope: "Add strict task plan validation in the core run module.",
    files: ["packages/core/src/runs/tasks.ts"],
    checks: [{ command: "bun test packages/core/tests/runs" }],
    adds_behavior: true,
    ...overrides,
  };
}

function plan(overrides: Partial<TaskPlan> = {}): TaskPlan {
  return {
    id: "plan-1",
    phase_id: "P6-T2",
    tasks: [task()],
    ...overrides,
  };
}

describe("task plan validation", () => {
  test("accepts a compact strict task plan", () => {
    expect(validateTaskPlan(plan(), validatorOptions)).toEqual(plan());
  });

  test("rejects unknown fields in the strict schema", () => {
    expect(() => taskPlanSchema.parse({ ...plan(), notes: "not allowed" })).toThrow();
    expect(() => taskPlanSchema.parse({ ...plan(), tasks: [{ ...task(), owner: "executor" }] })).toThrow();
  });

  test("rejects tasks with missing source requirement IDs", () => {
    expect(() => taskPlanSchema.parse(plan({ tasks: [task({ source_requirement_ids: [] })] }))).toThrow();
  });

  test("rejects tasks with unknown source requirement IDs", () => {
    expect(() => validateTaskPlan(plan({ tasks: [task({ source_requirement_ids: ["REQ-404"] })] }), validatorOptions)).toThrow(
      "Task task-1 source_requirement_ids references unknown requirement REQ-404.",
    );
  });

  test("rejects plans missing configured source requirement coverage", () => {
    expect(() => validateTaskPlan(plan({ tasks: [task({ source_requirement_ids: ["REQ-1"] })] }), validatorOptions)).toThrow(
      "Task plan missing coverage for source requirement REQ-2.",
    );
  });

  test("rejects tasks with missing checks", () => {
    expect(() => taskPlanSchema.parse(plan({ tasks: [task({ checks: [] })] }))).toThrow();
    expect(() => taskPlanSchema.parse(plan({ tasks: [task({ checks: [{}] })] }))).toThrow();
  });

  test("rejects duplicate task IDs", () => {
    expect(() =>
      validateTaskPlan(plan({ tasks: [task(), task({ id: "task-1", title: "Second copy" })] }), validatorOptions),
    ).toThrow("Duplicate task id task-1.");
  });

  test("rejects unknown, self, and duplicate dependencies", () => {
    expect(() => validateTaskPlan(plan({ tasks: [task({ dependencies: ["missing"] })] }), validatorOptions)).toThrow(
      "Task task-1 dependencies references unknown task missing.",
    );
    expect(() => validateTaskPlan(plan({ tasks: [task({ dependencies: ["task-1"] })] }), validatorOptions)).toThrow(
      "Task task-1 dependencies must not reference itself.",
    );
    expect(() =>
      validateTaskPlan(
        plan({ tasks: [task(), task({ id: "task-2", dependencies: ["task-1", "task-1"] })] }),
        validatorOptions,
      ),
    ).toThrow("Task task-2 dependencies contains duplicate task task-1.");
  });

  test("rejects dependency cycles", () => {
    expect(() =>
      validateTaskPlan(
        plan({
          tasks: [
            task({ id: "task-1", dependencies: ["task-2"] }),
            task({ id: "task-2", dependencies: ["task-1"] }),
          ],
        }),
        validatorOptions,
      ),
    ).toThrow("Task dependency cycle detected: task-1 -> task-2 -> task-1.");
  });

  test("rejects dependencies that point to later tasks in a sequential plan", () => {
    expect(() =>
      validateTaskPlan(
        plan({
          tasks: [
            task({ id: "task-1", source_requirement_ids: ["REQ-1"], dependencies: ["task-2"] }),
            task({ id: "task-2", source_requirement_ids: ["REQ-2"] }),
          ],
        }),
        validatorOptions,
      ),
    ).toThrow("Task task-1 dependencies references later task task-2; dependencies must appear before dependent tasks.");
  });

  test("rejects oversized task plans using local validator options", () => {
    const oversizedScope = "Add validation with many concrete implementation details.";

    expect(() =>
      validateTaskPlan(
        plan({ tasks: [task({ id: "task-1" }), task({ id: "task-2" }), task({ id: "task-3" }), task({ id: "task-4" })] }),
        validatorOptions,
      ),
    ).toThrow("Task plan plan-1 has 4 tasks; limit is 3.");

    expect(() =>
      validateTaskPlan(plan({ tasks: [task({ scope: oversizedScope })] }), {
        ...validatorOptions,
        max_scope_characters: 12,
      }),
    ).toThrow(`Task task-1 scope has ${oversizedScope.length} characters; limit is 12.`);
  });

  test("rejects ambiguous task scopes", () => {
    expect(() => validateTaskPlan(plan({ tasks: [task({ scope: "Fix stuff." })] }), validatorOptions)).toThrow(
      "Task task-1 scope is ambiguous; add concrete execution detail.",
    );
    expect(() =>
      validateTaskPlan(plan({ tasks: [task({ scope: "Implement everything as needed across the project files." })] }), validatorOptions),
    ).toThrow("Task task-1 scope is ambiguous; replace vague implementation language with concrete steps.");
  });

  test("identifies behavior-adding tasks for later verification policy", () => {
    expect(isBehaviorAddingTask(task({ adds_behavior: true }))).toBe(true);
    expect(isBehaviorAddingTask(task({ adds_behavior: false }))).toBe(false);
  });
});
