import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { executeVerificationScope, initializePlanningState, orchestrateRunPhase, readRunState, writeJsonFile } from "../../src/index";

const temporaryDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "phasekit-run-orchestrate-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createVerificationResult(runId: string, phaseId: string) {
  return {
    id: `verify-${runId}`,
    scope: { kind: "phase", phase_id: phaseId },
    status: "passed",
    review_status: "passed",
    verification_status: "passed",
    checked_at: "2026-05-17T00:01:00.000Z",
    command_evidence: [{ kind: "test", command: "bun test", status: "passed", output_references: [] }],
    output_references: [],
    findings: [],
    blockers: [],
    linked_requirement_ids: ["REQ-1"],
    integration_risks: [{ id: "risk-1", description: "gate", status: "covered" }],
    missing_check_proposals: [],
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("run-phase orchestration", () => {
  test("with phaseId only, generates plan and stops at execution with required evidence", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, ".planning", "requirements.json"), {
      requirements: [{ id: "REQ-1", text: "Implement run-phase orchestration.", sources: [{ path: "prd.md" }] }],
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [
        {
          id: "P11-T2",
          source_requirement_ids: ["REQ-1"],
          expected_behavior: "One run-phase path advances through required gates.",
          relevant_context: ["packages/core/src/runs"],
          likely_change_areas: ["packages/core/src/runs/orchestrate.ts"],
          test_strategy: ["bun test packages/core/tests/runs/orchestrate.test.ts"],
          integration_risks: ["Gate bypass"],
          done_criteria: ["Run-phase requires review and verification by default."],
          status: "pending",
        },
      ],
    });

    const result = await orchestrateRunPhase({ rootDir, phaseId: "P11-T2" });

    expect(result.phase.id).toBe("P11-T2");
    expect(result.linked_requirements).toEqual([{ id: "REQ-1", text: "Implement run-phase orchestration." }]);
    expect(result.stage).toBe("execution");
    expect(result.planning.required).toBe(false);
    expect(result.planning.accepted_plan_id).toBe("plan-P11-T2-auto-v1");
    expect(result.commit_gate).toBeNull();
    expect(result.next_required).toEqual({ kind: "execution_evidence", pending_task_ids: ["task-1"] });
    expect(result.review_required).toBe(true);
    expect(result.verification_required).toBe(true);
  });

  test("gathered context shapes deterministic default planning", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, "package.json"), { name: "phasekit-test" });
    await writeJsonFile(join(rootDir, ".planning", "requirements.json"), {
      requirements: [{ id: "REQ-1", text: "Implement run-phase orchestration.", sources: [{ path: "prd.md" }] }],
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [
        {
          id: "P11-T2",
          source_requirement_ids: ["REQ-1"],
          expected_behavior: "One run-phase path advances through required gates.",
          relevant_context: ["packages/core/src/runs"],
          likely_change_areas: ["packages/core/src/runs/orchestrate.ts"],
          test_strategy: ["bun test packages/core/tests/runs/orchestrate.test.ts"],
          integration_risks: ["Gate bypass"],
          done_criteria: ["Run-phase requires review and verification by default."],
          status: "pending",
        },
      ],
    });

    const withoutContext = await orchestrateRunPhase({ rootDir, phaseId: "P11-T2" });
    const withoutContextExecution = await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      executionEvidence: [
        {
          task_id: "task-1",
          evidence: {
            check_results: [{ command: "bun test packages/core/tests/runs/orchestrate.test.ts", status: "passed" }],
            changed_files: ["packages/core/src/runs/orchestrate.ts"],
          },
        },
      ],
    });
    expect(withoutContextExecution.stage).toBe("review");

    await writeJsonFile(join(rootDir, "packages/core/src/runs/orchestrate.ts"), "export {}\n");
    await writeJsonFile(join(rootDir, "packages/core/src/runs/orchestrate.test.ts"), "import { test } from 'bun:test';\n");
    await writeJsonFile(join(rootDir, "packages/core/src/runs/package.json"), { name: "runs-local" });

    const rootDirWithContext = await createTempDirectory();
    await initializePlanningState(rootDirWithContext);
    await writeJsonFile(join(rootDirWithContext, "package.json"), { name: "phasekit-test" });
    await writeJsonFile(join(rootDirWithContext, ".planning", "requirements.json"), {
      requirements: [{ id: "REQ-1", text: "Implement run-phase orchestration.", sources: [{ path: "prd.md" }] }],
    });
    await writeJsonFile(join(rootDirWithContext, ".planning", "phases.json"), {
      phases: [
        {
          id: "P11-T2",
          source_requirement_ids: ["REQ-1"],
          expected_behavior: "One run-phase path advances through required gates.",
          relevant_context: ["packages/core/src/runs"],
          likely_change_areas: ["packages/core/src/runs/orchestrate.ts"],
          test_strategy: ["bun test packages/core/tests/runs/orchestrate.test.ts"],
          integration_risks: ["Gate bypass"],
          done_criteria: ["Run-phase requires review and verification by default."],
          status: "pending",
        },
      ],
    });
    await writeJsonFile(join(rootDirWithContext, "packages/core/src/runs/orchestrate.ts"), "export {}\n");
    await writeJsonFile(join(rootDirWithContext, "packages/core/src/runs/orchestrate.test.ts"), "import { test } from 'bun:test';\n");
    await writeJsonFile(join(rootDirWithContext, "packages/core/src/runs/package.json"), { name: "runs-local" });

    const withContext = await orchestrateRunPhase({ rootDir: rootDirWithContext, phaseId: "P11-T2" });
    expect(withContext.context_snapshot.nearby_tests).toContain("packages/core/src/runs/orchestrate.test.ts");
    expect(withContext.context_snapshot.nearby_config_neighbors).toContain("packages/core/src/runs/package.json");
    await expect(
      orchestrateRunPhase({
        rootDir: rootDirWithContext,
        phaseId: "P11-T2",
        executionEvidence: [
          {
            task_id: "task-1",
            evidence: {
              check_results: [{ command: "bun test packages/core/tests/runs/orchestrate.test.ts", status: "passed" }],
              changed_files: ["packages/core/src/runs/orchestrate.ts"],
            },
          },
        ],
      }),
    ).rejects.toThrow("missing required check evidence");
  });

  test("fails when linked requirement ids are missing", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, ".planning", "requirements.json"), {
      requirements: [{ id: "REQ-1", text: "Known requirement", sources: [{ path: "prd.md" }] }],
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [
        {
          id: "P11-T2",
          source_requirement_ids: ["REQ-1", "REQ-999"],
          expected_behavior: "One run-phase path advances through required gates.",
          relevant_context: ["packages/core/src/runs"],
          likely_change_areas: ["packages/core/src/runs/orchestrate.ts"],
          test_strategy: ["Run run-phase orchestration tests."],
          integration_risks: ["Gate bypass"],
          done_criteria: ["Run-phase requires review and verification by default."],
          status: "pending",
        },
      ],
    });

    await expect(orchestrateRunPhase({ rootDir, phaseId: "P11-T2" })).rejects.toThrow(
      "linked requirement REQ-999 is missing",
    );
  });

  test("uses native task claim/complete flow and allows completion in auto mode", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, ".planning", "config.json"), { commit: { mode: "auto" } });
    await writeJsonFile(join(rootDir, ".planning", "requirements.json"), {
      requirements: [{ id: "REQ-1", text: "Implement run-phase orchestration.", sources: [{ path: "prd.md" }] }],
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [
        {
          id: "P11-T2",
          source_requirement_ids: ["REQ-1"],
          expected_behavior: "One run-phase path advances through required gates.",
          relevant_context: ["packages/core/src/runs"],
          likely_change_areas: ["packages/core/src/runs/orchestrate.ts"],
          test_strategy: ["Run run-phase orchestration tests."],
          integration_risks: ["Gate bypass"],
          done_criteria: ["Run-phase requires review and verification by default."],
          status: "pending",
        },
      ],
    });

    const plan = {
      id: "plan-1",
      phase_id: "P11-T2",
      tasks: [
        {
          id: "task-1",
          title: "Implement orchestrated run path",
          source_requirement_ids: ["REQ-1"],
          scope: "Implement native run-phase orchestration with required review verification and commit-gate checks.",
          files: ["packages/core/src/runs/orchestrate.ts"],
          checks: [{ command: "bun test packages/core/tests/runs/orchestrate.test.ts" }],
          adds_behavior: true,
        },
      ],
    };

    await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      plan,
    });

    const review = await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      plan,
      executionEvidence: [
        {
          task_id: "task-1",
          evidence: {
            check_results: [{ command: "bun test packages/core/tests/runs/orchestrate.test.ts", status: "passed" }],
            changed_files: ["packages/core/src/runs/orchestrate.ts"],
          },
        },
      ],
    });

    expect(review.stage).toBe("review");
    expect(review.commit_gate).toBeNull();
    expect(review.next_required?.kind).toBe("review_verification_request");

    const verification = await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      plan,
      verificationRequestId:
        review.next_required?.kind === "review_verification_request" ? review.next_required.request_id : undefined,
      verificationResult: createVerificationResult("phase-P11-T2", "P11-T2"),
    });

    expect(verification.stage).toBe("verification");
    expect(verification.commit_gate).toBeNull();
    expect(verification.next_required?.kind).toBe("review_verification_request");

    const result = await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      plan,
      verificationRequestId:
        verification.next_required?.kind === "review_verification_request"
          ? verification.next_required.request_id
          : undefined,
      verificationResult: createVerificationResult("phase-P11-T2", "P11-T2"),
    });

    const run = await readRunState(rootDir, "phase-P11-T2");
    expect(run.current_plan).toBe("plan-1");
    expect(result.commit_gate?.status).toBe("allowed");
    expect(result.stage).toBe("complete");
    expect(result.next_required).toBeNull();
    expect(JSON.parse(await Bun.file(join(rootDir, ".planning", "phases.json")).text())).toEqual({
      phases: [
        expect.objectContaining({
          id: "P11-T2",
          status: "complete",
        }),
      ],
    });
  });

  test("does not auto-complete when commit mode is ask", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, ".planning", "requirements.json"), {
      requirements: [{ id: "REQ-1", text: "Implement run-phase orchestration.", sources: [{ path: "prd.md" }] }],
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [
        {
          id: "P11-T2",
          source_requirement_ids: ["REQ-1"],
          expected_behavior: "One run-phase path advances through required gates.",
          relevant_context: ["packages/core/src/runs"],
          likely_change_areas: ["packages/core/src/runs/orchestrate.ts"],
          test_strategy: ["bun test packages/core/tests/runs/orchestrate.test.ts"],
          integration_risks: ["Gate bypass"],
          done_criteria: ["Run-phase requires review and verification by default."],
          status: "pending",
        },
      ],
    });

    await orchestrateRunPhase({ rootDir, phaseId: "P11-T2" });

    const review = await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      executionEvidence: [
        {
          task_id: "task-1",
          evidence: {
            check_results: [{ command: "bun test packages/core/tests/runs/orchestrate.test.ts", status: "passed" }],
            changed_files: ["packages/core/src/runs/orchestrate.ts"],
          },
        },
      ],
    });

    const result = await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      verificationRequestId:
        review.next_required?.kind === "review_verification_request" ? review.next_required.request_id : undefined,
      verificationResult: createVerificationResult("phase-P11-T2", "P11-T2"),
    });

    expect(result.commit_gate).toBeNull();
    expect(result.stage).toBe("verification");
    expect(result.next_required).toEqual(
      expect.objectContaining({
        kind: "review_verification_request",
        stage: "verification",
        run_id: "phase-P11-T2",
        phase_id: "P11-T2",
        linked_requirement_ids: ["REQ-1"],
      }),
    );
  });

  test("completes without commit when commit mode is off", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, ".planning", "config.json"), { commit: { mode: "off" } });
    await writeJsonFile(join(rootDir, ".planning", "requirements.json"), {
      requirements: [{ id: "REQ-1", text: "Implement run-phase orchestration.", sources: [{ path: "prd.md" }] }],
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [
        {
          id: "P11-T2",
          source_requirement_ids: ["REQ-1"],
          expected_behavior: "One run-phase path advances through required gates.",
          relevant_context: ["packages/core/src/runs"],
          likely_change_areas: ["packages/core/src/runs/orchestrate.ts"],
          test_strategy: ["bun test packages/core/tests/runs/orchestrate.test.ts"],
          integration_risks: ["Gate bypass"],
          done_criteria: ["Run-phase requires review and verification by default."],
          status: "pending",
        },
      ],
    });

    await orchestrateRunPhase({ rootDir, phaseId: "P11-T2" });
    const review = await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      executionEvidence: [
        {
          task_id: "task-1",
          evidence: {
            check_results: [{ command: "bun test packages/core/tests/runs/orchestrate.test.ts", status: "passed" }],
            changed_files: ["packages/core/src/runs/orchestrate.ts"],
          },
        },
      ],
    });

    const verification = await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      verificationRequestId:
        review.next_required?.kind === "review_verification_request" ? review.next_required.request_id : undefined,
      verificationResult: createVerificationResult("phase-P11-T2", "P11-T2"),
    });

    const result = await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      verificationRequestId:
        verification.next_required?.kind === "review_verification_request"
          ? verification.next_required.request_id
          : undefined,
      verificationResult: createVerificationResult("phase-P11-T2", "P11-T2"),
    });

    expect(result.commit_gate?.status).toBe("disabled");
    expect(result.stage).toBe("complete");
  });

  test("missing execution evidence leaves run at execution", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, ".planning", "requirements.json"), {
      requirements: [{ id: "REQ-1", text: "Implement run-phase orchestration.", sources: [{ path: "prd.md" }] }],
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [
        {
          id: "P11-T2",
          source_requirement_ids: ["REQ-1"],
          expected_behavior: "One run-phase path advances through required gates.",
          relevant_context: ["packages/core/src/runs"],
          likely_change_areas: ["packages/core/src/runs/orchestrate.ts"],
          test_strategy: ["bun test packages/core/tests/runs/orchestrate.test.ts"],
          integration_risks: ["Gate bypass"],
          done_criteria: ["Run-phase requires review and verification by default."],
          status: "pending",
        },
      ],
    });

    const result = await orchestrateRunPhase({ rootDir, phaseId: "P11-T2" });
    expect(result.stage).toBe("execution");
    expect(result.next_required).toEqual({ kind: "execution_evidence", pending_task_ids: ["task-1"] });
  });

  test("failed verification repair follow-up is surfaced as execution evidence", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, "package.json"), {
      scripts: { test: "bun test" },
    });
    await writeJsonFile(join(rootDir, ".planning", "config.json"), {
      verification: {
        commands: {
          test: { command: "bun test" },
        },
      },
    });
    await writeJsonFile(join(rootDir, ".planning", "requirements.json"), {
      requirements: [{ id: "REQ-1", text: "Implement run-phase orchestration.", sources: [{ path: "prd.md" }] }],
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [
        {
          id: "P11-T2",
          source_requirement_ids: ["REQ-1"],
          expected_behavior: "One run-phase path advances through required gates.",
          relevant_context: ["packages/core/src/runs"],
          likely_change_areas: ["packages/core/src/runs/orchestrate.ts"],
          test_strategy: ["bun test packages/core/tests/runs/orchestrate.test.ts"],
          integration_risks: ["Gate bypass"],
          done_criteria: ["Run-phase requires review and verification by default."],
          status: "pending",
        },
      ],
    });

    await orchestrateRunPhase({ rootDir, phaseId: "P11-T2" });
    const review = await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      executionEvidence: [
        {
          task_id: "task-1",
          evidence: {
            check_results: [{ command: "bun test packages/core/tests/runs/orchestrate.test.ts", status: "passed" }],
            changed_files: ["packages/core/src/runs/orchestrate.ts"],
          },
        },
      ],
    });
    await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      verificationRequestId:
        review.next_required?.kind === "review_verification_request" ? review.next_required.request_id : undefined,
      verificationResult: createVerificationResult("phase-P11-T2", "P11-T2"),
    });

    await executeVerificationScope({
      rootDir,
      scope: { kind: "phase", phase_id: "P11-T2" },
      reviewStatus: "passed",
      commandExecutor: async () => ({ ok: false, summary: "failed" }),
    });

    const result = await orchestrateRunPhase({ rootDir, phaseId: "P11-T2" });
    expect(result.stage).toBe("execution");
    expect(result.next_required).toEqual({
      kind: "execution_evidence",
      pending_task_ids: ["repair-P11-T2-test-1"],
    });
  });

  test("rejects verification payloads not bound to active run and phase", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, ".planning", "config.json"), { commit: { mode: "auto" } });
    await writeJsonFile(join(rootDir, ".planning", "requirements.json"), {
      requirements: [{ id: "REQ-1", text: "Implement run-phase orchestration.", sources: [{ path: "prd.md" }] }],
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [
        {
          id: "P11-T2",
          source_requirement_ids: ["REQ-1"],
          expected_behavior: "One run-phase path advances through required gates.",
          relevant_context: ["packages/core/src/runs"],
          likely_change_areas: ["packages/core/src/runs/orchestrate.ts"],
          test_strategy: ["bun test packages/core/tests/runs/orchestrate.test.ts"],
          integration_risks: ["Gate bypass"],
          done_criteria: ["Run-phase requires review and verification by default."],
          status: "pending",
        },
      ],
    });

    await orchestrateRunPhase({ rootDir, phaseId: "P11-T2" });
    const review = await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      executionEvidence: [
        {
          task_id: "task-1",
          evidence: {
            check_results: [{ command: "bun test packages/core/tests/runs/orchestrate.test.ts", status: "passed" }],
            changed_files: ["packages/core/src/runs/orchestrate.ts"],
          },
        },
      ],
    });

    await expect(
      orchestrateRunPhase({
        rootDir,
        phaseId: "P11-T2",
        verificationRequestId:
          review.next_required?.kind === "review_verification_request" ? review.next_required.request_id : undefined,
        verificationResult: {
          ...createVerificationResult("phase-P11-T2", "P11-T2"),
          id: "verify-other-run",
        },
      }),
    ).rejects.toThrow("not bound to active run");
  });

  test("requires run-bound review/verification request id", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, ".planning", "config.json"), { commit: { mode: "auto" } });
    await writeJsonFile(join(rootDir, ".planning", "requirements.json"), {
      requirements: [{ id: "REQ-1", text: "Implement run-phase orchestration.", sources: [{ path: "prd.md" }] }],
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [
        {
          id: "P11-T2",
          source_requirement_ids: ["REQ-1"],
          expected_behavior: "One run-phase path advances through required gates.",
          relevant_context: ["packages/core/src/runs"],
          likely_change_areas: ["packages/core/src/runs/orchestrate.ts"],
          test_strategy: ["bun test packages/core/tests/runs/orchestrate.test.ts"],
          integration_risks: ["Gate bypass"],
          done_criteria: ["Run-phase requires review and verification by default."],
          status: "pending",
        },
      ],
    });

    await orchestrateRunPhase({ rootDir, phaseId: "P11-T2" });
    const review = await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      executionEvidence: [
        {
          task_id: "task-1",
          evidence: {
            check_results: [{ command: "bun test packages/core/tests/runs/orchestrate.test.ts", status: "passed" }],
            changed_files: ["packages/core/src/runs/orchestrate.ts"],
          },
        },
      ],
    });
    expect(review.stage).toBe("review");

    await expect(
      orchestrateRunPhase({
        rootDir,
        phaseId: "P11-T2",
        verificationResult: createVerificationResult("phase-P11-T2", "P11-T2"),
      }),
    ).rejects.toThrow("requires issued request id");

    await expect(
      orchestrateRunPhase({
        rootDir,
        phaseId: "P11-T2",
        verificationRequestId: "wrong-request-id",
        verificationResult: createVerificationResult("phase-P11-T2", "P11-T2"),
      }),
    ).rejects.toThrow("does not match active run-bound request");
  });

  test("does not consume verification in the same call that completes execution", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeJsonFile(join(rootDir, ".planning", "config.json"), { commit: { mode: "auto" } });
    await writeJsonFile(join(rootDir, ".planning", "requirements.json"), {
      requirements: [{ id: "REQ-1", text: "Implement run-phase orchestration.", sources: [{ path: "prd.md" }] }],
    });
    await writeJsonFile(join(rootDir, ".planning", "phases.json"), {
      phases: [
        {
          id: "P11-T2",
          source_requirement_ids: ["REQ-1"],
          expected_behavior: "One run-phase path advances through required gates.",
          relevant_context: ["packages/core/src/runs"],
          likely_change_areas: ["packages/core/src/runs/orchestrate.ts"],
          test_strategy: ["bun test packages/core/tests/runs/orchestrate.test.ts"],
          integration_risks: ["Gate bypass"],
          done_criteria: ["Run-phase requires review and verification by default."],
          status: "pending",
        },
      ],
    });

    await orchestrateRunPhase({ rootDir, phaseId: "P11-T2" });
    const result = await orchestrateRunPhase({
      rootDir,
      phaseId: "P11-T2",
      executionEvidence: [
        {
          task_id: "task-1",
          evidence: {
            check_results: [{ command: "bun test packages/core/tests/runs/orchestrate.test.ts", status: "passed" }],
            changed_files: ["packages/core/src/runs/orchestrate.ts"],
          },
        },
      ],
      verificationRequestId: "ignored-same-call-request",
      verificationResult: createVerificationResult("phase-P11-T2", "P11-T2"),
    });

    expect(result.stage).toBe("review");
    expect(result.commit_gate).toBeNull();
    expect(result.next_required?.kind).toBe("review_verification_request");
  });
});
