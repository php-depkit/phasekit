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

  test("discovers package manager, verification commands, and structure signals without persisting commands by default", async () => {
    const rootDir = await createTempDirectory();

    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@9.0.0",
        scripts: {
          test: "vitest run",
          build: "tsc -p tsconfig.json",
        },
      }, null, 2),
      "utf8",
    );
    await writeFile(join(rootDir, "tsconfig.json"), "{}\n", "utf8");
    await mkdir(join(rootDir, "src"), { recursive: true });

    const result = await initializePlanningState(rootDir);

    expect(result.discovery.package_manager).toBe("pnpm");
    expect(result.discovery.test_commands).toEqual(["pnpm run test"]);
    expect(result.discovery.build_commands).toEqual(["pnpm run build"]);
    expect(result.discovery.project_structure_signals).toEqual([
      "dir:src",
      "project:src",
    ]);
    expect(result.verification_commands.requires_confirmation).toBe(true);
    expect(result.verification_commands.stored_in_project_config).toBe(false);
    expect(result.verification_commands.question?.id).toBe("init-verify-commands");
    expect(
      await readJsonFile(join(rootDir, ".planning", "config.json"), phasekitConfigOverrideSchema),
    ).toEqual({});
  });

  test("infers package manager from lockfile when package.json omits packageManager", async () => {
    const rootDir = await createTempDirectory();

    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        scripts: {
          test: "vitest run",
        },
      }, null, 2),
      "utf8",
    );
    await writeFile(join(rootDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

    const result = await initializePlanningState(rootDir);

    expect(result.discovery.package_manager).toBe("pnpm");
    expect(result.discovery.test_commands).toEqual(["pnpm run test"]);
  });

  test("falls back to npm when package manager cannot be inferred", async () => {
    const rootDir = await createTempDirectory();

    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        scripts: {
          test: "vitest run",
        },
      }, null, 2),
      "utf8",
    );

    const result = await initializePlanningState(rootDir);

    expect(result.discovery.package_manager).toBe("npm");
    expect(result.discovery.test_commands).toEqual(["npm run test"]);
  });

  test("persists discovered verification commands only after explicit question approval", async () => {
    const rootDir = await createTempDirectory();

    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        packageManager: "bun@1.1.0",
        scripts: {
          test: "bun test",
        },
      }, null, 2),
      "utf8",
    );

    await initializePlanningState(rootDir);

    const approved = await initializePlanningState(rootDir, {
      confirmationAnswer: {
        question: {
          id: "init-verify-commands",
          prompt: "Do you approve persisting discovered verification commands into .planning/config.json?",
        },
        requirement_ids: ["verification-test"],
        selected_recommended_option: {
          id: "approve-discovered-commands",
          text: "Approve and persist discovered verification commands",
        },
      },
    });

    expect(approved.verification_commands.stored_in_project_config).toBe(true);
    expect(
      await readJsonFile(join(rootDir, ".planning", "config.json"), phasekitConfigOverrideSchema),
    ).toEqual({
      verification: {
        commands: {
          test: {
            command: "bun run test",
          },
        },
      },
    });
  });

  test("returns a greenfield stack question when recommendation is enabled and no implementation is detected", async () => {
    const rootDir = await createTempDirectory();

    const result = await initializePlanningState(rootDir);

    expect(result.stack_decision.kind).toBe("question");
    if (result.stack_decision.kind !== "question") {
      throw new Error("Expected stack decision question.");
    }
    expect(result.stack_decision.question.id).toBe("greenfield-stack");
  });

  test("does not return a greenfield stack question when recommendation is disabled globally", async () => {
    const rootDir = await createTempDirectory();
    const configRoot = join(rootDir, "global-config-root");
    const globalConfigDir = join(configRoot, "phasekit");

    await mkdir(globalConfigDir, { recursive: true });
    await writeJsonFile(join(globalConfigDir, "config.json"), {
      greenfield: {
        recommend_stack: false,
      },
    });

    const result = await initializePlanningState(rootDir, { configRoot });

    expect(result.stack_decision).toEqual({
      kind: "blocker",
      reason: "Stack recommendation is disabled and no stack is confirmed for this greenfield project.",
      next_step: "Ask the user to provide the exact stack to confirm before planning implementation.",
    });
  });

  test("does not create local verification overrides when commands are already effective from global config", async () => {
    const rootDir = await createTempDirectory();
    const configRoot = join(rootDir, "global-config-root");
    const globalConfigDir = join(configRoot, "phasekit");

    await mkdir(globalConfigDir, { recursive: true });
    await writeJsonFile(join(globalConfigDir, "config.json"), {
      verification: {
        commands: {
          test: { command: "npm run test" },
          build: { command: "npm run build" },
        },
      },
    });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        scripts: {
          test: "vitest run",
          build: "tsc -p tsconfig.json",
        },
      }, null, 2),
      "utf8",
    );

    const result = await initializePlanningState(rootDir, {
      configRoot,
      confirmationAnswer: {
        question: {
          id: "init-verify-commands",
          prompt: "Do you approve persisting discovered verification commands into .planning/config.json?",
        },
        requirement_ids: ["verification-test"],
        selected_recommended_option: {
          id: "approve-discovered-commands",
          text: "Approve and persist discovered verification commands",
        },
      },
    });

    expect(result.verification_commands.commands).toEqual([]);
    expect(result.verification_commands.requires_confirmation).toBe(false);
    expect(result.verification_commands.stored_in_project_config).toBe(false);
    expect(
      await readJsonFile(join(rootDir, ".planning", "config.json"), phasekitConfigOverrideSchema),
    ).toEqual({});
  });
});
