import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  ingestProjectInputs,
  initializePlanningState,
  readJsonFile,
  requirementsStateSchema,
  phasesStateSchema,
  type PhaseSlicer,
  type RequirementExtractor,
} from "../../src/index";

const temporaryDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "phasekit-ingest-project-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function writeTextFile(rootDir: string, relativePath: string, text: string): Promise<void> {
  const filePath = join(rootDir, ...relativePath.split("/"));
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, text, "utf8");
}

describe("project ingest pipeline", () => {
  test("writes deterministic requirements and phases through the ingest pipeline", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeTextFile(rootDir, "prd.md", [
      "# Product",
      "",
      "**Success Criteria:**",
      "- Ship a deterministic ingest flow.",
      "",
      "**Story 1: Ingest Product Intent**",
      "Acceptance criteria:",
      "- Accept one or more input paths.",
      "- Persist stable source requirement IDs.",
      "",
    ].join("\n"));

    const result = await ingestProjectInputs({ rootDir, inputPaths: ["prd.md"] });

    expect(result.requirements.requirements.map((requirement) => requirement.id)).toEqual(["REQ-1", "REQ-2", "REQ-3"]);
    expect(result.requirements.requirements.map((requirement) => requirement.text)).toEqual([
      "Success Criteria: Ship a deterministic ingest flow.",
      "Ingest Product Intent: Accept one or more input paths.",
      "Ingest Product Intent: Persist stable source requirement IDs.",
    ]);
    expect(result.phases.phases.map((phase) => phase.id)).toEqual([
      "INGEST-success-criteria",
      "INGEST-ingest-product-intent",
    ]);
    expect(result.phases.phases[1]).toMatchObject({
      source_requirement_ids: ["REQ-2", "REQ-3"],
      status: "pending",
    });

    const requirementsJson = await readFile(join(rootDir, ".planning", "requirements.json"), "utf8");
    const phasesJson = await readFile(join(rootDir, ".planning", "phases.json"), "utf8");
    expect(requirementsJson).toContain('"id": "REQ-1"');
    expect(phasesJson).toContain('"id": "INGEST-success-criteria"');
    await expect(readJsonFile(join(rootDir, ".planning", "requirements.json"), requirementsStateSchema)).resolves.toEqual(result.requirements);
    await expect(readJsonFile(join(rootDir, ".planning", "phases.json"), phasesStateSchema)).resolves.toEqual(result.phases);
  });

  test("preserves requirement IDs and existing phase status on re-ingest", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeTextFile(rootDir, "prd.md", [
      "# Product",
      "",
      "**Story 1: Ingest Product Intent**",
      "Acceptance criteria:",
      "- Accept one or more input paths.",
      "",
    ].join("\n"));

    const first = await ingestProjectInputs({ rootDir, inputPaths: ["prd.md"] });
    await writeFile(
      join(rootDir, ".planning", "phases.json"),
      JSON.stringify({
        phases: [{ ...first.phases.phases[0], status: "in_progress" }],
      }, null, 2) + "\n",
      "utf8",
    );

    const second = await ingestProjectInputs({ rootDir, inputPaths: ["prd.md"] });

    expect(second.requirements.requirements.map((requirement) => requirement.id)).toEqual(["REQ-1"]);
    expect(second.phases.phases[0]?.status).toBe("in_progress");
  });

  test("resets preserved phase status when the phase requirement set changes", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeTextFile(rootDir, "prd.md", [
      "# Product",
      "",
      "**Story 1: Inputs**",
      "Acceptance criteria:",
      "- Accept one input path.",
      "",
    ].join("\n"));

    const first = await ingestProjectInputs({ rootDir, inputPaths: ["prd.md"] });
    await writeFile(
      join(rootDir, ".planning", "phases.json"),
      JSON.stringify({ phases: [{ ...first.phases.phases[0], status: "complete" }] }, null, 2) + "\n",
      "utf8",
    );
    await writeTextFile(rootDir, "prd.md", [
      "# Product",
      "",
      "**Story 1: Inputs**",
      "Acceptance criteria:",
      "- Accept one input path.",
      "- Accept a second input path.",
      "",
    ].join("\n"));

    const second = await ingestProjectInputs({ rootDir, inputPaths: ["prd.md"] });

    expect(second.phases.phases[0]?.id).toBe("INGEST-inputs");
    expect(second.phases.phases[0]?.status).toBe("pending");
  });

  test("supports injected extractor and slicer collaborators", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeTextFile(rootDir, "prd.md", "Placeholder\n");

    const extractor: RequirementExtractor = () => [
      {
        text: "Custom requirement",
        sources: [{ path: "prd.md", locator: "line:1" }],
      },
    ];
    const slicer: PhaseSlicer = ({ requirements }) => [
      {
        id: "CUSTOM-1",
        source_requirement_ids: requirements.map((requirement) => requirement.id),
        expected_behavior: "Implement the custom requirement.",
        relevant_context: ["packages/core/src/ingest"],
        likely_change_areas: ["packages/core/src/ingest/project.ts"],
        test_strategy: ["Run focused ingest tests."],
        integration_risks: ["Deterministic ingest output must stay stable."],
        done_criteria: ["Custom requirement is covered."],
      },
    ];

    const result = await ingestProjectInputs({ rootDir, inputPaths: ["prd.md"], extractor, slicer });

    expect(result.requirements.requirements[0]?.id).toBe("REQ-1");
    expect(result.phases.phases[0]?.id).toBe("CUSTOM-1");
  });

  test("ingests the Phasekit PRD deterministically through the real pipeline", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    const prdText = await readFile(join(import.meta.dir, "../../../../.planning/PHASEKIT-PRD.md"), "utf8");
    await writeTextFile(rootDir, ".planning/PHASEKIT-PRD.md", prdText);

    const first = await ingestProjectInputs({ rootDir, inputPaths: [".planning/PHASEKIT-PRD.md"] });
    const second = await ingestProjectInputs({ rootDir, inputPaths: [".planning/PHASEKIT-PRD.md"] });

    expect(first.requirements.requirements.length).toBeGreaterThan(0);
    expect(first.phases.phases.length).toBeGreaterThan(0);
    expect(second.requirements).toEqual(first.requirements);
    expect(second.phases).toEqual(first.phases);
  });
});
