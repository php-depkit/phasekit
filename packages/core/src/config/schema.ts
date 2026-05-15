import { z } from "zod";

export const commitModeSchema = z.enum(["ask", "auto", "off"]);

export const reviewPolicySchema = z.literal("always");

export const verifyPolicySchema = z.literal("always");

export const phasekitConfigSchema = z
  .object({
    commit: z
      .object({
        mode: commitModeSchema,
        planning_commits: z.boolean(),
      })
      .strict(),
    quality: z
      .object({
        review: reviewPolicySchema,
        verify: verifyPolicySchema,
      })
      .strict(),
    greenfield: z
      .object({
        recommend_stack: z.boolean(),
        ask_before_locking_stack: z.boolean(),
      })
      .strict(),
    models: z
      .object({
        orchestrator: z.string().min(1),
        context_scout: z.string().min(1),
        prd_ingestor: z.string().min(1),
        grill_me: z.string().min(1),
        planner: z.string().min(1),
        executor: z.string().min(1),
        reviewer: z.string().min(1),
        verifier: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type PhasekitConfig = z.infer<typeof phasekitConfigSchema>;
