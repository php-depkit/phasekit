import { z } from "zod";

export const runStages = [
  "created",
  "context",
  "planning",
  "execution",
  "review",
  "verification",
  "complete",
] as const;

export const runStageSchema = z.enum(runStages);

export const runBlockerSchema = z
  .object({
    reason: z.string().min(1),
    next_step: z.string().min(1),
    at: z.string().datetime().optional(),
  })
  .strict();

export type RunStage = z.infer<typeof runStageSchema>;
export type RunBlocker = z.infer<typeof runBlockerSchema>;

export type RunStageTransition = {
  from: RunStage;
  to: RunStage;
};

export type RunStageTransitionInput = {
  from: unknown;
  to: unknown;
};

export const allowedRunStageTransitions: Record<RunStage, readonly RunStage[]> = {
  created: ["context"],
  context: ["planning"],
  planning: ["execution"],
  execution: ["review"],
  review: ["verification"],
  verification: ["complete"],
  complete: [],
};

export function getAllowedNextRunStages(stage: RunStage): readonly RunStage[] {
  return allowedRunStageTransitions[stage];
}

function formatExpectedStages(stages: readonly RunStage[]): string {
  if (stages.length === 1) {
    return `expected next stage: ${stages[0]}`;
  }

  return `expected next stages: ${stages.join(", ")}`;
}

function formatStageValue(value: unknown): string {
  return typeof value === "string" ? `"${value}"` : String(value);
}

function parseTransitionStage(value: unknown, fieldName: "from" | "to"): RunStage {
  const result = runStageSchema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  throw new Error(
    `Invalid run stage transition: ${fieldName} stage ${formatStageValue(
      value,
    )} is not valid; expected one of: ${runStages.join(", ")}.`,
  );
}

export function validateRunStageTransition(
  transition: RunStageTransitionInput,
): RunStageTransition {
  const from = parseTransitionStage(transition.from, "from");
  const to = parseTransitionStage(transition.to, "to");
  const allowedNextStages = getAllowedNextRunStages(from);

  if (allowedNextStages.includes(to)) {
    return { from, to };
  }

  if (allowedNextStages.length === 0) {
    throw new Error(
      `Invalid run stage transition from "${from}" to "${to}": "${from}" is terminal and has no next stages.`,
    );
  }

  throw new Error(
    `Invalid run stage transition from "${from}" to "${to}": ${formatExpectedStages(
      allowedNextStages,
    )}.`,
  );
}
