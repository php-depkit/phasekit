import { describe, expect, test } from "bun:test";

import {
  defaultConfig,
  commitGateInputSchema,
  evaluateCommitGate,
  parseStateFile,
  type CommitGateDecision,
  type PhasekitConfig,
  type VerificationResult,
} from "../../src/index";

const passedVerificationResult: VerificationResult = {
  id: "verification-1",
  scope: { kind: "phase", phase_id: "P7" },
  status: "passed",
  review_status: "passed",
  verification_status: "passed",
  checked_at: "2026-05-16T00:00:00.000Z",
  command_evidence: [
    {
      kind: "test",
      command: "bun test packages/core/tests/git",
      status: "passed",
      output_references: [{ summary: "Git policy tests passed." }],
    },
  ],
  output_references: [{ summary: "Verification passed." }],
  findings: [],
  blockers: [],
  linked_requirement_ids: ["REQ-1"],
  integration_risks: [
    {
      id: "risk-1",
      description: "Commit gate must not bypass review or verification.",
      status: "covered",
      evidence: "Review and verification both passed.",
    },
  ],
  missing_check_proposals: [],
};

const withConfig = (config: Partial<PhasekitConfig["commit"]>): PhasekitConfig => ({
  ...defaultConfig,
  commit: {
    ...defaultConfig.commit,
    ...config,
  },
});

const blockerCodes = (decision: CommitGateDecision): string[] => {
  expect(decision.status).toBe("blocked");
  return decision.status === "blocked" ? decision.blockers.map((blocker) => blocker.code) : [];
};

describe("commit gate policy", () => {
  test("preserves default ask behavior after review and verification pass", () => {
    const decision = evaluateCommitGate({
      config: defaultConfig,
      changes: { kind: "implementation" },
      verification_result: passedVerificationResult,
    });

    expect(decision).toEqual({
      status: "approval_required",
      mode: "ask",
      message: "Commit is gated on user approval.",
    });
  });

  test("allows auto commit only after required gates pass", () => {
    const decision = evaluateCommitGate({
      config: withConfig({ mode: "auto" }),
      changes: { kind: "implementation" },
      verification_result: passedVerificationResult,
    });

    expect(decision).toEqual({
      status: "allowed",
      mode: "auto",
      message: "Commit policy allows committing after required gates passed.",
    });
  });

  test("disables commits when commit mode is off", () => {
    const decision = evaluateCommitGate({
      config: withConfig({ mode: "off" }),
      changes: { kind: "implementation" },
      verification_result: passedVerificationResult,
    });

    expect(decision).toEqual({
      status: "disabled",
      mode: "off",
      message: "Commit mode is off.",
    });
  });

  test("blocks planning-only commits when planning commits are disabled", () => {
    const decision = evaluateCommitGate({
      config: withConfig({ mode: "auto", planning_commits: false }),
      changes: { kind: "planning_only" },
      verification_result: passedVerificationResult,
    });

    expect(blockerCodes(decision)).toEqual(["planning_commits_disabled"]);
  });

  test("can allow planning-only commits when explicitly enabled and gates pass", () => {
    const decision = evaluateCommitGate({
      config: withConfig({ mode: "auto", planning_commits: true }),
      changes: { kind: "planning_only" },
      verification_result: passedVerificationResult,
    });

    expect(decision.status).toBe("allowed");
  });

  test("blocks failed review", () => {
    const decision = evaluateCommitGate({
      config: withConfig({ mode: "auto" }),
      changes: { kind: "implementation" },
      verification_result: {
        ...passedVerificationResult,
        status: "failed",
        review_status: "failed",
        blockers: [{ source: "review", reason: "Review found a defect.", next_step: "Fix the defect." }],
      },
    });

    expect(blockerCodes(decision)).toContain("failed_review");
  });

  test("blocks failed verification", () => {
    const decision = evaluateCommitGate({
      config: withConfig({ mode: "auto" }),
      changes: { kind: "implementation" },
      verification_result: {
        ...passedVerificationResult,
        status: "failed",
        verification_status: "failed",
        blockers: [{ source: "verification", reason: "Typecheck failed.", next_step: "Fix type errors." }],
      },
    });

    expect(blockerCodes(decision)).toEqual(["failed_verification", "verification_result_not_passed"]);
  });

  test("blocks missing required review and verification", () => {
    const noResultDecision = evaluateCommitGate({
      config: withConfig({ mode: "auto" }),
      changes: { kind: "implementation" },
    });
    const skippedDecision = evaluateCommitGate({
      config: withConfig({ mode: "auto" }),
      changes: { kind: "implementation" },
      verification_result: {
        ...passedVerificationResult,
        status: "blocked",
        review_status: "skipped",
        verification_status: "skipped",
      },
    });

    expect(blockerCodes(noResultDecision)).toEqual(["missing_required_review", "missing_required_verification"]);
    expect(blockerCodes(skippedDecision)).toEqual(["missing_required_review", "missing_required_verification"]);
  });

  test("blocks passing verification results without a successful check", () => {
    const decision = evaluateCommitGate({
      config: withConfig({ mode: "auto" }),
      changes: { kind: "implementation" },
      verification_result: {
        ...passedVerificationResult,
        command_evidence: [],
      },
    });

    expect(blockerCodes(decision)).toEqual(["missing_successful_verification_check"]);
  });

  test("blocks missing check proposals that still require approval", () => {
    const decision = evaluateCommitGate({
      config: withConfig({ mode: "auto" }),
      changes: { kind: "implementation" },
      verification_result: {
        ...passedVerificationResult,
        missing_check_proposals: [
          {
            id: "check-1",
            reason: "Add an integration check before committing.",
            proposed_command: "bun test packages/core/tests/git",
            approval_required: true,
          },
        ],
      },
    });

    expect(blockerCodes(decision)).toEqual(["missing_checks_require_approval"]);
  });

  test("rejects invalid policy inputs with actionable schema errors", () => {
    expect(() => {
      parseStateFile("commit-gate-input.json", commitGateInputSchema, {
        config: defaultConfig,
        changes: { kind: "repo_inspection", extra: true },
      });
    }).toThrow(
      "Invalid commit-gate-input.json: changes.kind: Invalid enum value. Expected 'planning_only' | 'implementation' | 'mixed', received 'repo_inspection'; changes: Unrecognized key(s) in object: 'extra'",
    );
  });
});
