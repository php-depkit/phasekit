import { parseStateFile } from "../state/parse";
import { verifyScopeSchema, type VerifyScope } from "./schemas";

export type PreparedVerifyScope = {
  scope: VerifyScope;
  scope_id: string;
  verifier_instructions: string[];
  approved_check_policy: {
    command_execution: "not_started";
    run_approved_checks_only: true;
    missing_checks_require_approval: true;
  };
  repair_policy: {
    focused_repair_only: true;
    repair_persistence: "not_implemented";
  };
};

export function prepareVerificationScope(scopeInput: unknown): PreparedVerifyScope {
  const scope = parseStateFile("verification-scope.json", verifyScopeSchema, scopeInput);

  return {
    scope,
    scope_id: verificationScopeId(scope),
    verifier_instructions: [
      "Verify the requested scope against linked requirements and whole-project integration risks.",
      "Run or inspect only checks already approved for this project scope.",
      "If a missing check is needed, propose it for approval before broadening verification scope.",
      "Do not execute shell commands, write verification result files, mutate repositories, or persist repair-loop state from this preparation step.",
    ],
    approved_check_policy: {
      command_execution: "not_started",
      run_approved_checks_only: true,
      missing_checks_require_approval: true,
    },
    repair_policy: {
      focused_repair_only: true,
      repair_persistence: "not_implemented",
    },
  };
}

function verificationScopeId(scope: VerifyScope): string {
  switch (scope.kind) {
    case "task":
      return stableId(["task", scope.phase_id, scope.plan_id, scope.task_id]);
    case "phase":
      return stableId(["phase", scope.phase_id]);
    case "group":
      return stableId(["group", scope.group_id ?? scope.phase_ids.join("+")]);
    case "all":
      return "all";
  }
}

function stableId(parts: string[]): string {
  return parts.map((part) => part.replace(/[^A-Za-z0-9._-]+/g, "-")).join("-");
}
