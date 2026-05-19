export const corePackageName = "@phasekit/core" as const;

export function describeCorePackage(): { name: typeof corePackageName } {
  return { name: corePackageName };
}

export {
  agentsMdManagedMarker,
  assertCanOverwriteAgentsMd,
  generateAgentsMd,
  isManagedAgentsMdContent,
} from "./artifacts/agents-md";
export type {
  AgentsMdProjectContext,
  GenerateAgentsMdOptions,
} from "./artifacts/agents-md";
export {
  generateAgentsMdArtifact,
} from "./artifacts/generate-agents-md";
export type {
  GenerateAgentsMdArtifactOptions,
} from "./artifacts/generate-agents-md";
export {
  defaultConfig,
} from "./config/defaults";
export {
  collectDocsFactSources,
  generateDocumentation,
} from "./docs/generate";
export type {
  DocsFactualityVerifier,
  GenerateDocumentationOptions,
  GenerateDocumentationResult,
} from "./docs/generate";
export {
  docsFactSourceKindSchema,
  docsFactSourceSchema,
  docsFactualityFindingSchema,
  docsFactualityFindingSeveritySchema,
  docsFactualityVerificationResultSchema,
  docsFactualityVerificationStatusSchema,
  docsTaskKindSchema,
  docsTaskSchema,
  docsWriterContextSchema,
  generatedDocDraftSchema,
  generatedDocSectionSchema,
  validateDocsFactualityResult,
  validateDocsTaskFactReferences,
  validateGeneratedDocDraftCitations,
} from "./docs/index";
export type {
  DocsFactSource,
  DocsFactSourceKind,
  DocsFactualityFinding,
  DocsFactualityFindingSeverity,
  DocsFactualityVerificationResult,
  DocsFactualityVerificationStatus,
  DocsTask,
  DocsTaskKind,
  DocsWriter,
  DocsWriterContext,
  GeneratedDocDraft,
  GeneratedDocSection,
  ValidateDocsFactualityResultOptions,
} from "./docs/index";
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
  verificationCommandConfigSchema,
  verificationCommandKindSchema,
  verificationConfigSchema,
  verifyPolicySchema,
} from "./config/schema";
export type {
  PhasekitConfig,
  PhasekitConfigOverride,
  VerificationCommandConfig,
  VerificationCommandKind,
  VerificationConfig,
} from "./config/schema";
export {
  confirmStackQuestionAnswer,
  confirmStackDecision,
  createConfirmedStackContexts,
  createStackQuestion,
  decideStack,
  detectGreenfieldProject,
  writeConfirmedProjectStack,
} from "./greenfield/index";
export type {
  ConfirmedStackContext,
  ConfirmedStackContextBundle,
  ConfirmedStackDecision,
  DecideStackOptions,
  DetectGreenfieldProjectOptions,
  GreenfieldDetection,
  GreenfieldRepositoryInput,
  StackQuestionAnswer,
  StackDecision,
  StackDecisionBlocker,
  StackDeclaration,
} from "./greenfield/index";
export {
  commitChangeKindSchema,
  commitGateInputSchema,
  evaluateCommitGate,
} from "./git/policy";
export type {
  CommitChangeKind,
  CommitGateBlocker,
  CommitGateBlockerCode,
  CommitGateDecision,
  CommitGateInput,
} from "./git/policy";
export {
  expandIngestPaths,
} from "./ingest/paths";
export type {
  ExpandIngestPathsOptions,
  IngestTextInput,
} from "./ingest/paths";
export {
  addPhaseFromGoal,
  extractRequirementsFromSupportedText,
  ingestProjectInputs,
  sliceRequirementsIntoPhases,
} from "./ingest/project";
export type {
  AddPhaseFromGoalOptions,
  AddPhaseFromGoalResult,
  IngestProjectOptions,
  IngestProjectResult,
} from "./ingest/project";
export {
  assignSourceRequirementIds,
  extractSourceRequirements,
} from "./ingest/requirements";
export type {
  AssignRequirementIdsOptions,
  ExtractSourceRequirementsOptions,
  IngestContext,
  RequirementExtractor,
  SourceRequirementCandidate,
  SourceRequirementSource,
} from "./ingest/requirements";
export {
  addRule,
  editRule,
  removeRule,
  validateRulesState,
} from "./rules/index";
export type {
  AddRuleOptions,
  EditRuleOptions,
  RemoveRuleOptions,
} from "./rules/index";
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
  createPhaseRun,
  readRunState,
  runIdForPhase,
  writeRunState,
} from "./runs/persistence";
export type {
  CreateRunOptions,
  CreateRunResult,
} from "./runs/persistence";
export {
  orchestrateRunPhase,
} from "./runs/orchestrate";
export type {
  RunPhaseOrchestrationInput,
  RunPhaseOrchestrationResult,
} from "./runs/orchestrate";
export {
  isBehaviorAddingTask,
  taskPlanCheckSchema,
  taskPlanSchema,
  taskPlanTaskSchema,
  taskPlanValidatorOptionsSchema,
  validateTaskPlan,
} from "./runs/tasks";
export type {
  TaskPlan,
  TaskPlanCheck,
  TaskPlanTask,
  TaskPlanValidatorOptions,
} from "./runs/tasks";
export {
  advanceRunStage,
  claimRunTask,
  completeRunTask,
  recordRunBlocker,
  recordRunBlockerInputSchema,
  taskCompletionCheckResultSchema,
  taskCompletionEvidenceSchema,
} from "./runs/tools";
export type {
  AdvanceRunStageOptions,
  ClaimRunTaskOptions,
  CompleteRunTaskOptions,
  RecordRunBlockerInput,
  RecordRunBlockerOptions,
  TaskCompletionCheckResult,
  TaskCompletionEvidence,
} from "./runs/tools";
export {
  writeGeneratedArtifact,
} from "./artifacts/write";
export type {
  ManagedConfigArtifactPolicy,
  WriteGeneratedArtifactOptions,
  WriteGeneratedArtifactResult,
} from "./artifacts/write";
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
  discoverVerificationCommands,
  verificationCommandKinds,
} from "./verify/commands";
export type {
  DiscoverVerificationCommandsOptions,
  PackageManager,
  PackageMetadataInput,
  VerificationCommand,
  VerificationCommandSource,
} from "./verify/commands";
export {
  verificationBlockerSchema,
  verificationCheckStatusSchema,
  verificationCommandEvidenceSchema,
  verificationCommandEvidenceStatusSchema,
  verificationFailureSourceSchema,
  verificationFindingSchema,
  verificationFindingSeveritySchema,
  verificationIntegrationRiskSchema,
  verificationIntegrationRiskStatusSchema,
  verificationMissingCheckProposalSchema,
  verificationOutputReferenceSchema,
  verificationResultSchema,
  verificationResultStatusSchema,
  verifyAllScopeSchema,
  verifyGroupScopeSchema,
  verifyPhaseScopeSchema,
  verifyScopeSchema,
  verifyTaskScopeSchema,
} from "./verify/schemas";
export type {
  VerificationBlocker,
  VerificationCheckStatus,
  VerificationCommandEvidence,
  VerificationCommandEvidenceStatus,
  VerificationFailureSource,
  VerificationFinding,
  VerificationFindingSeverity,
  VerificationIntegrationRisk,
  VerificationIntegrationRiskStatus,
  VerificationMissingCheckProposal,
  VerificationOutputReference,
  VerificationResult,
  VerificationResultStatus,
  VerifyAllScope,
  VerifyGroupScope,
  VerifyPhaseScope,
  VerifyScope,
  VerifyTaskScope,
} from "./verify/schemas";
export {
  executeVerificationScope,
} from "./verify/execute";
export type {
  VerifyScopeExecutionInput,
} from "./verify/execute";
export {
  prepareVerificationScope,
} from "./verify/scope";
export type {
  PreparedVerifyScope,
} from "./verify/scope";
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
  Rule,
  RulesState,
  RunState,
  SourceReference,
} from "./state/schema";
