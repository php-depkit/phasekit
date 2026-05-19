import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadPhasekitConfig } from "../config/loader";
import { parseStateFile } from "../state/parse";
import { phasesStateSchema } from "../state/schema";
import { readJsonFile, writeJsonFile } from "../state/json";
import { readRunState, writeRunState } from "../runs/persistence";
import { discoverVerificationCommands, type PackageManager, type VerificationCommand } from "./commands";
import { verificationResultSchema, verifyScopeSchema, type VerificationCommandEvidence, type VerificationMissingCheckProposal, type VerificationResult, type VerifyScope } from "./schemas";

export type VerifyScopeExecutionInput = {
  rootDir?: string;
  scope: unknown;
  approvedMissingCheckIds?: string[];
  reviewStatus?: VerificationResult["review_status"];
  commandExecutor?: (command: string, cwd: string) => Promise<{ ok: boolean; summary: string }>;
  now?: Date;
};

export async function executeVerificationScope(input: VerifyScopeExecutionInput): Promise<VerificationResult> {
  const rootDir = input.rootDir ?? process.cwd();
  const scope = parseStateFile("verification-scope.json", verifyScopeSchema, input.scope);
  const scopeId = verificationScopeId(scope);
  const nowIso = (input.now ?? new Date()).toISOString();
  const { approvedCommands, discoveredCommands } = await loadApprovedCommands(rootDir);
  const approvedMissing = new Set(input.approvedMissingCheckIds ?? []);

  const missing_check_proposals: VerificationMissingCheckProposal[] = [];
  const command_evidence: VerificationCommandEvidence[] = [];
  let hasFailedCommand = false;

  for (const command of discoveredCommands) {
    const proposalId = `missing-check-${command.kind}`;
    if (!approvedMissing.has(proposalId)) {
      missing_check_proposals.push({
        id: proposalId,
        reason: `Verification check '${command.kind}' needs explicit approval before execution: ${command.confirmation_reasons.join("; ")}`,
        proposed_command: command.command,
        approval_required: true,
      });
      command_evidence.push({
        kind: command.kind,
        command: command.command,
        status: "skipped",
        output_references: [{ summary: `Skipped until command is explicitly approved for ${proposalId}.` }],
      });
      continue;
    }

    const started_at = new Date().toISOString();
    const outcome = await (input.commandExecutor ?? defaultCommandExecutor)(command.command, rootDir);
    const completed_at = new Date().toISOString();
    const status = outcome.ok ? "passed" : "failed";
    if (!outcome.ok) {
      hasFailedCommand = true;
    }
    command_evidence.push({
      kind: command.kind,
      command: command.command,
      status,
      output_references: [{ summary: outcome.summary }],
      started_at,
      completed_at,
    });
  }

  for (const command of approvedCommands) {
    const proposalId = `missing-check-${command.kind}`;
    if (command.requires_confirmation && !approvedMissing.has(proposalId)) {
      missing_check_proposals.push({
        id: proposalId,
        reason: `Verification check '${command.kind}' needs explicit approval before execution: ${command.confirmation_reasons.join("; ")}`,
        proposed_command: command.command,
        approval_required: true,
      });
      command_evidence.push({
        kind: command.kind,
        command: command.command,
        status: "skipped",
        output_references: [{ summary: `Skipped until approval for ${proposalId}.` }],
      });
      continue;
    }

    const started_at = new Date().toISOString();
    const outcome = await (input.commandExecutor ?? defaultCommandExecutor)(command.command, rootDir);
    const completed_at = new Date().toISOString();
    const status = outcome.ok ? "passed" : "failed";
    if (!outcome.ok) {
      hasFailedCommand = true;
    }
    command_evidence.push({
      kind: command.kind,
      command: command.command,
      status,
      output_references: [{ summary: outcome.summary }],
      started_at,
      completed_at,
    });
  }

  const { requirementIds, integrationRisks } = await deriveScopeLinks(rootDir, scope);
  const review_status: VerificationResult["review_status"] = input.reviewStatus === undefined
    ? "skipped"
    : input.reviewStatus;
  const blockedByReview = review_status !== "passed";
  const blockedByMissingChecks = missing_check_proposals.length > 0;
  const verification_status = blockedByMissingChecks
    ? "blocked"
    : hasFailedCommand
      ? "failed"
      : "passed";
  const status = verification_status === "passed" ? "passed" : verification_status === "failed" ? "failed" : "blocked";
  const persistedStatus = blockedByReview && status === "passed" ? "blocked" : status;
  const blockers = persistedStatus === "passed"
    ? []
    : [
      ...(blockedByReview && status === "passed"
        ? [{
          source: "review" as const,
          reason: "Review status was not recorded as passed for this verification result.",
          next_step: "Run review and persist a passed review status before treating verification as passed.",
        }]
        : []),
      ...(status !== "passed"
        ? [{
          source: "verification" as const,
          reason: blockedByMissingChecks
            ? "Verification is blocked pending approval for missing checks."
            : "One or more approved verification commands failed.",
          next_step: blockedByMissingChecks
            ? "Approve or reject missing verification checks before rerunning verification."
            : "Create focused repair tasks for failed verification evidence, then rerun verification.",
        }]
        : []),
    ];

  const result = verificationResultSchema.parse({
    id: `verify-${scopeId}`,
    scope,
    status: persistedStatus,
    review_status,
    verification_status,
    checked_at: nowIso,
    command_evidence,
    output_references: [{ path: `.planning/verifications/${scopeId}.json` }],
    findings: hasFailedCommand
      ? [{ source: "verification", severity: "failure", message: "At least one approved verification command failed." }]
      : [],
    blockers,
    linked_requirement_ids: requirementIds,
    integration_risks: integrationRisks,
    missing_check_proposals,
  });

  await writeJsonFile(join(rootDir, ".planning", "verifications", `${scopeId}.json`), result);
  await createFocusedRepairBlocker(rootDir, scope, result);
  return result;
}

async function defaultCommandExecutor(command: string, cwd: string): Promise<{ ok: boolean; summary: string }> {
  const proc = Bun.spawn(["bash", "-lc", command], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    ok: code === 0,
    summary: [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").slice(0, 500) || `exit code ${code}`,
  };
}

async function loadApprovedCommands(rootDir: string): Promise<{ approvedCommands: VerificationCommand[]; discoveredCommands: VerificationCommand[] }> {
  const config = await loadPhasekitConfig({ projectRoot: rootDir });
  const packageFile = join(rootDir, "package.json");
  let packageMetadata: { packageManager: PackageManager; scripts: Record<string, string> }[] = [];
  try {
    const pkg = JSON.parse(await readFile(packageFile, "utf8")) as { packageManager?: string; scripts?: Record<string, string> };
    const packageManager: PackageManager = pkg.packageManager?.startsWith("npm")
      ? "npm"
      : pkg.packageManager?.startsWith("pnpm")
        ? "pnpm"
        : pkg.packageManager?.startsWith("yarn")
          ? "yarn"
          : "bun";
    packageMetadata = [{ packageManager, scripts: pkg.scripts ?? {} }];
  } catch {
    packageMetadata = [];
  }

  const discoveredOrConfigured = discoverVerificationCommands({ config: config.verification, packageMetadata });

  const approvedCommands: VerificationCommand[] = [];
  const discoveredCommands: VerificationCommand[] = [];

  for (const command of discoveredOrConfigured) {
    if (command.source === "configured") {
      approvedCommands.push(command);
      continue;
    }

    const reasons = new Set(command.confirmation_reasons);
    reasons.add("discovered command is not explicitly approved in verification config");
    discoveredCommands.push({
      ...command,
      requires_confirmation: true,
      confirmation_reasons: [...reasons],
    });
  }

  return { approvedCommands, discoveredCommands };
}

function verificationScopeId(scope: VerifyScope): string {
  switch (scope.kind) {
    case "task":
      return `task-${scope.phase_id}-${scope.plan_id}-${scope.task_id}`;
    case "phase":
      return `phase-${scope.phase_id}`;
    case "group":
      return `group-${scope.group_id ?? scope.phase_ids.join("-")}`;
    case "all":
      return "all";
  }
}

async function deriveScopeLinks(rootDir: string, scope: VerifyScope): Promise<{ requirementIds: string[]; integrationRisks: VerificationResult["integration_risks"] }> {
  const phases = await readJsonFile(join(rootDir, ".planning", "phases.json"), phasesStateSchema);
  const phaseIds = scope.kind === "phase"
    ? [scope.phase_id]
    : scope.kind === "task"
      ? [scope.phase_id]
      : scope.kind === "group"
        ? scope.phase_ids
        : phases.phases.map((phase) => phase.id);
  const selected = phases.phases.filter((phase) => phaseIds.includes(phase.id));
  const requirementIds = [...new Set(selected.flatMap((phase) => phase.source_requirement_ids))].sort();
  const integrationRisks = [...new Set(selected.flatMap((phase) => phase.integration_risks))].map((description, index) => ({
    id: `risk-${index + 1}`,
    description,
    status: "covered" as const,
  }));
  return { requirementIds, integrationRisks };
}

async function createFocusedRepairBlocker(rootDir: string, scope: VerifyScope, result: VerificationResult): Promise<void> {
  if (result.status !== "failed") {
    return;
  }
  if (scope.kind !== "phase" && scope.kind !== "task") {
    return;
  }
  const runId = `phase-${scope.phase_id}`;
  try {
    const run = await readRunState(rootDir, runId);
    const failedEvidence = result.command_evidence.filter((evidence) => evidence.status === "failed");
    const existingTaskIds = new Set(run.claimed_tasks.map((task) => task.id));
    const repairTasks = (failedEvidence.length > 0 ? failedEvidence : [{ kind: "verification", command: "phasekit_verify_scope" }])
      .map((evidence, index) => ({
        id: `repair-${scope.phase_id}-${evidence.kind}-${index + 1}`,
        evidence,
      }))
      .filter((task) => !existingTaskIds.has(task.id))
      .map((task) => ({ id: task.id }));
    await writeRunState(rootDir, {
      ...run,
      current_stage: "execution",
      claimed_tasks: [...run.claimed_tasks, ...repairTasks],
      blockers: [],
      issued_verification_request: undefined,
    });
  } catch {
    // no active run for this phase; keep persisted verification result only
  }
}
