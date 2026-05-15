import type { IngestTextInput } from "./paths";
import {
  requirementsStateSchema,
  type Requirement,
  type RequirementsState,
  type SourceReference,
} from "../state/schema";

const requirementIdPrefix = "REQ-";
const requirementIdPattern = /^REQ-([1-9]\d*)$/;

export interface SourceRequirementSource extends SourceReference {
  locator: string;
}

export interface SourceRequirementCandidate {
  text: string;
  sources: readonly SourceRequirementSource[];
}

interface RequirementIdentityInput {
  text: string;
  sources: readonly SourceReference[];
}

export type RequirementExtractor = (
  inputs: readonly IngestTextInput[],
) => SourceRequirementCandidate[] | Promise<SourceRequirementCandidate[]>;

export interface ExtractSourceRequirementsOptions {
  inputs: readonly IngestTextInput[];
  extractor: RequirementExtractor;
  existingState?: RequirementsState;
}

export interface AssignRequirementIdsOptions {
  candidates: readonly SourceRequirementCandidate[];
  existingState?: RequirementsState;
}

export async function extractSourceRequirements(
  options: ExtractSourceRequirementsOptions,
): Promise<RequirementsState> {
  const candidates = await options.extractor(options.inputs);

  return assignSourceRequirementIds({
    candidates,
    existingState: options.existingState,
  });
}

export function assignSourceRequirementIds(options: AssignRequirementIdsOptions): RequirementsState {
  const existingRequirements = options.existingState?.requirements ?? [];
  validateExistingRequirements(existingRequirements);
  validateCandidates(options.candidates);

  const existingIdsByIdentity = new Map(
    existingRequirements.map((requirement) => [toRequirementIdentity(requirement), requirement.id]),
  );
  let nextRequirementNumber = getNextRequirementNumber(existingRequirements);

  const requirements = [...options.candidates]
    .sort(compareCandidates)
    .map((candidate) => {
      const identity = toRequirementIdentity(candidate);
      const id = existingIdsByIdentity.get(identity) ?? `${requirementIdPrefix}${nextRequirementNumber++}`;
      existingIdsByIdentity.delete(identity);

      return {
        id,
        text: candidate.text,
        sources: candidate.sources.map((source) => ({ ...source })),
      };
    });

  return requirementsStateSchema.parse({ requirements });
}

function compareCandidates(left: SourceRequirementCandidate, right: SourceRequirementCandidate): number {
  return compareSourceReferenceArrays(left.sources, right.sources)
    || compareStrings(left.text, right.text);
}

function compareSourceReferenceArrays(left: readonly SourceReference[], right: readonly SourceReference[]): number {
  const leftSources = [...left].sort(compareSourceReferences);
  const rightSources = [...right].sort(compareSourceReferences);
  const length = Math.max(leftSources.length, rightSources.length);

  for (let index = 0; index < length; index++) {
    const leftSource = leftSources[index];
    const rightSource = rightSources[index];

    if (leftSource === undefined) {
      return -1;
    }

    if (rightSource === undefined) {
      return 1;
    }

    const sourceOrder = compareSourceReferences(leftSource, rightSource);
    if (sourceOrder !== 0) {
      return sourceOrder;
    }
  }

  return 0;
}

function compareSourceReferences(left: SourceReference, right: SourceReference): number {
  return compareStrings(left.path, right.path) || compareLocators(left.locator ?? "", right.locator ?? "");
}

function compareLocators(left: string, right: string): number {
  const leftLine = /^line:(\d+)$/.exec(left);
  const rightLine = /^line:(\d+)$/.exec(right);

  if (leftLine !== null && rightLine !== null) {
    return Number(leftLine[1]) - Number(rightLine[1]);
  }

  return compareStrings(left, right);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function getNextRequirementNumber(requirements: readonly Requirement[]): number {
  const highestExistingNumber = requirements.reduce((highest, requirement) => {
    const match = requirementIdPattern.exec(requirement.id);
    if (match === null) {
      return highest;
    }

    return Math.max(highest, Number(match[1]));
  }, 0);

  return highestExistingNumber + 1;
}

function validateExistingRequirements(requirements: readonly Requirement[]): void {
  const seenIds = new Set<string>();
  const seenIdentities = new Set<string>();

  for (const requirement of requirements) {
    if (!requirementIdPattern.test(requirement.id)) {
      throw new Error(`Existing requirement ID ${requirement.id} is invalid; expected ${requirementIdPrefix}<number>.`);
    }

    if (seenIds.has(requirement.id)) {
      throw new Error(`Duplicate existing requirement ID ${requirement.id}.`);
    }
    seenIds.add(requirement.id);

    for (const source of requirement.sources) {
      if (source.locator === undefined || source.locator.trim() === "") {
        throw new Error(`Existing requirement ${requirement.id} source ${source.path} must include a locator.`);
      }
    }

    const identity = toRequirementIdentity(requirement);
    if (seenIdentities.has(identity)) {
      throw new Error(`Duplicate existing source requirement mapping for ${requirement.id}.`);
    }
    seenIdentities.add(identity);
  }
}

function validateCandidates(candidates: readonly SourceRequirementCandidate[]): void {
  for (const candidate of candidates) {
    for (const source of candidate.sources) {
      if (source.locator.trim() === "") {
        throw new Error(`Source requirement candidate for ${source.path} must include a locator.`);
      }
    }
  }
}

function toRequirementIdentity(requirement: RequirementIdentityInput): string {
  return JSON.stringify({
    text: requirement.text,
    sources: toSourcesIdentity(requirement.sources),
  });
}

function toSourcesIdentity(sources: readonly SourceReference[]): string {
  return JSON.stringify([...sources].sort(compareSourceReferences));
}
