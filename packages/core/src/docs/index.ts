import { z } from "zod";

const nonEmptyStringSchema = z.string().min(1);

export const docsTaskKindSchema = z.enum([
  "getting_started",
  "setup",
  "configuration",
  "usage",
  "troubleshooting",
  "deployment",
]);

export const docsFactSourceKindSchema = z.enum(["command", "config_key", "project_structure", "file", "confirmed_stack"]);

export const docsFactSourceSchema = z
  .object({
    id: nonEmptyStringSchema,
    kind: docsFactSourceKindSchema,
    summary: nonEmptyStringSchema,
    value: nonEmptyStringSchema,
    path: nonEmptyStringSchema.optional(),
  })
  .strict();

export const docsTaskSchema = z
  .object({
    id: nonEmptyStringSchema,
    kind: docsTaskKindSchema,
    title: nonEmptyStringSchema,
    audience: nonEmptyStringSchema,
    scope: nonEmptyStringSchema,
    required_fact_source_ids: z.array(nonEmptyStringSchema).min(1),
    output_path: nonEmptyStringSchema.optional(),
  })
  .strict();

export const docsWriterContextSchema = z
  .object({
    task: docsTaskSchema,
    fact_sources: z.array(docsFactSourceSchema).min(1),
    project_structure: z.array(nonEmptyStringSchema),
    commands: z.array(nonEmptyStringSchema),
    config_keys: z.array(nonEmptyStringSchema),
    confirmed_stack: nonEmptyStringSchema.optional(),
  })
  .strict();

export const generatedDocSectionSchema = z
  .object({
    heading: nonEmptyStringSchema,
    body: nonEmptyStringSchema,
    fact_source_ids: z.array(nonEmptyStringSchema).min(1),
  })
  .strict();

export const generatedDocDraftSchema = z
  .object({
    task_id: nonEmptyStringSchema,
    title: nonEmptyStringSchema,
    sections: z.array(generatedDocSectionSchema).min(1),
    cited_fact_source_ids: z.array(nonEmptyStringSchema).min(1),
  })
  .strict();

export const docsFactualityFindingSeveritySchema = z.enum(["warning", "failure"]);

export const docsFactualityFindingSchema = z
  .object({
    severity: docsFactualityFindingSeveritySchema,
    message: nonEmptyStringSchema,
    fact_source_ids: z.array(nonEmptyStringSchema).optional(),
  })
  .strict();

export const docsFactualityVerificationStatusSchema = z.enum(["passed", "failed", "blocked"]);

export const docsFactualityVerificationResultSchema = z
  .object({
    status: docsFactualityVerificationStatusSchema,
    checked_at: z.string().datetime(),
    checked_fact_source_ids: z.array(nonEmptyStringSchema).min(1),
    findings: z.array(docsFactualityFindingSchema),
  })
  .strict();

export type DocsTaskKind = z.infer<typeof docsTaskKindSchema>;
export type DocsFactSourceKind = z.infer<typeof docsFactSourceKindSchema>;
export type DocsFactSource = z.infer<typeof docsFactSourceSchema>;
export type DocsTask = z.infer<typeof docsTaskSchema>;
export type DocsWriterContext = z.infer<typeof docsWriterContextSchema>;
export type GeneratedDocSection = z.infer<typeof generatedDocSectionSchema>;
export type GeneratedDocDraft = z.infer<typeof generatedDocDraftSchema>;
export type DocsFactualityFindingSeverity = z.infer<typeof docsFactualityFindingSeveritySchema>;
export type DocsFactualityFinding = z.infer<typeof docsFactualityFindingSchema>;
export type DocsFactualityVerificationStatus = z.infer<typeof docsFactualityVerificationStatusSchema>;
export type DocsFactualityVerificationResult = z.infer<typeof docsFactualityVerificationResultSchema>;

export type DocsWriter = (context: DocsWriterContext) => Promise<GeneratedDocDraft> | GeneratedDocDraft;

export type ValidateDocsFactualityResultOptions = {
  requiredFactSourceIds?: readonly string[];
  factSources?: unknown;
  draft?: unknown;
};

export function validateDocsTaskFactReferences(task: unknown, factSources: unknown): DocsTask {
  const parsedTask = docsTaskSchema.parse(task);
  const parsedFactSources = parseFactSourcesWithUniqueIds(factSources);
  const knownFactSourceIds = new Set(parsedFactSources.map((factSource) => factSource.id));

  for (const factSourceId of parsedTask.required_fact_source_ids) {
    if (!knownFactSourceIds.has(factSourceId)) {
      throw new Error(`Docs task ${parsedTask.id} references missing fact source ${factSourceId}.`);
    }
  }

  return parsedTask;
}

export function validateGeneratedDocDraftCitations(draft: unknown, factSources: unknown, task?: unknown): GeneratedDocDraft {
  const parsedDraft = generatedDocDraftSchema.parse(draft);
  const parsedFactSources = parseFactSourcesWithUniqueIds(factSources);
  const parsedTask = task === undefined ? undefined : docsTaskSchema.parse(task);
  const knownFactSourceIds = new Set(parsedFactSources.map((factSource) => factSource.id));
  const citedFactSourceIds = new Set(parsedDraft.cited_fact_source_ids);
  const sectionFactSourceIds = new Set<string>();

  if (parsedTask !== undefined && parsedDraft.task_id !== parsedTask.id) {
    throw new Error(`Generated doc draft ${parsedDraft.task_id} does not match docs task ${parsedTask.id}.`);
  }

  for (const section of parsedDraft.sections) {
    for (const factSourceId of section.fact_source_ids) {
      if (!knownFactSourceIds.has(factSourceId)) {
        throw new Error(`Generated doc draft ${parsedDraft.task_id} cites unsupported fact source ${factSourceId}.`);
      }

      citedFactSourceIds.add(factSourceId);
      sectionFactSourceIds.add(factSourceId);
    }
  }

  for (const factSourceId of parsedDraft.cited_fact_source_ids) {
    if (!knownFactSourceIds.has(factSourceId)) {
      throw new Error(`Generated doc draft ${parsedDraft.task_id} cites unsupported fact source ${factSourceId}.`);
    }
  }

  if (citedFactSourceIds.size === 0) {
    throw new Error(`Generated doc draft ${parsedDraft.task_id} must cite at least one fact source.`);
  }

  if (parsedTask !== undefined) {
    for (const factSourceId of parsedTask.required_fact_source_ids) {
      if (!sectionFactSourceIds.has(factSourceId)) {
        throw new Error(`Generated doc draft ${parsedDraft.task_id} is missing required fact source ${factSourceId}.`);
      }
    }
  }

  return parsedDraft;
}

export function validateDocsFactualityResult(
  result: unknown,
  optionsOrRequiredFactSourceIds: readonly string[] | ValidateDocsFactualityResultOptions = [],
): DocsFactualityVerificationResult {
  const parsedResult = docsFactualityVerificationResultSchema.parse(result);
  const options: ValidateDocsFactualityResultOptions = Array.isArray(optionsOrRequiredFactSourceIds)
    ? { requiredFactSourceIds: optionsOrRequiredFactSourceIds }
    : (optionsOrRequiredFactSourceIds as ValidateDocsFactualityResultOptions);
  const checkedFactSourceIds = new Set(parsedResult.checked_fact_source_ids);

  if (parsedResult.status !== "passed") {
    return parsedResult;
  }

  if (options.factSources !== undefined) {
    const knownFactSourceIds = new Set(parseFactSourcesWithUniqueIds(options.factSources).map((factSource) => factSource.id));

    for (const factSourceId of parsedResult.checked_fact_source_ids) {
      if (!knownFactSourceIds.has(factSourceId)) {
        throw new Error(`Passed docs factuality results cannot check unknown fact source ${factSourceId}.`);
      }
    }
  }

  const draftFactSourceIds = options.draft === undefined ? [] : collectDraftFactSourceIds(generatedDocDraftSchema.parse(options.draft));

  for (const factSourceId of [...(options.requiredFactSourceIds ?? []), ...draftFactSourceIds]) {
    if (!checkedFactSourceIds.has(factSourceId)) {
      throw new Error(`Passed docs factuality results must check required fact source ${factSourceId}.`);
    }
  }

  const failureFinding = parsedResult.findings.find((finding) => finding.severity === "failure");
  if (failureFinding) {
    throw new Error("Passed docs factuality results cannot include failure findings.");
  }

  return parsedResult;
}

function collectDraftFactSourceIds(draft: GeneratedDocDraft): string[] {
  const factSourceIds = new Set(draft.cited_fact_source_ids);

  for (const section of draft.sections) {
    for (const factSourceId of section.fact_source_ids) {
      factSourceIds.add(factSourceId);
    }
  }

  return [...factSourceIds];
}

function parseFactSourcesWithUniqueIds(factSources: unknown): DocsFactSource[] {
  const parsedFactSources = z.array(docsFactSourceSchema).parse(factSources);
  const seenIds = new Set<string>();

  for (const factSource of parsedFactSources) {
    if (seenIds.has(factSource.id)) {
      throw new Error(`Duplicate docs fact source ID ${factSource.id}.`);
    }

    seenIds.add(factSource.id);
  }

  return parsedFactSources;
}
