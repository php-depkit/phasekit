import { readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

import type { ContextScout, PhaseSlicer, SliceSourceRequirementsInput } from "../planning/slices";
import { toPhasesState, validateRequirementCoverage } from "../planning/slices";
import { defaultPhasesState, defaultProjectState, defaultRequirementsState } from "../state/defaults";
import { readJsonFile, writeJsonFile } from "../state/json";
import { phasesStateSchema, projectStateSchema, requirementsStateSchema, type PhasesState, type ProjectState, type RequirementsState } from "../state/schema";
import { expandIngestPaths, type IngestTextInput } from "./paths";
import { extractSourceRequirements, type IngestContext, type RequirementExtractor } from "./requirements";

const ignoredDirectoryNames = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo", ".cache"]);
const ignoredPlanningNames = new Set(["cache", "tmp", "locks", "runs", "verifications"]);

export interface IngestProjectOptions {
  rootDir: string;
  inputPaths: string[];
  extractor?: RequirementExtractor;
  scout?: ContextScout;
  slicer?: PhaseSlicer;
}

export interface IngestProjectResult {
  inputs: IngestTextInput[];
  requirements: RequirementsState;
  phases: PhasesState;
}

export interface AddPhaseFromGoalOptions {
  rootDir: string;
  goal: string;
  scout?: ContextScout;
  slicer?: PhaseSlicer;
}

export interface AddPhaseFromGoalResult {
  requirements: RequirementsState;
  phases: PhasesState;
  phase: PhasesState["phases"][number];
}

export async function ingestProjectInputs(options: IngestProjectOptions): Promise<IngestProjectResult> {
  const rootDir = resolve(options.rootDir);
  const planningDir = join(rootDir, ".planning");
  const [project, existingRequirements, existingPhases] = await Promise.all([
    readExistingProjectState(join(planningDir, "project.json")),
    readExistingRequirementsState(join(planningDir, "requirements.json")),
    readExistingPhasesState(join(planningDir, "phases.json")),
  ]);

  const inputs = await expandIngestPaths({ rootDir, inputPaths: options.inputPaths });
  const context = toIngestContext(project);
  const requirements = await extractSourceRequirements({
    inputs,
    existingState: existingRequirements,
    context,
    extractor: options.extractor ?? extractRequirementsFromSupportedText,
  });
  const scopedContext = await (options.scout ?? scoutCodebaseContext)({
    rootPath: rootDir,
    requirementIds: requirements.requirements.map((requirement) => requirement.id),
    confirmed_stack: context.confirmed_stack,
  });
  const slices = await (options.slicer ?? sliceRequirementsIntoPhases)({
    requirements: requirements.requirements,
    context: scopedContext,
    answeredQuestions: [],
    confirmed_stack: context.confirmed_stack,
  });
  validateRequirementCoverage({ requirements: requirements.requirements, phases: slices });

  const phases = preserveExistingPhaseStatuses(toPhasesState(slices), existingPhases);

  await Promise.all([
    writeJsonFile(join(planningDir, "requirements.json"), requirements),
    writeJsonFile(join(planningDir, "phases.json"), phases),
  ]);

  return {
    inputs,
    requirements,
    phases,
  };
}

export async function addPhaseFromGoal(options: AddPhaseFromGoalOptions): Promise<AddPhaseFromGoalResult> {
  const goal = options.goal.trim();
  if (goal === "") {
    throw new Error("Add-phase goal must not be empty.");
  }

  const rootDir = resolve(options.rootDir);
  const planningDir = join(rootDir, ".planning");
  const goalSourceRelativePath = toGoalSourceRelativePath(goal);
  const [project, existingRequirements, existingPhases] = await Promise.all([
    readExistingProjectState(join(planningDir, "project.json")),
    readExistingRequirementsState(join(planningDir, "requirements.json")),
    readExistingPhasesState(join(planningDir, "phases.json")),
  ]);

  const context = toIngestContext(project);
  const goalRequirements = await extractSourceRequirements({
    inputs: [{ path: join(rootDir, goalSourceRelativePath), relativePath: goalSourceRelativePath, text: goal }],
    existingState: existingRequirements,
    context,
    extractor: createGoalRequirementCandidates,
  });
  const requirements = mergeRequirements(existingRequirements, goalRequirements);
  const scopedContext = await (options.scout ?? scoutCodebaseContext)({
    rootPath: rootDir,
    requirementIds: goalRequirements.requirements.map((requirement) => requirement.id),
    confirmed_stack: context.confirmed_stack,
  });
  const slices = await (options.slicer ?? sliceRequirementsIntoPhases)({
    requirements: goalRequirements.requirements,
    context: scopedContext,
    answeredQuestions: [],
    confirmed_stack: context.confirmed_stack,
  });

  if (slices.length !== 1) {
    throw new Error(`Add-phase must produce exactly one phase; received ${slices.length}.`);
  }

  validateRequirementCoverage({ requirements: goalRequirements.requirements, phases: slices });

  const nextPhaseState = toPhasesState(slices);
  const nextPhase = nextPhaseState.phases[0];
  if (nextPhase === undefined) {
    throw new Error("Add-phase failed to produce a phase.");
  }

  const phases = mergeSinglePhase(existingPhases, nextPhase);
  validateRequirementCoverage({ requirements: requirements.requirements, phases: phases.phases });

  await Promise.all([
    writeJsonFile(join(planningDir, "requirements.json"), requirements),
    writeJsonFile(join(planningDir, "phases.json"), phases),
  ]);

  return {
    requirements,
    phases,
    phase: phases.phases.find((phase) => phase.id === nextPhase.id) ?? nextPhase,
  };
}

async function readExistingProjectState(filePath: string): Promise<ProjectState> {
  try {
    return await readJsonFile(filePath, projectStateSchema);
  } catch (error) {
    if (isMissingFileError(error)) {
      return defaultProjectState;
    }

    throw error;
  }
}

async function readExistingRequirementsState(filePath: string): Promise<RequirementsState> {
  try {
    return await readJsonFile(filePath, requirementsStateSchema);
  } catch (error) {
    if (isMissingFileError(error)) {
      return defaultRequirementsState;
    }

    throw error;
  }
}

async function readExistingPhasesState(filePath: string): Promise<PhasesState> {
  try {
    return await readJsonFile(filePath, phasesStateSchema);
  } catch (error) {
    if (isMissingFileError(error)) {
      return defaultPhasesState;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function toIngestContext(project: ProjectState): IngestContext {
  return typeof project.stack === "string" && project.stack.trim() !== ""
    ? { confirmed_stack: project.stack.trim() }
    : {};
}

function preserveExistingPhaseStatuses(nextState: PhasesState, existingState: PhasesState): PhasesState {
  const existingPhases = new Map(existingState.phases.map((phase) => [phase.id, phase] as const));

  return {
    phases: nextState.phases.map((phase) => ({
      ...phase,
      status: shouldPreservePhaseStatus(existingPhases.get(phase.id), phase)
        ? existingPhases.get(phase.id)?.status ?? phase.status
        : phase.status,
    })),
  };
}

function mergeSinglePhase(existingState: PhasesState, nextPhase: PhasesState["phases"][number]): PhasesState {
  const existingPhases = existingState.phases.filter((phase) => phase.id !== nextPhase.id);
  const priorMatch = existingState.phases.find((phase) => phase.id === nextPhase.id);

  existingPhases.push({
    ...nextPhase,
    status: shouldPreservePhaseStatus(priorMatch, nextPhase) ? priorMatch?.status ?? nextPhase.status : nextPhase.status,
  });

  return {
    phases: existingPhases,
  };
}

function mergeRequirements(existingState: RequirementsState, goalRequirements: RequirementsState): RequirementsState {
  const byId = new Map(existingState.requirements.map((requirement) => [requirement.id, requirement] as const));

  for (const requirement of goalRequirements.requirements) {
    byId.set(requirement.id, requirement);
  }

  return {
    requirements: [...byId.values()].sort((left, right) => compareRequirementIds(left.id, right.id)),
  };
}

function compareRequirementIds(left: string, right: string): number {
  const leftMatch = /^REQ-(\d+)$/.exec(left);
  const rightMatch = /^REQ-(\d+)$/.exec(right);

  if (leftMatch !== null && rightMatch !== null) {
    return Number(leftMatch[1]) - Number(rightMatch[1]);
  }

  return compareStrings(left, right);
}

function shouldPreservePhaseStatus(existingPhase: PhasesState["phases"][number] | undefined, nextPhase: PhasesState["phases"][number]): boolean {
  if (existingPhase === undefined) {
    return false;
  }

  return toPhaseIdentity(existingPhase) === toPhaseIdentity(nextPhase);
}

function toPhaseIdentity(phase: PhasesState["phases"][number]): string {
  return JSON.stringify({
    id: phase.id,
    source_requirement_ids: phase.source_requirement_ids,
    expected_behavior: phase.expected_behavior,
    done_criteria: phase.done_criteria,
  });
}

async function scoutCodebaseContext(input: { rootPath: string }): Promise<SliceSourceRequirementsInput["context"]> {
  const files = await collectWorkspaceFiles(input.rootPath, input.rootPath);
  const normalizedFiles = files.map((filePath) => toRelativePath(input.rootPath, filePath));
  const patterns = normalizedFiles.filter((filePath) => filePath.startsWith("packages/") || filePath.startsWith(".planning/")).slice(0, 12);
  const tests = normalizedFiles.filter((filePath) => filePath.endsWith(".test.ts") || filePath.endsWith(".test.tsx"));
  const routes = normalizedFiles.filter((filePath) => /route|routes/i.test(filePath));
  const schemas = normalizedFiles.filter((filePath) => /schema/i.test(filePath));
  const conventions = [
    ...(normalizedFiles.some((filePath) => filePath.startsWith("packages/")) ? ["Workspace code lives under packages/<name>."] : []),
    ...(tests.length > 0 ? ["Tests are colocated under package test directories and use bun:test."] : []),
    ...(normalizedFiles.includes("tsconfig.json") ? ["TypeScript project settings are centralized at the repo root."] : []),
  ];
  const integrationRisks = [
    ...(normalizedFiles.includes("packages/opencode/src/adapter.ts")
      ? ["Keep native OpenCode tool wiring thin and delegate product logic to @phasekit/core."]
      : []),
    ...(normalizedFiles.includes("packages/install/src/index.ts")
      ? ["Generated OpenCode command artifacts must stay thin wrappers around native tools."]
      : []),
    ...(normalizedFiles.some((filePath) => filePath.startsWith(".planning/"))
      ? ["Canonical shared state must remain deterministic .planning JSON."]
      : []),
  ];

  return {
    patterns,
    tests,
    routes,
    schemas,
    conventions,
    integrationRisks,
  };
}

async function collectWorkspaceFiles(rootDir: string, currentDir: string): Promise<string[]> {
  const entries = (await readdir(currentDir, { withFileTypes: true }))
    .slice()
    .sort((left, right) => compareStrings(left.name, right.name));
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);
    const relativePath = toRelativePath(rootDir, entryPath);

    if (entry.isDirectory()) {
      if (shouldIgnoreDirectory(relativePath)) {
        continue;
      }

      files.push(...await collectWorkspaceFiles(rootDir, entryPath));
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

function shouldIgnoreDirectory(relativePath: string): boolean {
  const segments = relativePath.split("/").filter(Boolean);

  if (segments.some((segment) => ignoredDirectoryNames.has(segment))) {
    return true;
  }

  const planningIndex = segments.indexOf(".planning");
  const planningChild = planningIndex === -1 ? undefined : segments[planningIndex + 1];
  return planningChild !== undefined && ignoredPlanningNames.has(planningChild);
}

function toRelativePath(rootDir: string, absolutePath: string): string {
  return relative(rootDir, absolutePath).split(sep).join("/");
}

export function extractRequirementsFromSupportedText(inputs: readonly IngestTextInput[]) {
  const candidates = inputs.flatMap((input) => {
    const structuredCandidates = extractRequirementsFromInput(input);
    return structuredCandidates.length > 0 ? structuredCandidates : extractPlainTextRequirementsFromInput(input);
  });

  if (candidates.length > 0) {
    return candidates;
  }

  throw new Error("No supported acceptance criteria, success criteria, or plain-text requirements were found in the provided ingest inputs.");
}

function extractRequirementsFromInput(input: IngestTextInput) {
  const lines = input.text.split(/\r?\n/);
  const candidates: {
    text: string;
    sources: readonly [{ path: string; locator: string }];
  }[] = [];
  let currentStoryLabel: string | null = null;
  let currentSectionLabel: string | null = null;

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();

    if (line.startsWith("**Story ") && line.endsWith("**")) {
      currentStoryLabel = line.replace(/^\*\*Story\s+\d+:\s*/, "").replace(/\*\*$/, "").trim();
      currentSectionLabel = null;
      continue;
    }

    if (line === "**Success Criteria:**") {
      currentSectionLabel = "Success Criteria";
      continue;
    }

    if (line === "Acceptance criteria:") {
      currentSectionLabel = currentStoryLabel;
      continue;
    }

    if (line.startsWith("## ") || line.startsWith("### ") || line === "### Non-Goals") {
      currentSectionLabel = null;
      continue;
    }

    if (!line.startsWith("- ") || currentSectionLabel === null) {
      continue;
    }

    const bulletText = line.slice(2).trim();
    if (bulletText === "") {
      continue;
    }

    candidates.push({
      text: `${currentSectionLabel}: ${bulletText}`,
      sources: [{ path: input.relativePath, locator: `line:${index + 1}` }],
    });
  }

  return candidates;
}

function extractPlainTextRequirementsFromInput(input: IngestTextInput) {
  return input.text
    .split(/\r?\n/)
    .map((rawLine, index) => ({ rawLine, index }))
    .filter(({ rawLine }) => {
      const line = rawLine.trim();
      return line !== "" && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("**");
    })
    .map(({ rawLine, index }) => ({
      text: `Ingested Requirements: ${rawLine.trim()}`,
      sources: [{ path: input.relativePath, locator: `line:${index + 1}` }] as const,
    }));
}

function createGoalRequirementCandidates(inputs: readonly IngestTextInput[]) {
  const goalInput = inputs[0];
  const goal = goalInput?.text.trim() ?? "";
  if (goal === "") {
    throw new Error("Add-phase goal must not be empty.");
  }

  return [{
    text: `Short Goal: ${goal}`,
    sources: [{ path: goalInput?.relativePath ?? ".planning/goal-input.txt", locator: "line:1" }] as const,
  }];
}

function toGoalSourceRelativePath(goal: string): string {
  return `.planning/goal-input-${stableGoalSuffix(goal)}.txt`;
}

function stableGoalSuffix(goal: string): string {
  const normalizedGoal = goal.trim().toLowerCase();
  let hash = 5381;

  for (const character of normalizedGoal) {
    hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

export function sliceRequirementsIntoPhases(input: SliceSourceRequirementsInput) {
  const groups = new Map<string, SliceSourceRequirementsInput["requirements"] extends readonly (infer RequirementType)[] ? RequirementType[] : never>();
  const groupMetadata = new Map<string, { label: string; sourcePath: string }>();
  const orderedLabels: string[] = [];
  const sourcePathsByLabel = new Map<string, Set<string>>();

  for (const requirement of input.requirements) {
    const label = getRequirementGroupLabel(requirement.text);
    const sourcePath = getPrimarySourcePath(requirement.sources.map((source) => source.path));
    const groupKey = `${label}\u0000${sourcePath}`;

    if (!sourcePathsByLabel.has(label)) {
      sourcePathsByLabel.set(label, new Set());
    }
    sourcePathsByLabel.get(label)?.add(sourcePath);

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
      groupMetadata.set(groupKey, { label, sourcePath });
      orderedLabels.push(groupKey);
    }

    groups.get(groupKey)?.push(requirement);
  }

  return orderedLabels.map((groupKey) => {
    const metadata = groupMetadata.get(groupKey);
    const label = metadata?.label ?? "Ingested Requirements";
    const sourcePath = metadata?.sourcePath ?? "";
    const requirements = groups.get(groupKey) ?? [];
    const includeSourceInPhaseId = (sourcePathsByLabel.get(label)?.size ?? 0) > 1 || sourcePath.startsWith(".planning/goal-input-");
    const phaseId = includeSourceInPhaseId
      ? `INGEST-${slugify(label)}-${slugify(toSourcePhaseSlug(sourcePath))}`
      : `INGEST-${slugify(label)}`;
    const relevantContext = dedupe([
      ...(input.confirmed_stack ? [`Confirmed stack: ${input.confirmed_stack}`] : []),
      ...input.context.patterns.slice(0, 4),
      ...input.context.schemas.slice(0, 2),
    ]);
    const likelyChangeAreas = dedupe(
      input.context.patterns.filter((entry) => entry.includes("/src/") || entry.endsWith("/src")).slice(0, 4),
    );
    const testStrategy = dedupe([
      ...input.context.tests.slice(0, 3).map((entry) => `Check existing coverage in ${entry}.`),
      "Run the approved test, typecheck, and lint commands for the affected workspace.",
    ]);
    const integrationRisks = dedupe([
      ...input.context.integrationRisks.slice(0, 3),
      "Requirement coverage must remain deterministic across re-ingest.",
    ]);

    return {
      id: phaseId,
      source_requirement_ids: requirements.map((requirement) => requirement.id),
      expected_behavior: label === "Success Criteria"
        ? "Satisfy the documented product success criteria for the ingested scope."
        : `Implement the ${label} product slice described by the ingested requirements.`,
      relevant_context: relevantContext,
      likely_change_areas: likelyChangeAreas.length > 0 ? likelyChangeAreas : ["packages/core/src"],
      test_strategy: testStrategy,
      integration_risks: integrationRisks,
      done_criteria: requirements.map((requirement) => requirement.text),
    };
  });
}

function getRequirementGroupLabel(text: string): string {
  const separatorIndex = text.indexOf(": ");
  if (separatorIndex <= 0) {
    return "Ingested Requirements";
  }

  return text.slice(0, separatorIndex);
}

function getPrimarySourcePath(sourcePaths: readonly string[]): string {
  return [...sourcePaths].sort(compareStrings)[0] ?? "";
}

function toSourcePhaseSlug(sourcePath: string): string {
  const withoutExtension = sourcePath.endsWith(extname(sourcePath))
    ? sourcePath.slice(0, Math.max(0, sourcePath.length - extname(sourcePath).length))
    : sourcePath;
  return withoutExtension === "" ? "source" : withoutExtension;
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug === "" ? "phase" : slug;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ""))];
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
