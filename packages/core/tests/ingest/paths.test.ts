import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { expandIngestPaths } from "../../src/index";

const temporaryDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "phasekit-ingest-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function writeTextFile(rootDir: string, relativePath: string, text: string): Promise<void> {
  const filePath = join(rootDir, ...relativePath.split("/"));
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, text, "utf8");
}

describe("ingest path expansion", () => {
  test("expands multiple files and folders in deterministic order", async () => {
    const rootDir = await createTempDirectory();
    await writeTextFile(rootDir, "docs/zeta.md", "Zeta\n");
    await writeTextFile(rootDir, "docs/alpha.txt", "Alpha\n");
    await writeTextFile(rootDir, "README.markdown", "Read me\n");

    const inputs = await expandIngestPaths({
      rootDir,
      inputPaths: ["docs/zeta.md", "README.markdown", "docs"],
    });

    expect(inputs.map((input) => input.relativePath)).toEqual([
      "README.markdown",
      "docs/alpha.txt",
      "docs/zeta.md",
    ]);
    expect(inputs.map((input) => input.text)).toEqual(["Read me\n", "Alpha\n", "Zeta\n"]);
  });

  test("skips ignored folder paths during folder ingest", async () => {
    const rootDir = await createTempDirectory();
    await writeTextFile(rootDir, "docs/keep.md", "Keep\n");
    await writeTextFile(rootDir, "docs/node_modules/package/readme.md", "Ignore dependency\n");
    await writeTextFile(rootDir, "docs/.planning/cache/generated.md", "Ignore cache\n");
    await writeTextFile(rootDir, "docs/.planning/tmp/generated.md", "Ignore tmp\n");
    await writeTextFile(rootDir, "docs/.planning/notes.md", "Keep planning notes\n");

    const inputs = await expandIngestPaths({ rootDir, inputPaths: ["docs"] });

    expect(inputs.map((input) => input.relativePath)).toEqual([
      "docs/.planning/notes.md",
      "docs/keep.md",
    ]);
  });

  test("rejects unsupported files with an actionable error", async () => {
    const rootDir = await createTempDirectory();
    await writeTextFile(rootDir, "docs/page.html", "<h1>Unsupported</h1>\n");

    await expect(expandIngestPaths({ rootDir, inputPaths: ["docs/page.html"] })).rejects.toThrow(
      "Unsupported ingest input docs/page.html: only .md, .markdown, and .txt files are supported in this phase.",
    );
  });

  test("rejects missing inputs with an actionable error", async () => {
    const rootDir = await createTempDirectory();

    await expect(expandIngestPaths({ rootDir, inputPaths: ["missing.md"] })).rejects.toThrow(
      /Unreadable ingest input missing\.md:/,
    );
  });

  test("rejects unreadable directories with an actionable error", async () => {
    const rootDir = await createTempDirectory();
    const directoryPath = join(rootDir, "private-docs");
    await mkdir(directoryPath);
    await chmod(directoryPath, 0o000);

    try {
      await expect(expandIngestPaths({ rootDir, inputPaths: ["private-docs"] })).rejects.toThrow(
        /Unreadable ingest input private-docs:/,
      );
    } finally {
      await chmod(directoryPath, 0o700);
    }
  });

  test("requires at least one input path", async () => {
    const rootDir = await createTempDirectory();

    await expect(expandIngestPaths({ rootDir, inputPaths: [] })).rejects.toThrow(
      "At least one ingest input path is required.",
    );
  });
});
