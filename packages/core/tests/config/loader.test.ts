import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, test } from "bun:test";

import { defaultConfig, loadPhasekitConfig, writeJsonFile } from "../../src/index";

const temporaryDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "phasekit-config-"));
  temporaryDirectories.push(directory);
  return directory;
}

function missingGlobalConfigPath(rootDir: string): string {
  return join(rootDir, "missing-global-config.json");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("config loader", () => {
  test("returns defaults when no config sources are present", async () => {
    const rootDir = await createTempDirectory();

    await expect(
      loadPhasekitConfig({
        projectRoot: rootDir,
        globalConfigPath: missingGlobalConfigPath(rootDir),
      }),
    ).resolves.toEqual(defaultConfig);
  });

  test("applies precedence from global to project to CLI", async () => {
    const rootDir = await createTempDirectory();
    const globalConfigPath = join(rootDir, "global-config.json");
    const projectConfigPath = join(rootDir, ".planning", "config.json");

    await writeJsonFile(globalConfigPath, {
      commit: {
        mode: "off",
      },
      models: {
        reviewer: "global-reviewer",
      },
      greenfield: {
        recommend_stack: false,
      },
    });
    await writeJsonFile(projectConfigPath, {
      commit: {
        mode: "auto",
        planning_commits: true,
      },
      models: {
        reviewer: "project-reviewer",
      },
    });

    await expect(
      loadPhasekitConfig({
        projectRoot: rootDir,
        globalConfigPath,
        cliOverrides: {
          models: {
            reviewer: "cli-reviewer",
          },
        },
      }),
    ).resolves.toEqual({
      ...defaultConfig,
      commit: {
        mode: "auto",
        planning_commits: true,
      },
      greenfield: {
        ...defaultConfig.greenfield,
        recommend_stack: false,
      },
      models: {
        ...defaultConfig.models,
        reviewer: "cli-reviewer",
      },
    });
  });

  test("preserves lower-precedence nested values when applying partial overrides", async () => {
    const rootDir = await createTempDirectory();
    const globalConfigPath = join(rootDir, "global-config.json");
    const projectConfigPath = join(rootDir, ".planning", "config.json");

    await writeJsonFile(globalConfigPath, {
      greenfield: {
        recommend_stack: false,
      },
      models: {
        planner: "global-planner",
      },
    });
    await writeJsonFile(projectConfigPath, {
      models: {
        verifier: "project-verifier",
      },
    });

    await expect(
      loadPhasekitConfig({
        projectRoot: rootDir,
        globalConfigPath,
      }),
    ).resolves.toEqual({
      ...defaultConfig,
      greenfield: {
        ...defaultConfig.greenfield,
        recommend_stack: false,
      },
      models: {
        ...defaultConfig.models,
        planner: "global-planner",
        verifier: "project-verifier",
      },
    });
  });

  test("resolves greenfield recommend_stack both on and off", async () => {
    const rootDir = await createTempDirectory();
    const projectConfigPath = join(rootDir, ".planning", "config.json");

    await writeJsonFile(projectConfigPath, {
      greenfield: {
        recommend_stack: false,
      },
    });

    const disabled = await loadPhasekitConfig({
      projectRoot: rootDir,
      globalConfigPath: missingGlobalConfigPath(rootDir),
    });
    const enabled = await loadPhasekitConfig({
      projectRoot: rootDir,
      globalConfigPath: missingGlobalConfigPath(rootDir),
      cliOverrides: {
        greenfield: {
          recommend_stack: true,
        },
      },
    });

    expect(disabled.greenfield.recommend_stack).toBe(false);
    expect(enabled.greenfield.recommend_stack).toBe(true);
  });

  test("returns actionable errors for invalid config sources", async () => {
    const rootDir = await createTempDirectory();
    const projectConfigPath = join(rootDir, ".planning", "config.json");

    await writeJsonFile(projectConfigPath, {
      commit: {
        mode: "later",
      },
    });

    await expect(
      loadPhasekitConfig({
        projectRoot: rootDir,
        globalConfigPath: missingGlobalConfigPath(rootDir),
      }),
    ).rejects.toThrow(
      "Invalid project config (.planning/config.json): commit.mode: Invalid enum value. Expected 'ask' | 'auto' | 'off', received 'later'",
    );
  });

  test("identifies invalid global config errors clearly", async () => {
    const rootDir = await createTempDirectory();
    const globalConfigPath = join(rootDir, "global-config.json");

    await writeJsonFile(globalConfigPath, {
      greenfield: {
        recommend_stack: "later",
      },
    });

    await expect(loadPhasekitConfig({ projectRoot: rootDir, globalConfigPath })).rejects.toThrow(
      "Invalid global config (~/.config/phasekit/config.json): greenfield.recommend_stack: Expected boolean, received string",
    );
  });

  test("validates CLI overrides before merging", async () => {
    const rootDir = await createTempDirectory();

    await expect(
      loadPhasekitConfig({
        projectRoot: rootDir,
        globalConfigPath: missingGlobalConfigPath(rootDir),
        cliOverrides: {
          commit: {
            planing_commits: true,
          } as never,
        },
      }),
    ).rejects.toThrow(
      "Invalid CLI config overrides: commit: Unrecognized key(s) in object: 'planing_commits'",
    );
  });
});
