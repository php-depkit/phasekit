import { z } from "zod";

export const commitModeSchema = z.enum(["ask", "auto", "off"]);

export const reviewPolicySchema = z.literal("always");

export const verifyPolicySchema = z.literal("always");

export const verificationCommandKindSchema = z.enum(["test", "typecheck", "lint", "build"]);

export const verificationCommandConfigSchema = z
  .object({
    command: z.string().min(1),
    requires_confirmation: z.boolean().optional(),
  })
  .strict();

export const verificationConfigSchema = z
  .object({
    commands: z
      .object({
        test: verificationCommandConfigSchema.optional(),
        typecheck: verificationCommandConfigSchema.optional(),
        lint: verificationCommandConfigSchema.optional(),
        build: verificationCommandConfigSchema.optional(),
      })
      .strict(),
  })
  .strict();

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
    verification: verificationConfigSchema,
  })
  .strict();

export const phasekitConfigOverrideSchema = z
  .object({
    commit: z
      .object({
        mode: commitModeSchema.optional(),
        planning_commits: z.boolean().optional(),
      })
      .strict()
      .optional(),
    quality: z
      .object({
        review: reviewPolicySchema.optional(),
        verify: verifyPolicySchema.optional(),
      })
      .strict()
      .optional(),
    greenfield: z
      .object({
        recommend_stack: z.boolean().optional(),
        ask_before_locking_stack: z.boolean().optional(),
      })
      .strict()
      .optional(),
    models: z
      .object({
        orchestrator: z.string().min(1).optional(),
        context_scout: z.string().min(1).optional(),
        prd_ingestor: z.string().min(1).optional(),
        grill_me: z.string().min(1).optional(),
        planner: z.string().min(1).optional(),
        executor: z.string().min(1).optional(),
        reviewer: z.string().min(1).optional(),
        verifier: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    verification: z
      .object({
        commands: z
          .object({
            test: verificationCommandConfigSchema.optional(),
            typecheck: verificationCommandConfigSchema.optional(),
            lint: verificationCommandConfigSchema.optional(),
            build: verificationCommandConfigSchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type PhasekitConfig = z.infer<typeof phasekitConfigSchema>;
export type PhasekitConfigOverride = z.infer<typeof phasekitConfigOverrideSchema>;
export type VerificationCommandConfig = z.infer<typeof verificationCommandConfigSchema>;
export type VerificationCommandKind = z.infer<typeof verificationCommandKindSchema>;
export type VerificationConfig = z.infer<typeof verificationConfigSchema>;
