import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

import { defaultConfig } from "./defaults";
import {
  type PhasekitConfig,
  type PhasekitConfigOverride,
  phasekitConfigOverrideSchema,
  phasekitConfigSchema,
} from "./schema";
import { formatSchemaError, parseStateFile } from "../state/parse";

export interface LoadPhasekitConfigOptions {
  projectRoot?: string;
  projectConfigPath?: string;
  globalConfigPath?: string;
  cliOverrides?: PhasekitConfigOverride;
}

function mergeConfig(base: PhasekitConfig, override: PhasekitConfigOverride): PhasekitConfig {
  return {
    commit: {
      ...base.commit,
      ...override.commit,
    },
    quality: {
      ...base.quality,
      ...override.quality,
    },
    greenfield: {
      ...base.greenfield,
      ...override.greenfield,
    },
    models: {
      ...base.models,
      ...override.models,
    },
    verification: {
      commands: {
        ...base.verification.commands,
        ...override.verification?.commands,
      },
    },
  };
}

async function readConfigOverride(
  filePath: string | undefined,
  sourceName: string,
): Promise<PhasekitConfigOverride | undefined> {
  if (!filePath) {
    return undefined;
  }

  let contents: string;

  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new Error(`Invalid ${sourceName}: File must contain valid JSON (${message})`);
  }

  const result = phasekitConfigOverrideSchema.safeParse(parsed);

  if (!result.success) {
    throw formatSchemaError(sourceName, result.error);
  }

  return result.data;
}

export async function loadPhasekitConfig(
  options: LoadPhasekitConfigOptions = {},
): Promise<PhasekitConfig> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const projectConfigPath = options.projectConfigPath ?? join(projectRoot, ".planning", "config.json");
  const globalConfigPath = options.globalConfigPath ?? join(homedir(), ".config", "phasekit", "config.json");

  const sources = await Promise.all([
    readConfigOverride(globalConfigPath, "global config (~/.config/phasekit/config.json)"),
    readConfigOverride(projectConfigPath, "project config (.planning/config.json)"),
  ]);

  const cliOverrides = options.cliOverrides
    ? parseStateFile("CLI config overrides", phasekitConfigOverrideSchema, options.cliOverrides)
    : undefined;

  let resolved = defaultConfig;

  for (const source of [...sources, cliOverrides]) {
    if (!source) {
      continue;
    }

    resolved = mergeConfig(resolved, source);
  }

  return parseStateFile("resolved config", phasekitConfigSchema, resolved);
}
