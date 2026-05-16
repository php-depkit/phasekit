import type { PhaseStatus, PhasesState, Requirement } from "../state/schema";

export interface CodebaseContextScoutInput {
  rootPath: string;
  requirementIds: readonly string[];
  confirmed_stack?: string;
}

export interface CodebaseContextScoutResult {
  patterns: readonly string[];
  tests: readonly string[];
  routes: readonly string[];
  schemas: readonly string[];
  conventions: readonly string[];
  integrationRisks: readonly string[];
}

export type ContextScout = (
  input: CodebaseContextScoutInput,
) => CodebaseContextScoutResult | Promise<CodebaseContextScoutResult>;

export interface GrillMeQuestionOption {
  id: string;
  text: string;
  recommended: boolean;
}

export interface GrillMeCustomAnswer {
  enabled: true;
  label: string;
}

export interface GrillMeQuestion {
  id: string;
  requirement_ids: readonly string[];
  prompt: string;
  options: readonly GrillMeQuestionOption[];
  custom_answer: GrillMeCustomAnswer;
}

export interface GrillMeAnsweredQuestion {
  id: string;
  prompt: string;
}

export interface GrillMeSelectedRecommendedOption {
  id: string;
  text: string;
}

export type GrillMeQuestionAnswer =
  | {
      question: GrillMeAnsweredQuestion;
      requirement_ids: readonly string[];
      selected_recommended_option: GrillMeSelectedRecommendedOption;
      custom_answer_text?: never;
    }
  | {
      question: GrillMeAnsweredQuestion;
      requirement_ids: readonly string[];
      selected_recommended_option?: never;
      custom_answer_text: string;
    };

export interface PhaseSlice {
  id: string;
  source_requirement_ids: readonly string[];
  expected_behavior: string;
  relevant_context: readonly string[];
  likely_change_areas: readonly string[];
  test_strategy: readonly string[];
  integration_risks: readonly string[];
  done_criteria: readonly string[];
}

export interface SliceSourceRequirementsInput {
  requirements: readonly Requirement[];
  context: CodebaseContextScoutResult;
  answeredQuestions: readonly GrillMeQuestionAnswer[];
  confirmed_stack?: string;
}

export type PhaseSlicer = (
  input: SliceSourceRequirementsInput,
) => PhaseSlice[] | Promise<PhaseSlice[]>;

export interface RequirementCoverageBlocker {
  requirement_ids: readonly string[];
  reason: string;
  next_step: string;
}

export interface ValidateRequirementCoverageOptions {
  requirements: readonly Requirement[];
  phases: readonly PhaseCoverageReference[];
  blockers?: readonly RequirementCoverageBlocker[];
  questions?: readonly GrillMeQuestion[];
}

export type PhaseCoverageReference = PhaseSlice | PhasesState["phases"][number];

export function validateGrillMeQuestion(question: GrillMeQuestion): GrillMeQuestion {
  requireNonEmpty(question.id, "Question ID");
  requireNonEmpty(question.prompt, `Question ${question.id} prompt`);

  if (question.requirement_ids.length === 0) {
    throw new Error(`Question ${question.id} must reference at least one requirement.`);
  }

  if (question.options.length === 0) {
    throw new Error(`Question ${question.id} must include a recommended option.`);
  }

  const recommendedOptions = question.options.filter((option) => option.recommended);
  if (recommendedOptions.length !== 1) {
    throw new Error(`Question ${question.id} must include exactly one recommended option.`);
  }

  if (question.custom_answer.enabled !== true) {
    throw new Error(`Question ${question.id} must allow a custom answer.`);
  }

  requireNonEmpty(question.custom_answer.label, `Question ${question.id} custom answer label`);
  validateUniqueReferences(
    question.options.map((option) => option.id),
    `Question ${question.id} option`,
  );

  for (const option of question.options) {
    requireNonEmpty(option.id, `Question ${question.id} option ID`);
    requireNonEmpty(option.text, `Question ${question.id} option ${option.id}`);
  }

  return question;
}

export function validateGrillMeQuestionAnswer(answer: GrillMeQuestionAnswer): GrillMeQuestionAnswer {
  requireNonEmpty(answer.question.id, "Answered question ID");
  requireNonEmpty(answer.question.prompt, `Answered question ${answer.question.id} prompt`);
  requireNonEmptyArray(answer.requirement_ids, `Answered question ${answer.question.id} requirements`);

  const rawAnswer = answer as {
    selected_recommended_option?: GrillMeSelectedRecommendedOption;
    custom_answer_text?: string;
  };
  const selectedOption = rawAnswer.selected_recommended_option;
  const customAnswerText = rawAnswer.custom_answer_text;

  if (selectedOption !== undefined && customAnswerText !== undefined) {
    throw new Error(`Answered question ${answer.question.id} must choose either a recommended option or a custom answer, not both.`);
  }

  if (selectedOption === undefined && customAnswerText === undefined) {
    throw new Error(`Answered question ${answer.question.id} must include a recommended option or custom answer.`);
  }

  if (selectedOption !== undefined) {
    requireNonEmpty(selectedOption.id, `Answered question ${answer.question.id} selected recommended option ID`);
    requireNonEmpty(selectedOption.text, `Answered question ${answer.question.id} selected recommended option`);
  }

  if (customAnswerText !== undefined) {
    requireNonEmpty(customAnswerText, `Answered question ${answer.question.id} custom answer`);
  }

  return answer;
}

export function validatePhaseSlices(slices: readonly PhaseSlice[]): readonly PhaseSlice[] {
  validateUniqueReferences(
    slices.map((slice) => slice.id),
    "Phase slice",
  );

  for (const slice of slices) {
    requireNonEmpty(slice.id, "Phase slice ID");
    requireNonEmpty(slice.expected_behavior, `Phase slice ${slice.id} expected behavior`);
    requireNonEmptyArray(slice.source_requirement_ids, `Phase slice ${slice.id} source requirements`);
    requireNonEmptyArray(slice.test_strategy, `Phase slice ${slice.id} test strategy`);
    requireNonEmptyArray(slice.done_criteria, `Phase slice ${slice.id} done criteria`);
  }

  return slices;
}

export function toPhasesState(slices: readonly PhaseSlice[], status: PhaseStatus = "pending"): PhasesState {
  validatePhaseSlices(slices);

  return {
    phases: slices.map((slice) => ({
      id: slice.id,
      source_requirement_ids: [...slice.source_requirement_ids],
      expected_behavior: slice.expected_behavior,
      relevant_context: [...slice.relevant_context],
      likely_change_areas: [...slice.likely_change_areas],
      test_strategy: [...slice.test_strategy],
      integration_risks: [...slice.integration_risks],
      done_criteria: [...slice.done_criteria],
      status,
    })),
  };
}

export function validateRequirementCoverage(options: ValidateRequirementCoverageOptions): void {
  const requirementIds = options.requirements.map((requirement) => requirement.id);
  validateUniqueReferences(requirementIds, "Requirement");
  validatePhaseSlices(options.phases);

  const knownRequirementIds = new Set(requirementIds);
  const phaseRequirementIds = collectReferencedRequirementIds(options.phases, "phase");
  const blockerRequirementIds = collectReferencedRequirementIds(options.blockers ?? [], "blocker");
  const questionRequirementIds = collectReferencedRequirementIds(options.questions ?? [], "question");

  rejectUnknownRequirementReferences(knownRequirementIds, phaseRequirementIds, "phase");
  rejectUnknownRequirementReferences(knownRequirementIds, blockerRequirementIds, "blocker");
  rejectUnknownRequirementReferences(knownRequirementIds, questionRequirementIds, "question");

  for (const question of options.questions ?? []) {
    validateGrillMeQuestion(question);
  }

  for (const blocker of options.blockers ?? []) {
    requireNonEmpty(blocker.reason, "Requirement coverage blocker reason");
    requireNonEmpty(blocker.next_step, "Requirement coverage blocker next step");
  }

  const answeredBeforeImplementation = new Set([...blockerRequirementIds, ...questionRequirementIds]);
  const assumedRequirementIds = [...phaseRequirementIds].filter((id) => answeredBeforeImplementation.has(id));
  if (assumedRequirementIds.length > 0) {
    throw new Error(
      `Requirement coverage cannot assume implementation for blocked or questioned requirements: ${assumedRequirementIds.join(", ")}.`,
    );
  }

  const coveredRequirementIds = new Set([
    ...phaseRequirementIds,
    ...blockerRequirementIds,
    ...questionRequirementIds,
  ]);
  const uncoveredRequirementIds = [...knownRequirementIds].filter((id) => !coveredRequirementIds.has(id));
  if (uncoveredRequirementIds.length > 0) {
    throw new Error(`Requirements missing phase, blocker, or question coverage: ${uncoveredRequirementIds.join(", ")}.`);
  }
}

function collectReferencedRequirementIds(
  references: readonly { requirement_ids?: readonly string[]; source_requirement_ids?: readonly string[] }[],
  label: string,
): Set<string> {
  const requirementIds = new Set<string>();

  for (const reference of references) {
    const ids = reference.source_requirement_ids ?? reference.requirement_ids ?? [];
    if (ids.length === 0) {
      throw new Error(`Requirement coverage ${label} reference must include at least one requirement ID.`);
    }

    for (const id of ids) {
      requireNonEmpty(id, `Requirement coverage ${label} requirement ID`);
      requirementIds.add(id);
    }
  }

  return requirementIds;
}

function rejectUnknownRequirementReferences(knownIds: ReadonlySet<string>, referencedIds: ReadonlySet<string>, label: string): void {
  const unknownIds = [...referencedIds].filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) {
    throw new Error(`Requirement coverage ${label} references unknown requirements: ${unknownIds.join(", ")}.`);
  }
}

function validateUniqueReferences(values: readonly string[], label: string): void {
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label} ID ${value}.`);
    }
    seen.add(value);
  }
}

function requireNonEmpty(value: string, label: string): void {
  if (value.trim() === "") {
    throw new Error(`${label} must not be empty.`);
  }
}

function requireNonEmptyArray(values: readonly string[] | undefined, label: string): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} must include at least one value.`);
  }

  for (const value of values) {
    requireNonEmpty(value, label);
  }
}
