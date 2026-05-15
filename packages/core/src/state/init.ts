import { mkdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import type { PhasekitConfigOverride } from "../config/schema";
import {
  defaultPhasesState,
  defaultProjectState,
  defaultRequirementsState,
  defaultRulesState,
} from "./defaults";
import { writeJsonFile } from "./json";

type PlanningEntry = {
  path: string;
  kind: "directory" | "file";
  value?: unknown;
};

export type InitializePlanningStateOptions = {
  config?: PhasekitConfigOverride;
};

export type InitializePlanningStateResult = {
  createdPaths: string[];
  existingPaths: string[];
};

function toRelativePath(rootDir: string, targetPath: string): string {
  return relative(rootDir, targetPath).replaceAll("\\", "/");
}

async function getExistingKind(targetPath: string): Promise<"directory" | "file" | null> {
  try {
    const stats = await stat(targetPath);

    if (stats.isDirectory()) {
      return "directory";
    }

    if (stats.isFile()) {
      return "file";
    }

    return null;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function ensurePlanningEntry(
  rootDir: string,
  entry: PlanningEntry,
  result: InitializePlanningStateResult,
): Promise<void> {
  const existingKind = await getExistingKind(entry.path);
  const relativePath = toRelativePath(rootDir, entry.path);

  if (existingKind === entry.kind) {
    result.existingPaths.push(relativePath);
    return;
  }

  if (existingKind !== null) {
    throw new Error(
      `Cannot initialize ${relativePath}: expected a ${entry.kind}, found a ${existingKind}`,
    );
  }

  if (entry.kind === "directory") {
    await mkdir(entry.path, { recursive: true });
  } else {
    await writeJsonFile(entry.path, entry.value);
  }

  result.createdPaths.push(relativePath);
}

export async function initializePlanningState(
  rootDir: string,
  options: InitializePlanningStateOptions = {},
): Promise<InitializePlanningStateResult> {
  const planningDir = join(rootDir, ".planning");
  const result: InitializePlanningStateResult = {
    createdPaths: [],
    existingPaths: [],
  };
  const entries: PlanningEntry[] = [
    { path: planningDir, kind: "directory" },
    { path: join(planningDir, "project.json"), kind: "file", value: defaultProjectState },
    { path: join(planningDir, "config.json"), kind: "file", value: options.config ?? {} },
    {
      path: join(planningDir, "requirements.json"),
      kind: "file",
      value: defaultRequirementsState,
    },
    { path: join(planningDir, "phases.json"), kind: "file", value: defaultPhasesState },
    { path: join(planningDir, "rules.json"), kind: "file", value: defaultRulesState },
    { path: join(planningDir, "runs"), kind: "directory" },
    { path: join(planningDir, "verifications"), kind: "directory" },
  ];

  for (const entry of entries) {
    await ensurePlanningEntry(rootDir, entry, result);
  }

  return result;
}
