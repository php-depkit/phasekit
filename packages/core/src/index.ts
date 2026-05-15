export const corePackageName = "@phasekit/core" as const;

export function describeCorePackage(): { name: typeof corePackageName } {
  return { name: corePackageName };
}

export {
  defaultConfig,
} from "./config/defaults";
export {
  commitModeSchema,
  phasekitConfigSchema,
  reviewPolicySchema,
  verifyPolicySchema,
} from "./config/schema";
export type { PhasekitConfig } from "./config/schema";
export {
  defaultPhasesState,
  defaultProjectState,
  defaultRequirementsState,
  defaultRulesState,
} from "./state/defaults";
export {
  initializePlanningState,
} from "./state/init";
export type {
  InitializePlanningStateOptions,
  InitializePlanningStateResult,
} from "./state/init";
export {
  readJsonFile,
  toDeterministicJson,
  writeJsonFile,
} from "./state/json";
export {
  formatSchemaError,
  parseStateFile,
} from "./state/parse";
export {
  phaseSchema,
  phasesStateSchema,
  phaseStatusSchema,
  projectStateSchema,
  requirementSchema,
  requirementsStateSchema,
  ruleSchema,
  rulesStateSchema,
  runBlockerSchema,
  runStageTransitionSchema,
  runStateSchema,
  runTaskSchema,
  sourceReferenceSchema,
} from "./state/schema";
export type {
  PhasesState,
  ProjectState,
  RequirementsState,
  RulesState,
  RunState,
} from "./state/schema";
