import { readdir, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const supportedTextExtensions = new Set([".md", ".markdown", ".txt"]);

const ignoredDirectoryNames = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

const ignoredPlanningNames = new Set(["cache", "tmp", "locks"]);

export interface IngestTextInput {
  path: string;
  relativePath: string;
  text: string;
}

export interface ExpandIngestPathsOptions {
  rootDir: string;
  inputPaths: string[];
}

function toAbsolutePath(rootDir: string, inputPath: string): string {
  return isAbsolute(inputPath) ? resolve(inputPath) : resolve(rootDir, inputPath);
}

function toRelativePath(rootDir: string, absolutePath: string): string {
  const relativePath = relative(rootDir, absolutePath);
  return relativePath === "" ? "." : relativePath.split(sep).join("/");
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isIgnoredPath(relativePath: string, isDirectory: boolean): boolean {
  const segments = relativePath.split("/").filter(Boolean);

  if (segments.some((segment) => ignoredDirectoryNames.has(segment))) {
    return true;
  }

  const planningIndex = segments.indexOf(".planning");
  if (planningIndex !== -1) {
    const nextSegment = segments[planningIndex + 1];
    if (nextSegment !== undefined && ignoredPlanningNames.has(nextSegment)) {
      return true;
    }
  }

  return !isDirectory && segments.at(-1) === "state.sqlite" && segments.includes(".planning");
}

function assertSupportedTextFile(relativePath: string): void {
  const extension = extname(relativePath).toLowerCase();

  if (!supportedTextExtensions.has(extension)) {
    throw new Error(
      `Unsupported ingest input ${relativePath}: only .md, .markdown, and .txt files are supported in this phase.`,
    );
  }
}

async function collectFilePaths(rootDir: string, absolutePath: string): Promise<string[]> {
  const relativePath = toRelativePath(rootDir, absolutePath);

  let stats;
  try {
    stats = await stat(absolutePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown file system error";
    throw new Error(`Unreadable ingest input ${relativePath}: ${detail}`);
  }

  if (isIgnoredPath(relativePath, stats.isDirectory())) {
    return [];
  }

  if (stats.isFile()) {
    assertSupportedTextFile(relativePath);
    return [absolutePath];
  }

  if (!stats.isDirectory()) {
    throw new Error(`Unsupported ingest input ${relativePath}: expected a file or directory.`);
  }

  let entries;
  try {
    entries = await readdir(absolutePath, { withFileTypes: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown file system error";
    throw new Error(`Unreadable ingest input ${relativePath}: ${detail}`);
  }
  const sortedEntries = entries
    .map((entry) => entry.name)
    .sort(comparePaths);
  const filePaths: string[] = [];

  for (const entryName of sortedEntries) {
    const entryPath = resolve(absolutePath, entryName);
    filePaths.push(...await collectFilePaths(rootDir, entryPath));
  }

  return filePaths;
}

async function readTextInput(rootDir: string, absolutePath: string): Promise<IngestTextInput> {
  const relativePath = toRelativePath(rootDir, absolutePath);

  try {
    return {
      path: absolutePath,
      relativePath,
      text: await readFile(absolutePath, "utf8"),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown file system error";
    throw new Error(`Unreadable ingest input ${relativePath}: ${detail}`);
  }
}

export async function expandIngestPaths(options: ExpandIngestPathsOptions): Promise<IngestTextInput[]> {
  if (options.inputPaths.length === 0) {
    throw new Error("At least one ingest input path is required.");
  }

  const rootDir = resolve(options.rootDir);
  const discoveredPaths = new Set<string>();

  for (const inputPath of options.inputPaths) {
    const absolutePath = toAbsolutePath(rootDir, inputPath);
    for (const filePath of await collectFilePaths(rootDir, absolutePath)) {
      discoveredPaths.add(filePath);
    }
  }

  const sortedPaths = [...discoveredPaths].sort((left, right) =>
    comparePaths(toRelativePath(rootDir, left), toRelativePath(rootDir, right)),
  );

  return Promise.all(sortedPaths.map((filePath) => readTextInput(rootDir, filePath)));
}
