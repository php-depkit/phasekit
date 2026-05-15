import { z } from "zod";

export const sourceReferenceSchema = z
  .object({
    path: z.string().min(1),
    locator: z.string().min(1).optional(),
  })
  .strict();

export const projectStateSchema = z
  .object({
    stack: z.string().min(1).optional(),
  })
  .strict();

export const requirementSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    sources: z.array(sourceReferenceSchema).min(1),
  })
  .strict();

export const requirementsStateSchema = z
  .object({
    requirements: z.array(requirementSchema),
  })
  .strict();

export const phaseStatusSchema = z.enum([
  "pending",
  "in_progress",
  "blocked",
  "complete",
]);

export const phaseSchema = z
  .object({
    id: z.string().min(1),
    source_requirement_ids: z.array(z.string().min(1)).min(1),
    expected_behavior: z.string().min(1),
    relevant_context: z.array(z.string().min(1)),
    likely_change_areas: z.array(z.string().min(1)),
    test_strategy: z.array(z.string().min(1)).min(1),
    integration_risks: z.array(z.string().min(1)),
    done_criteria: z.array(z.string().min(1)).min(1),
    status: phaseStatusSchema,
  })
  .strict();

export const phasesStateSchema = z
  .object({
    phases: z.array(phaseSchema),
  })
  .strict();

export const ruleSchema = z
  .object({
    id: z.string().min(1),
    category: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();

export const rulesStateSchema = z
  .object({
    rules: z.array(ruleSchema),
  })
  .strict();

export const runTaskSchema = z
  .object({
    id: z.string().min(1),
    owner_agent_id: z.string().min(1).optional(),
    started_at: z.string().datetime().optional(),
  })
  .strict();

export const runBlockerSchema = z
  .object({
    reason: z.string().min(1),
    at: z.string().datetime().optional(),
  })
  .strict();

export const runStageTransitionSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    at: z.string().datetime(),
  })
  .strict();

export const runStateSchema = z
  .object({
    id: z.string().min(1),
    current_phase: z.string().min(1),
    current_plan: z.string().min(1).optional(),
    current_stage: z.string().min(1),
    claimed_tasks: z.array(runTaskSchema),
    completed_checks: z.array(z.string().min(1)),
    changed_files: z.array(z.string().min(1)),
    commit_ids: z.array(z.string().min(1)),
    blockers: z.array(runBlockerSchema),
    last_successful_stage_transition: runStageTransitionSchema.optional(),
  })
  .strict();

export type ProjectState = z.infer<typeof projectStateSchema>;
export type RequirementsState = z.infer<typeof requirementsStateSchema>;
export type PhasesState = z.infer<typeof phasesStateSchema>;
export type RulesState = z.infer<typeof rulesStateSchema>;
export type RunState = z.infer<typeof runStateSchema>;
