import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

import type { ZodType } from "zod";

import { parseStateFile } from "./parse";

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entryValue]) => [key, sortJsonValue(entryValue)]),
    );
  }

  return value;
}

export function toDeterministicJson(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

export async function readJsonFile<T>(filePath: string, schema: ZodType<T>): Promise<T> {
  const fileName = basename(filePath);
  const contents = await readFile(filePath, "utf8");

  let parsed: unknown;

  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new Error(`Invalid ${fileName}: File must contain valid JSON (${message})`);
  }

  return parseStateFile(fileName, schema, parsed);
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.${randomUUID()}.tmp`;

  await writeFile(tempPath, toDeterministicJson(value), "utf8");

  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
