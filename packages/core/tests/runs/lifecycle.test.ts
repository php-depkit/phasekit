import { describe, expect, test } from "bun:test";

import {
  getAllowedNextRunStages,
  runBlockerSchema,
  runStageTransitionSchema,
  runStageSchema,
  runStages,
  validateRunStageTransition,
} from "../../src/index";

describe("run lifecycle", () => {
  test("defines the approved sequential run stages", () => {
    expect(runStages).toEqual([
      "created",
      "context",
      "planning",
      "execution",
      "review",
      "verification",
      "complete",
    ]);
  });

  test("accepts adjacent stage transitions", () => {
    expect(validateRunStageTransition({ from: "created", to: "context" })).toEqual({
      from: "created",
      to: "context",
    });
    expect(validateRunStageTransition({ from: "context", to: "planning" })).toEqual({
      from: "context",
      to: "planning",
    });
    expect(validateRunStageTransition({ from: "planning", to: "execution" })).toEqual({
      from: "planning",
      to: "execution",
    });
    expect(validateRunStageTransition({ from: "execution", to: "review" })).toEqual({
      from: "execution",
      to: "review",
    });
    expect(validateRunStageTransition({ from: "review", to: "verification" })).toEqual({
      from: "review",
      to: "verification",
    });
    expect(validateRunStageTransition({ from: "verification", to: "complete" })).toEqual({
      from: "verification",
      to: "complete",
    });
  });

  test("rejects skipped stages with the expected next stage", () => {
    expect(() => validateRunStageTransition({ from: "planning", to: "review" })).toThrow(
      'Invalid run stage transition from "planning" to "review": expected next stage: execution.',
    );
  });

  test("rejects invalid runtime stage values with actionable errors", () => {
    expect(() => validateRunStageTransition({ from: "unknown", to: "context" })).toThrow(
      'Invalid run stage transition: from stage "unknown" is not valid; expected one of: created, context, planning, execution, review, verification, complete.',
    );
    expect(() => validateRunStageTransition({ from: "created", to: "unknown" })).toThrow(
      'Invalid run stage transition: to stage "unknown" is not valid; expected one of: created, context, planning, execution, review, verification, complete.',
    );
  });

  test("rejects invalid persisted transition history", () => {
    const result = runStageTransitionSchema.safeParse({
      from: "planning",
      to: "review",
      at: "2026-05-15T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected skipped persisted transition to fail validation.");
    }
    expect(result.error.issues[0]?.message).toBe(
      'Invalid run stage transition from "planning" to "review": expected next stage: execution.',
    );
  });

  test("rejects transitions out of terminal stages", () => {
    expect(getAllowedNextRunStages("complete")).toEqual([]);
    expect(() => validateRunStageTransition({ from: "complete", to: "created" })).toThrow(
      'Invalid run stage transition from "complete" to "created": "complete" is terminal and has no next stages.',
    );
  });

  test("validates structured blockers", () => {
    expect(
      runBlockerSchema.parse({
        reason: "Missing acceptance criteria for auth behavior.",
        next_step: "Ask the user to choose the auth behavior.",
        at: "2026-05-15T00:00:00.000Z",
      }),
    ).toEqual({
      reason: "Missing acceptance criteria for auth behavior.",
      next_step: "Ask the user to choose the auth behavior.",
      at: "2026-05-15T00:00:00.000Z",
    });

    expect(() => runBlockerSchema.parse({ reason: "Missing auth behavior." })).toThrow();
  });

  test("rejects unknown run stages", () => {
    expect(() => runStageSchema.parse("blocked")).toThrow();
  });
});
