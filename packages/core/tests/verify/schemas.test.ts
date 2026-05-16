import { describe, expect, test } from "bun:test";

import {
  parseStateFile,
  verifyGroupScopeSchema,
  verificationResultSchema,
  verifyScopeSchema,
  type VerificationResult,
} from "../../src/index";

const validResult: VerificationResult = {
  id: "verification-1",
  scope: { kind: "phase", phase_id: "P7" },
  status: "failed",
  review_status: "failed",
  verification_status: "passed",
  checked_at: "2026-05-16T00:00:00.000Z",
  command_evidence: [
    {
      kind: "test",
      command: "bun test packages/core/tests/verify",
      status: "passed",
      output_references: [{ summary: "Verify schema tests passed." }],
      started_at: "2026-05-16T00:00:00.000Z",
      completed_at: "2026-05-16T00:01:00.000Z",
    },
  ],
  output_references: [{ path: ".planning/verifications/P7.json", locator: "command_evidence.0" }],
  findings: [
    {
      source: "review",
      severity: "failure",
      message: "Result schema is missing review failure classification.",
      requirement_ids: ["REQ-1"],
      integration_risk_ids: ["risk-1"],
      evidence: "review_status is failed while verification_status is passed.",
    },
  ],
  blockers: [
    {
      source: "review",
      reason: "Review found an incomplete schema.",
      next_step: "Add the missing review failure classification.",
      requirement_ids: ["REQ-1"],
      integration_risk_ids: ["risk-1"],
    },
  ],
  linked_requirement_ids: ["REQ-1"],
  integration_risks: [
    {
      id: "risk-1",
      description: "Verification must check whole-project integration, not only task-local checks.",
      status: "risk_found",
      evidence: "Review failure blocks completion.",
    },
  ],
  missing_check_proposals: [
    {
      id: "missing-check-1",
      reason: "Add an integration check for schema consumers before broadening verification scope.",
      proposed_command: "bun test packages/core/tests/verify",
      requirement_ids: ["REQ-1"],
      integration_risk_ids: ["risk-1"],
      approval_required: true,
    },
  ],
};

const validPassedResult: VerificationResult = {
  ...validResult,
  status: "passed",
  review_status: "passed",
  verification_status: "passed",
  findings: [],
  blockers: [],
  integration_risks: [
    {
      id: "risk-1",
      description: "Verification must check whole-project integration, not only task-local checks.",
      status: "covered",
      evidence: "Integration risk was checked.",
    },
  ],
};

describe("verification scope schemas", () => {
  test("accept task, phase, group, and all scopes", () => {
    expect(verifyScopeSchema.parse({ kind: "task", phase_id: "P7", plan_id: "plan-1", task_id: "task-1" })).toEqual({
      kind: "task",
      phase_id: "P7",
      plan_id: "plan-1",
      task_id: "task-1",
    });
    expect(verifyScopeSchema.parse({ kind: "phase", phase_id: "P7" })).toEqual({ kind: "phase", phase_id: "P7" });
    expect(verifyScopeSchema.parse({ kind: "group", group_id: "release-1", phase_ids: ["P7", "P8"] })).toEqual({
      kind: "group",
      group_id: "release-1",
      phase_ids: ["P7", "P8"],
    });
    expect(verifyScopeSchema.parse({ kind: "all" })).toEqual({ kind: "all" });
  });

  test("rejects invalid and ambiguous scopes", () => {
    expect(() => parseStateFile("verification-scope.json", verifyScopeSchema, { kind: "task", phase_id: "P7", task_id: "task-1" })).toThrow(
      "Invalid verification-scope.json: plan_id: Required",
    );
    expect(() => parseStateFile("verification-scope.json", verifyScopeSchema, { kind: "group", phase_ids: [] })).toThrow(
      "Invalid verification-scope.json: phase_ids: Array must contain at least 1 element(s)",
    );
    expect(() => parseStateFile("verification-scope.json", verifyScopeSchema, { kind: "all", phase_id: "P7" })).toThrow(
      "Invalid verification-scope.json: <root>: Unrecognized key(s) in object: 'phase_id'",
    );
  });

  test("rejects duplicate group phase IDs with an actionable error", () => {
    const duplicateGroupScope = { kind: "group", group_id: "release-1", phase_ids: ["P7", "P7"] };

    expect(() => parseStateFile("verification-scope.json", verifyGroupScopeSchema, duplicateGroupScope)).toThrow(
      "Invalid verification-scope.json: phase_ids: Duplicate phase_id 'P7' is not allowed in group verification scope.",
    );
    expect(() => parseStateFile("verification-scope.json", verifyScopeSchema, duplicateGroupScope)).toThrow(
      "Invalid verification-scope.json: phase_ids: Duplicate phase_id 'P7' is not allowed in group verification scope.",
    );
  });
});

describe("verification result schemas", () => {
  test("accept structured verification results with requirements, risks, blockers, and missing-check proposals", () => {
    expect(verificationResultSchema.parse(validResult)).toEqual(validResult);
  });

  test("accepts passed verification results without contradictory failure signals", () => {
    expect(verificationResultSchema.parse(validPassedResult)).toEqual(validPassedResult);
  });

  test("distinguishes review failures from verification failures", () => {
    const reviewFailure = verificationResultSchema.parse(validResult);
    const verificationFailure = verificationResultSchema.parse({
      ...validResult,
      review_status: "passed",
      verification_status: "failed",
      findings: [{ ...validResult.findings[0], source: "verification" }],
      blockers: [{ ...validResult.blockers[0], source: "verification" }],
    });

    expect(reviewFailure.review_status).toBe("failed");
    expect(reviewFailure.verification_status).toBe("passed");
    expect(reviewFailure.findings[0]?.source).toBe("review");
    expect(verificationFailure.review_status).toBe("passed");
    expect(verificationFailure.verification_status).toBe("failed");
    expect(verificationFailure.findings[0]?.source).toBe("verification");
  });

  test("requires missing-check proposals to need approval before scope expands", () => {
    expect(() => {
      parseStateFile("verification-result.json", verificationResultSchema, {
        ...validResult,
        missing_check_proposals: [
          {
            id: "missing-check-1",
            reason: "Add an integration check.",
            approval_required: false,
          },
        ],
      });
    }).toThrow("Invalid verification-result.json: missing_check_proposals.0.approval_required: Invalid literal value, expected true");
  });

  test("rejects invalid results with actionable schema errors", () => {
    expect(() => {
      parseStateFile("verification-result.json", verificationResultSchema, {
        ...validResult,
        command_evidence: [
          {
            kind: "test",
            command: "",
            status: "passed",
            output_references: [{ locator: "stdout" }],
          },
        ],
        extra: true,
      });
    }).toThrow(
      "Invalid verification-result.json: command_evidence.0.command: String must contain at least 1 character(s); command_evidence.0.output_references.0: Output reference must include a path or summary.; <root>: Unrecognized key(s) in object: 'extra'",
    );
  });

  test("rejects passed verification results with contradictory failure signals", () => {
    const cases: Array<{ name: string; result: VerificationResult; message: string }> = [
      {
        name: "failed review status",
        result: { ...validPassedResult, review_status: "failed" },
        message: "review_status: Passed verification results require review_status to be passed.",
      },
      {
        name: "failed verification status",
        result: { ...validPassedResult, verification_status: "failed" },
        message: "verification_status: Passed verification results require verification_status to be passed.",
      },
      {
        name: "blockers",
        result: { ...validPassedResult, blockers: validResult.blockers },
        message: "blockers: Passed verification results cannot include blockers.",
      },
      {
        name: "failure findings",
        result: { ...validPassedResult, findings: validResult.findings },
        message: "findings.0.severity: Passed verification results cannot include failure findings.",
      },
      {
        name: "failed command evidence",
        result: {
          ...validPassedResult,
          command_evidence: [{ ...validPassedResult.command_evidence[0]!, status: "failed" }],
        },
        message: "command_evidence.0.status: Passed verification results cannot include failed command evidence.",
      },
      {
        name: "risk_found integration risk",
        result: { ...validPassedResult, integration_risks: [{ ...validPassedResult.integration_risks[0]!, status: "risk_found" }] },
        message: "integration_risks.0.status: Passed verification results require integration risks to be covered.",
      },
      {
        name: "not_checked integration risk",
        result: { ...validPassedResult, integration_risks: [{ ...validPassedResult.integration_risks[0]!, status: "not_checked" }] },
        message: "integration_risks.0.status: Passed verification results require integration risks to be covered.",
      },
    ];

    for (const testCase of cases) {
      expect(() => parseStateFile("verification-result.json", verificationResultSchema, testCase.result), testCase.name).toThrow(
        `Invalid verification-result.json: ${testCase.message}`,
      );
    }
  });
});
