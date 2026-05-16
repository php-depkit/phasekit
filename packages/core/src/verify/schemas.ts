import { z } from "zod";

import { verificationCommandKindSchema } from "../config/schema";

const nonEmptyStringSchema = z.string().min(1);
const requirementIdsSchema = z.array(nonEmptyStringSchema);
const integrationRiskIdsSchema = z.array(nonEmptyStringSchema);

export const verifyTaskScopeSchema = z
  .object({
    kind: z.literal("task"),
    phase_id: nonEmptyStringSchema,
    plan_id: nonEmptyStringSchema,
    task_id: nonEmptyStringSchema,
  })
  .strict();

export const verifyPhaseScopeSchema = z
  .object({
    kind: z.literal("phase"),
    phase_id: nonEmptyStringSchema,
  })
  .strict();

const verifyGroupScopeObjectSchema = z
  .object({
    kind: z.literal("group"),
    group_id: nonEmptyStringSchema.optional(),
    phase_ids: z.array(nonEmptyStringSchema).min(1),
  })
  .strict();

const rejectDuplicateGroupPhaseIds = (scope: z.infer<typeof verifyGroupScopeObjectSchema>, context: z.RefinementCtx) => {
  const seenPhaseIds = new Set<string>();

  for (const phaseId of scope.phase_ids) {
    if (seenPhaseIds.has(phaseId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phase_ids"],
        message: `Duplicate phase_id '${phaseId}' is not allowed in group verification scope.`,
      });
      return;
    }

    seenPhaseIds.add(phaseId);
  }
};

export const verifyGroupScopeSchema = verifyGroupScopeObjectSchema.superRefine(rejectDuplicateGroupPhaseIds);

export const verifyAllScopeSchema = z
  .object({
    kind: z.literal("all"),
  })
  .strict();

export const verifyScopeSchema = z
  .discriminatedUnion("kind", [
    verifyTaskScopeSchema,
    verifyPhaseScopeSchema,
    verifyGroupScopeObjectSchema,
    verifyAllScopeSchema,
  ])
  .superRefine((scope, context) => {
    if (scope.kind === "group") {
      rejectDuplicateGroupPhaseIds(scope, context);
    }
  });

export const verificationCommandEvidenceStatusSchema = z.enum(["passed", "failed", "skipped"]);

export const verificationCheckStatusSchema = z.enum(["passed", "failed", "blocked", "skipped"]);

export const verificationResultStatusSchema = z.enum(["passed", "failed", "blocked"]);

export const verificationFailureSourceSchema = z.enum(["review", "verification"]);

export const verificationOutputReferenceSchema = z
  .object({
    path: nonEmptyStringSchema.optional(),
    locator: nonEmptyStringSchema.optional(),
    summary: nonEmptyStringSchema.optional(),
  })
  .strict()
  .superRefine((reference, context) => {
    if (reference.path === undefined && reference.summary === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Output reference must include a path or summary.",
      });
    }
  });

export const verificationCommandEvidenceSchema = z
  .object({
    kind: verificationCommandKindSchema,
    command: nonEmptyStringSchema,
    status: verificationCommandEvidenceStatusSchema,
    output_references: z.array(verificationOutputReferenceSchema),
    started_at: z.string().datetime().optional(),
    completed_at: z.string().datetime().optional(),
  })
  .strict();

export const verificationFindingSeveritySchema = z.enum(["info", "warning", "failure"]);

export const verificationFindingSchema = z
  .object({
    source: verificationFailureSourceSchema,
    severity: verificationFindingSeveritySchema,
    message: nonEmptyStringSchema,
    requirement_ids: requirementIdsSchema.optional(),
    integration_risk_ids: integrationRiskIdsSchema.optional(),
    evidence: nonEmptyStringSchema.optional(),
  })
  .strict();

export const verificationBlockerSchema = z
  .object({
    source: verificationFailureSourceSchema,
    reason: nonEmptyStringSchema,
    next_step: nonEmptyStringSchema,
    requirement_ids: requirementIdsSchema.optional(),
    integration_risk_ids: integrationRiskIdsSchema.optional(),
  })
  .strict();

export const verificationIntegrationRiskStatusSchema = z.enum(["covered", "risk_found", "not_checked"]);

export const verificationIntegrationRiskSchema = z
  .object({
    id: nonEmptyStringSchema,
    description: nonEmptyStringSchema,
    status: verificationIntegrationRiskStatusSchema,
    evidence: nonEmptyStringSchema.optional(),
  })
  .strict();

export const verificationMissingCheckProposalSchema = z
  .object({
    id: nonEmptyStringSchema,
    reason: nonEmptyStringSchema,
    proposed_command: nonEmptyStringSchema.optional(),
    requirement_ids: requirementIdsSchema.optional(),
    integration_risk_ids: integrationRiskIdsSchema.optional(),
    approval_required: z.literal(true),
  })
  .strict();

export const verificationResultSchema = z
  .object({
    id: nonEmptyStringSchema,
    scope: verifyScopeSchema,
    status: verificationResultStatusSchema,
    review_status: verificationCheckStatusSchema,
    verification_status: verificationCheckStatusSchema,
    checked_at: z.string().datetime(),
    command_evidence: z.array(verificationCommandEvidenceSchema),
    output_references: z.array(verificationOutputReferenceSchema),
    findings: z.array(verificationFindingSchema),
    blockers: z.array(verificationBlockerSchema),
    linked_requirement_ids: requirementIdsSchema,
    integration_risks: z.array(verificationIntegrationRiskSchema),
    missing_check_proposals: z.array(verificationMissingCheckProposalSchema),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status !== "passed") {
      return;
    }

    if (result.review_status !== "passed") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["review_status"],
        message: "Passed verification results require review_status to be passed.",
      });
    }

    if (result.verification_status !== "passed") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verification_status"],
        message: "Passed verification results require verification_status to be passed.",
      });
    }

    if (result.blockers.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "Passed verification results cannot include blockers.",
      });
    }

    result.findings.forEach((finding, index) => {
      if (finding.severity === "failure") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["findings", index, "severity"],
          message: "Passed verification results cannot include failure findings.",
        });
      }
    });

    result.command_evidence.forEach((evidence, index) => {
      if (evidence.status === "failed") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["command_evidence", index, "status"],
          message: "Passed verification results cannot include failed command evidence.",
        });
      }
    });

    result.integration_risks.forEach((risk, index) => {
      if (risk.status !== "covered") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["integration_risks", index, "status"],
          message: "Passed verification results require integration risks to be covered.",
        });
      }
    });
  });

export type VerifyTaskScope = z.infer<typeof verifyTaskScopeSchema>;
export type VerifyPhaseScope = z.infer<typeof verifyPhaseScopeSchema>;
export type VerifyGroupScope = z.infer<typeof verifyGroupScopeSchema>;
export type VerifyAllScope = z.infer<typeof verifyAllScopeSchema>;
export type VerifyScope = z.infer<typeof verifyScopeSchema>;
export type VerificationCommandEvidenceStatus = z.infer<typeof verificationCommandEvidenceStatusSchema>;
export type VerificationCheckStatus = z.infer<typeof verificationCheckStatusSchema>;
export type VerificationResultStatus = z.infer<typeof verificationResultStatusSchema>;
export type VerificationFailureSource = z.infer<typeof verificationFailureSourceSchema>;
export type VerificationOutputReference = z.infer<typeof verificationOutputReferenceSchema>;
export type VerificationCommandEvidence = z.infer<typeof verificationCommandEvidenceSchema>;
export type VerificationFindingSeverity = z.infer<typeof verificationFindingSeveritySchema>;
export type VerificationFinding = z.infer<typeof verificationFindingSchema>;
export type VerificationBlocker = z.infer<typeof verificationBlockerSchema>;
export type VerificationIntegrationRiskStatus = z.infer<typeof verificationIntegrationRiskStatusSchema>;
export type VerificationIntegrationRisk = z.infer<typeof verificationIntegrationRiskSchema>;
export type VerificationMissingCheckProposal = z.infer<typeof verificationMissingCheckProposalSchema>;
export type VerificationResult = z.infer<typeof verificationResultSchema>;
