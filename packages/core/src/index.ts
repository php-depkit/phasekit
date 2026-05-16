export const corePackageName = "@phasekit/core" as const;

export function describeCorePackage(): { name: typeof corePackageName } {
  return { name: corePackageName };
}

export {
  defaultConfig,
} from "./config/defaults";
export {
  loadPhasekitConfig,
} from "./config/loader";
export type {
  LoadPhasekitConfigOptions,
} from "./config/loader";
export {
  commitModeSchema,
  phasekitConfigOverrideSchema,
  phasekitConfigSchema,
  reviewPolicySchema,
  verifyPolicySchema,
} from "./config/schema";
export type { PhasekitConfig, PhasekitConfigOverride } from "./config/schema";
export {
  confirmStackDecision,
  decideStack,
  detectGreenfieldProject,
  writeConfirmedProjectStack,
} from "./greenfield/index";
export type {
  ConfirmedStackDecision,
  DecideStackOptions,
  DetectGreenfieldProjectOptions,
  GreenfieldDetection,
  GreenfieldRepositoryInput,
  StackDecision,
  StackDecisionBlocker,
  StackDeclaration,
} from "./greenfield/index";
export {
  expandIngestPaths,
} from "./ingest/paths";
export type {
  ExpandIngestPathsOptions,
  IngestTextInput,
} from "./ingest/paths";
export {
  assignSourceRequirementIds,
  extractSourceRequirements,
} from "./ingest/requirements";
export type {
  AssignRequirementIdsOptions,
  ExtractSourceRequirementsOptions,
  RequirementExtractor,
  SourceRequirementCandidate,
  SourceRequirementSource,
} from "./ingest/requirements";
export {
  allowedRunStageTransitions,
  getAllowedNextRunStages,
  runBlockerSchema,
  runStageSchema,
  runStages,
  validateRunStageTransition,
} from "./runs/lifecycle";
export type {
  RunBlocker,
  RunStage,
  RunStageTransition,
  RunStageTransitionInput,
} from "./runs/lifecycle";
export {
  toPhasesState,
  validateGrillMeQuestionAnswer,
  validateGrillMeQuestion,
  validatePhaseSlices,
  validateRequirementCoverage,
} from "./planning/slices";
export type {
  CodebaseContextScoutInput,
  CodebaseContextScoutResult,
  ContextScout,
  GrillMeAnsweredQuestion,
  GrillMeCustomAnswer,
  GrillMeQuestion,
  GrillMeQuestionAnswer,
  GrillMeQuestionOption,
  GrillMeSelectedRecommendedOption,
  PhaseCoverageReference,
  PhaseSlice,
  PhaseSlicer,
  RequirementCoverageBlocker,
  SliceSourceRequirementsInput,
  ValidateRequirementCoverageOptions,
} from "./planning/slices";
export {
  getNextAction,
  getStatus,
} from "./status/index";
export type {
  GetStatusOptions,
  NextAction,
  NextActionKind,
  PhasekitStatus,
  StatusPhase,
  StatusPlan,
  StatusProject,
  StatusRun,
  StatusRunState,
  StatusStateInput,
} from "./status/index";
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
  runStageTransitionSchema,
  runStateSchema,
  runTaskSchema,
  sourceReferenceSchema,
} from "./state/schema";
export type {
  PhaseStatus,
  PhasesState,
  ProjectState,
  Requirement,
  RequirementsState,
  RulesState,
  RunState,
  SourceReference,
} from "./state/schema";
