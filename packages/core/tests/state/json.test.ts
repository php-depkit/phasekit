import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, test } from "bun:test";

import {
  defaultConfig,
  initializePlanningState,
  loadPhasekitConfig,
  phasekitConfigOverrideSchema,
  projectStateSchema,
  readJsonFile,
  toDeterministicJson,
  writeJsonFile,
} from "../../src/index";

const temporaryDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "phasekit-state-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("state JSON IO", () => {
  test("writes deterministic JSON with stable key ordering", async () => {
    const rootDir = await createTempDirectory();
    const filePath = join(rootDir, ".planning", "project.json");
    const value = {
      zeta: true,
      alpha: {
        delta: 2,
        beta: 1,
      },
      items: [{ zebra: 2, apple: 1 }],
    };

    await writeJsonFile(filePath, value);

    expect(await readFile(filePath, "utf8")).toBe(`{
  "alpha": {
    "beta": 1,
    "delta": 2
  },
  "items": [
    {
      "apple": 1,
      "zebra": 2
    }
  ],
  "zeta": true
}
`);

    await writeJsonFile(filePath, {
      items: [{ apple: 1, zebra: 2 }],
      alpha: { beta: 1, delta: 2 },
      zeta: true,
    });

    expect(await readFile(filePath, "utf8")).toBe(toDeterministicJson(value));
  });

  test("reads and validates canonical JSON state", async () => {
    const rootDir = await createTempDirectory();
    const filePath = join(rootDir, ".planning", "project.json");

    await writeJsonFile(filePath, { stack: "Bun + TypeScript" });

    await expect(readJsonFile(filePath, projectStateSchema)).resolves.toEqual({
      stack: "Bun + TypeScript",
    });
  });

  test("surfaces actionable JSON syntax errors", async () => {
    const rootDir = await createTempDirectory();
    const filePath = join(rootDir, ".planning", "project.json");

    await mkdir(join(rootDir, ".planning"), { recursive: true });
    await writeFile(filePath, "{not-json}\n", "utf8");

    await expect(readJsonFile(filePath, projectStateSchema)).rejects.toThrow(
      /Invalid project\.json: File must contain valid JSON/,
    );
  });
});

describe("planning state initialization", () => {
  test("creates only canonical planning files and directories", async () => {
    const rootDir = await createTempDirectory();

    const result = await initializePlanningState(rootDir);

    expect(result.createdPaths).toEqual([
      ".planning",
      ".planning/project.json",
      ".planning/config.json",
      ".planning/requirements.json",
      ".planning/phases.json",
      ".planning/rules.json",
      ".planning/runs",
      ".planning/verifications",
    ]);
    expect(result.existingPaths).toEqual([]);
    expect(
      await readJsonFile(join(rootDir, ".planning", "config.json"), phasekitConfigOverrideSchema),
    ).toEqual({});
    expect(
      await loadPhasekitConfig({
        projectRoot: rootDir,
        globalConfigPath: join(rootDir, "missing-global-config.json"),
      }),
    ).toEqual(
      defaultConfig,
    );
    await expect(stat(join(rootDir, ".planning", "cache"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("does not overwrite existing planning files or unrelated notes", async () => {
    const rootDir = await createTempDirectory();
    const planningDir = join(rootDir, ".planning");

    await initializePlanningState(rootDir);
    await writeJsonFile(join(planningDir, "project.json"), { stack: "Existing Stack" });
    await writeFile(join(planningDir, "notes.md"), "leave me alone\n", "utf8");

    const result = await initializePlanningState(rootDir, {
      config: {
        ...defaultConfig,
        commit: {
          ...defaultConfig.commit,
          mode: "auto",
        },
      },
    });

    expect(result.createdPaths).toEqual([]);
    expect(result.existingPaths).toEqual([
      ".planning",
      ".planning/project.json",
      ".planning/config.json",
      ".planning/requirements.json",
      ".planning/phases.json",
      ".planning/rules.json",
      ".planning/runs",
      ".planning/verifications",
    ]);
    expect(await readJsonFile(join(planningDir, "project.json"), projectStateSchema)).toEqual({
      stack: "Existing Stack",
    });
    expect(await readFile(join(planningDir, "notes.md"), "utf8")).toBe("leave me alone\n");
  });

  test("initializes project config as overrides so global config remains effective", async () => {
    const rootDir = await createTempDirectory();
    const globalConfigPath = join(rootDir, "global-config.json");

    await initializePlanningState(rootDir);
    await writeJsonFile(globalConfigPath, {
      greenfield: {
        recommend_stack: false,
      },
    });

    await expect(loadPhasekitConfig({ projectRoot: rootDir, globalConfigPath })).resolves.toEqual({
      ...defaultConfig,
      greenfield: {
        ...defaultConfig.greenfield,
        recommend_stack: false,
      },
    });
  });
});
