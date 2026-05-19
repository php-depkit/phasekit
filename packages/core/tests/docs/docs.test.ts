import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  generateDocumentation,
  initializePlanningState,
  docsTaskSchema,
  parseStateFile,
  validateDocsFactualityResult,
  validateDocsTaskFactReferences,
  validateGeneratedDocDraftCitations,
  type DocsFactSource,
  type DocsFactualityVerificationResult,
  type DocsTask,
  type DocsWriter,
  type GeneratedDocDraft,
} from "../../src/index";

const factSources: DocsFactSource[] = [
  {
    id: "command-test",
    kind: "command",
    summary: "Project test command.",
    value: "bun test",
    path: "package.json",
  },
  {
    id: "config-review",
    kind: "config_key",
    summary: "Review policy config key.",
    value: "quality.review",
    path: ".planning/config.json",
  },
  {
    id: "structure-core",
    kind: "project_structure",
    summary: "Core package source directory.",
    value: "packages/core/src",
  },
];

const docsTask: DocsTask = {
  id: "docs-setup",
  kind: "setup",
  title: "Setup Phasekit",
  audience: "maintainers",
  scope: "Document setup using only discovered commands and project structure.",
  required_fact_source_ids: ["command-test", "structure-core"],
  output_path: "docs/setup.md",
};

const draft: GeneratedDocDraft = {
  task_id: "docs-setup",
  title: "Setup Phasekit",
  cited_fact_source_ids: ["command-test", "structure-core"],
  sections: [
    {
      heading: "Run Checks",
      body: "Use `bun test` before accepting changes.",
      fact_source_ids: ["command-test"],
    },
    {
      heading: "Core Sources",
      body: "Core implementation lives under `packages/core/src`.",
      fact_source_ids: ["structure-core"],
    },
  ],
};

const passedFactualityResult: DocsFactualityVerificationResult = {
  status: "passed",
  checked_at: "2026-05-17T00:00:00.000Z",
  checked_fact_source_ids: ["command-test", "structure-core"],
  findings: [],
};

describe("docs task schemas", () => {
  test("accepts valid explicit docs tasks for supported scopes", () => {
    const kinds: DocsTask["kind"][] = ["getting_started", "setup", "configuration", "usage", "troubleshooting", "deployment"];

    for (const kind of kinds) {
      expect(docsTaskSchema.parse({ ...docsTask, kind })).toMatchObject({ kind });
    }

    expect(validateDocsTaskFactReferences(docsTask, factSources)).toEqual(docsTask);
  });

  test("rejects invalid task shapes with strict errors", () => {
    expect(() => parseStateFile("docs-task.json", docsTaskSchema, { ...docsTask, kind: "release_notes" })).toThrow(
      "Invalid docs-task.json: kind: Invalid enum value.",
    );
    expect(() => parseStateFile("docs-task.json", docsTaskSchema, { ...docsTask, extra: true })).toThrow(
      "Invalid docs-task.json: <root>: Unrecognized key(s) in object: 'extra'",
    );
    expect(() => parseStateFile("docs-task.json", docsTaskSchema, { ...docsTask, required_fact_source_ids: [] })).toThrow(
      "Invalid docs-task.json: required_fact_source_ids: Array must contain at least 1 element(s)",
    );
  });

  test("defines a docs-writer contract that returns cited drafts", async () => {
    const writer: DocsWriter = (context) => ({
      ...draft,
      task_id: context.task.id,
    });

    const result = await writer({
      task: docsTask,
      fact_sources: factSources,
      project_structure: ["packages/core/src"],
      commands: ["bun test"],
      config_keys: ["quality.review"],
      confirmed_stack: "TypeScript and Bun",
    });

    expect(validateGeneratedDocDraftCitations(result, factSources, docsTask)).toEqual(draft);
  });
});

describe("docs factuality validation", () => {
  test("requires generated drafts to cite known fact sources", () => {
    expect(validateGeneratedDocDraftCitations(draft, factSources, docsTask)).toEqual(draft);

    expect(() => validateGeneratedDocDraftCitations({ ...draft, cited_fact_source_ids: [] }, factSources)).toThrow();
  });

  test("rejects drafts that omit task-required fact sources", () => {
    expect(() =>
      validateGeneratedDocDraftCitations(
        {
          ...draft,
          cited_fact_source_ids: ["command-test"],
          sections: [{ ...draft.sections[0]!, fact_source_ids: ["command-test"] }],
        },
        factSources,
        docsTask,
      ),
    ).toThrow("Generated doc draft docs-setup is missing required fact source structure-core.");
  });

  test("requires task-required fact sources to be cited by generated sections", () => {
    expect(() =>
      validateGeneratedDocDraftCitations(
        {
          ...draft,
          cited_fact_source_ids: ["command-test", "structure-core"],
          sections: [{ ...draft.sections[0]!, fact_source_ids: ["command-test"] }],
        },
        factSources,
        docsTask,
      ),
    ).toThrow("Generated doc draft docs-setup is missing required fact source structure-core.");
  });

  test("rejects missing docs task fact references", () => {
    expect(() =>
      validateDocsTaskFactReferences({ ...docsTask, required_fact_source_ids: ["command-test", "missing-fact"] }, factSources),
    ).toThrow("Docs task docs-setup references missing fact source missing-fact.");
  });

  test("rejects duplicate fact source IDs", () => {
    expect(() => validateDocsTaskFactReferences(docsTask, [...factSources, { ...factSources[0]!, value: "bun test --watch" }])).toThrow(
      "Duplicate docs fact source ID command-test.",
    );
  });

  test("rejects drafts for a different docs task", () => {
    expect(() => validateGeneratedDocDraftCitations({ ...draft, task_id: "docs-usage" }, factSources, docsTask)).toThrow(
      "Generated doc draft docs-usage does not match docs task docs-setup.",
    );
  });

  test("rejects unsupported citations in generated drafts", () => {
    expect(() =>
      validateGeneratedDocDraftCitations(
        {
          ...draft,
          cited_fact_source_ids: ["command-test", "invented-command"],
        },
        factSources,
      ),
    ).toThrow("Generated doc draft docs-setup cites unsupported fact source invented-command.");

    expect(() =>
      validateGeneratedDocDraftCitations(
        {
          ...draft,
          sections: [{ ...draft.sections[0]!, fact_source_ids: ["invented-command"] }],
        },
        factSources,
      ),
    ).toThrow("Generated doc draft docs-setup cites unsupported fact source invented-command.");
  });

  test("rejects failed factuality signals in passed results", () => {
    expect(validateDocsFactualityResult(passedFactualityResult, docsTask.required_fact_source_ids)).toEqual(passedFactualityResult);

    expect(() => validateDocsFactualityResult({ ...passedFactualityResult, checked_fact_source_ids: [] })).toThrow();

    expect(() => validateDocsFactualityResult(passedFactualityResult, ["command-test", "config-review"])).toThrow(
      "Passed docs factuality results must check required fact source config-review.",
    );

    expect(() =>
      validateDocsFactualityResult({
        ...passedFactualityResult,
        findings: [
          {
            severity: "failure",
            message: "Generated docs reference an unconfirmed command.",
            fact_source_ids: ["command-test"],
          },
        ],
      }),
    ).toThrow("Passed docs factuality results cannot include failure findings.");
  });

  test("rejects unknown checked fact sources in passed factuality results", () => {
    expect(() =>
      validateDocsFactualityResult(
        { ...passedFactualityResult, checked_fact_source_ids: ["command-test", "invented-command"] },
        { factSources },
      ),
    ).toThrow("Passed docs factuality results cannot check unknown fact source invented-command.");
  });

  test("requires passed factuality results to check all draft-cited fact sources", () => {
    expect(validateDocsFactualityResult(passedFactualityResult, { factSources, draft })).toEqual(passedFactualityResult);

    expect(() =>
      validateDocsFactualityResult(
        { ...passedFactualityResult, checked_fact_source_ids: ["command-test"] },
        { factSources, draft },
      ),
    ).toThrow("Passed docs factuality results must check required fact source structure-core.");

    expect(() =>
      validateDocsFactualityResult(
        { ...passedFactualityResult, checked_fact_source_ids: ["command-test", "structure-core"] },
        {
          factSources,
          draft: {
            ...draft,
            cited_fact_source_ids: ["command-test", "structure-core", "config-review"],
            sections: [...draft.sections, { ...draft.sections[0]!, fact_source_ids: ["config-review"] }],
          },
        },
      ),
    ).toThrow("Passed docs factuality results must check required fact source config-review.");
  });
});

describe("docs generation pipeline", () => {
  test("collects factual docs context, validates the draft, and writes output when requested", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "phasekit-docs-"));
    const generatedDocsTask: DocsTask = {
      ...docsTask,
      required_fact_source_ids: ["command-verify-test", "file-tsconfig-json"],
    };

    try {
      await initializePlanningState(rootDir, {
        stackAnswer: {
          question: {
            id: "greenfield-stack",
            prompt: "Which tech stack should Phasekit use for this greenfield project?",
          },
          requirement_ids: ["greenfield-stack"],
          custom_answer_text: "Bun + TypeScript",
        },
      });
      await writeFile(join(rootDir, "package.json"), JSON.stringify({
        packageManager: "bun@1.1.0",
        scripts: {
          test: "bun test",
        },
      }, null, 2), "utf8");
      await writeFile(join(rootDir, "tsconfig.json"), "{}\n", "utf8");
      await writeFile(join(rootDir, ".planning", "config.json"), JSON.stringify({
        quality: {
          review: "always",
        },
      }, null, 2), "utf8");
      await writeFile(join(rootDir, "README.md"), "# Docs\n", "utf8");

      const result = await generateDocumentation({
        rootDir,
        task: generatedDocsTask,
        writeOutput: true,
        writer: (context) => ({
          task_id: context.task.id,
          title: context.task.title,
          cited_fact_source_ids: ["command-verify-test", "file-tsconfig-json"],
          sections: [
            {
              heading: "Checks",
              body: `Run ${context.commands.find((command) => command === "bun run test") ?? "missing"}.`,
              fact_source_ids: ["command-verify-test"],
            },
            {
              heading: "Structure",
              body: "Keep TypeScript project settings in `tsconfig.json`.",
              fact_source_ids: ["file-tsconfig-json"],
            },
          ],
        }),
        factualityVerifier: () => ({
          status: "passed",
          checked_at: "2026-05-19T00:00:00.000Z",
          checked_fact_source_ids: ["command-verify-test", "file-tsconfig-json"],
          findings: [],
        }),
      });

      expect(result.context.confirmed_stack).toBe("Bun + TypeScript");
      expect(result.context.commands).toContain("/pk-init");
      expect(result.context.commands).toContain("bun run test");
      expect(result.context.config_keys).toContain("quality.review");
      expect(result.wrote_output).toBe(true);
      expect(result.output_path).toBe("docs/setup.md");
      await expect(readFile(join(rootDir, "docs", "setup.md"), "utf8")).resolves.toContain("# Setup Phasekit");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("does not write output when generated docs fail citation validation", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "phasekit-docs-"));
    const generatedDocsTask: DocsTask = {
      ...docsTask,
      required_fact_source_ids: ["command-pk-init"],
    };

    try {
      await initializePlanningState(rootDir);

      await expect(generateDocumentation({
        rootDir,
        task: generatedDocsTask,
        writeOutput: true,
        writer: () => ({
          task_id: generatedDocsTask.id,
          title: generatedDocsTask.title,
          cited_fact_source_ids: ["invented-fact"],
          sections: [
            {
              heading: "Broken",
              body: "This cites a missing fact.",
              fact_source_ids: ["invented-fact"],
            },
          ],
        }),
      })).rejects.toThrow("Generated doc draft docs-setup cites unsupported fact source invented-fact.");
      await expect(readFile(join(rootDir, "docs", "setup.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
