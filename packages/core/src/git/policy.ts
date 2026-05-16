import { z } from "zod";

import { phasekitConfigSchema, type PhasekitConfig } from "../config/schema";
import { verificationResultSchema, type VerificationResult } from "../verify/schemas";

export const commitChangeKindSchema = z.enum(["planning_only", "implementation", "mixed"]);

export const commitGateInputSchema = z
  .object({
    config: phasekitConfigSchema,
    changes: z
      .object({
        kind: commitChangeKindSchema,
      })
      .strict(),
    verification_result: verificationResultSchema.optional(),
  })
  .strict();

export type CommitChangeKind = z.infer<typeof commitChangeKindSchema>;

export type CommitGateInput = {
  config: PhasekitConfig;
  changes: {
    kind: CommitChangeKind;
  };
  verification_result?: VerificationResult;
};

export type CommitGateBlockerCode =
  | "planning_commits_disabled"
  | "missing_required_review"
  | "failed_review"
  | "missing_required_verification"
  | "failed_verification"
  | "verification_result_not_passed"
  | "missing_checks_require_approval"
  | "missing_successful_verification_check";

export type CommitGateBlocker = {
  code: CommitGateBlockerCode;
  message: string;
};

export type CommitGateDecision =
  | {
      status: "disabled";
      mode: "off";
      message: string;
    }
  | {
      status: "blocked";
      mode: "ask" | "auto";
      blockers: CommitGateBlocker[];
    }
  | {
      status: "approval_required";
      mode: "ask";
      message: string;
    }
  | {
      status: "allowed";
      mode: "auto";
      message: string;
    };

/**
 * Evaluates whether a commit may proceed without inspecting git state or running commands.
 */
export function evaluateCommitGate(input: CommitGateInput): CommitGateDecision {
  const parsedInput = commitGateInputSchema.parse(input);
  const { config, verification_result: verificationResult } = parsedInput;

  if (config.commit.mode === "off") {
    return {
      status: "disabled",
      mode: "off",
      message: "Commit mode is off.",
    };
  }

  const blockers = getCommitGateBlockers(parsedInput);

  if (blockers.length > 0) {
    return {
      status: "blocked",
      mode: config.commit.mode,
      blockers,
    };
  }

  if (config.commit.mode === "ask") {
    return {
      status: "approval_required",
      mode: "ask",
      message: "Commit is gated on user approval.",
    };
  }

  return {
    status: "allowed",
    mode: "auto",
    message: "Commit policy allows committing after required gates passed.",
  };
}

function getCommitGateBlockers(input: z.infer<typeof commitGateInputSchema>): CommitGateBlocker[] {
  const blockers: CommitGateBlocker[] = [];
  const { config, changes, verification_result: verificationResult } = input;

  if (changes.kind === "planning_only" && !config.commit.planning_commits) {
    blockers.push({
      code: "planning_commits_disabled",
      message: "Planning-only commits are disabled by commit.planning_commits.",
    });
  }

  if (config.quality.review === "always") {
    blockers.push(...getReviewBlockers(verificationResult));
  }

  if (config.quality.verify === "always") {
    blockers.push(...getVerificationBlockers(verificationResult));
  }

  return blockers;
}

function getReviewBlockers(verificationResult: VerificationResult | undefined): CommitGateBlocker[] {
  if (verificationResult === undefined || verificationResult.review_status === "skipped") {
    return [
      {
        code: "missing_required_review",
        message: "A passing review result is required before commit.",
      },
    ];
  }

  if (verificationResult.review_status !== "passed") {
    return [
      {
        code: "failed_review",
        message: "Review did not pass.",
      },
    ];
  }

  return [];
}

function getVerificationBlockers(verificationResult: VerificationResult | undefined): CommitGateBlocker[] {
  if (verificationResult === undefined || verificationResult.verification_status === "skipped") {
    return [
      {
        code: "missing_required_verification",
        message: "A passing verification result is required before commit.",
      },
    ];
  }

  const blockers: CommitGateBlocker[] = [];

  if (verificationResult.verification_status !== "passed") {
    blockers.push({
      code: "failed_verification",
      message: "Verification did not pass.",
    });
  }

  if (verificationResult.status !== "passed") {
    blockers.push({
      code: "verification_result_not_passed",
      message: "Overall verification result did not pass.",
    });
  }

  if (verificationResult.missing_check_proposals.length > 0) {
    blockers.push({
      code: "missing_checks_require_approval",
      message: "Missing verification checks require approval before commit.",
    });
  }

  if (!verificationResult.command_evidence.some((evidence) => evidence.status === "passed")) {
    blockers.push({
      code: "missing_successful_verification_check",
      message: "At least one successful verification check is required before commit.",
    });
  }

  return blockers;
}
