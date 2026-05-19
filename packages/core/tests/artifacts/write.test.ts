import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { agentsMdManagedMarker, projectArtifactManagedMarker, writeGeneratedArtifact } from "../../src";

const managedConfigArtifacts = [
  {
    directory: "opencode/commands",
    fileNamePattern: /^pk-[a-z0-9-]+\.md$/,
    managedMarker: "<!-- phasekit:managed opencode-command v1 -->",
  },
  {
    directory: "opencode/agents",
    fileNamePattern: /^[a-z0-9-]+\.md$/,
    managedMarker: "<!-- phasekit:managed opencode-agent v1 -->",
  },
];

const temporaryDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "phasekit-artifact-write-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("generated artifact writing", () => {
  test("writes approved project artifact paths", async () => {
    const rootDir = await createTempDirectory();
    await writeGeneratedArtifact({ rootDir, path: "PROJECT.md", content: "# Project\n" });

    expect(await readFile(join(rootDir, "PROJECT.md"), "utf8")).toBe("# Project\n");
  });

  test("refuses unmanaged overwrites where managed markers are required", async () => {
    const rootDir = await createTempDirectory();
    const configRoot = await createTempDirectory();
    const agentsPath = join(rootDir, "AGENTS.md");
    await writeFile(agentsPath, "# Custom\n", "utf8");

    await expect(writeGeneratedArtifact({ rootDir, path: "AGENTS.md", content: `${agentsMdManagedMarker}\nmanaged\n` })).rejects.toThrow(
      "Refusing to overwrite unmanaged AGENTS.md content.",
    );

    const commandPath = join(configRoot, "opencode", "commands", "pk-status.md");
    await mkdir(dirname(commandPath), { recursive: true });
    await writeFile(commandPath, "# custom\n", "utf8");
    await expect(
      writeGeneratedArtifact({
        rootDir,
        path: "PROJECT.md",
        content: `${projectArtifactManagedMarker}\n# PROJECT.md\n`,
      }),
    ).resolves.toEqual({ path: "PROJECT.md" });

    const projectPath = join(rootDir, "PROJECT.md");
    await writeFile(projectPath, "# custom project\n", "utf8");
    await expect(
      writeGeneratedArtifact({
        rootDir,
        path: "PROJECT.md",
        content: `${projectArtifactManagedMarker}\n# PROJECT.md\n`,
      }),
    ).rejects.toThrow("Refusing to overwrite unmanaged generated artifact:");

    await expect(
      writeGeneratedArtifact({
        rootDir,
        configRoot,
        approvedConfigArtifacts: managedConfigArtifacts,
        path: "opencode/commands/pk-status.md",
        content: "<!-- phasekit:managed opencode-command v1 -->\nmanaged\n",
      }),
    ).rejects.toThrow("Refusing to overwrite unmanaged generated artifact:");
  });

  test("rejects unapproved artifact paths", async () => {
    const rootDir = await createTempDirectory();
    await expect(writeGeneratedArtifact({ rootDir, path: "docs/guide.md", content: "x" })).rejects.toThrow(
      'Refusing to write artifact "docs/guide.md": path is not an approved generated artifact location.',
    );
  });

  test("writes approved OpenCode artifacts under the configured global config root", async () => {
    const rootDir = await createTempDirectory();
    const configRoot = await createTempDirectory();

    const result = await writeGeneratedArtifact({
      rootDir,
      configRoot,
      approvedConfigArtifacts: managedConfigArtifacts,
      path: "opencode/commands/pk-status.md",
      content: "<!-- phasekit:managed opencode-command v1 -->\nmanaged\n",
    });

    expect(result).toEqual({ path: "opencode/commands/pk-status.md" });
    expect(await readFile(join(configRoot, "opencode", "commands", "pk-status.md"), "utf8")).toBe(
      "<!-- phasekit:managed opencode-command v1 -->\nmanaged\n",
    );
    await expect(readFile(join(rootDir, ".config", "opencode", "commands", "pk-status.md"), "utf8")).rejects.toThrow();
  });

  test("rejects repo-local OpenCode artifact paths", async () => {
    const rootDir = await createTempDirectory();
    const configRoot = await createTempDirectory();

    await expect(
      writeGeneratedArtifact({
        rootDir,
        configRoot,
        approvedConfigArtifacts: managedConfigArtifacts,
        path: ".config/opencode/commands/pk-status.md",
        content: "<!-- phasekit:managed opencode-command v1 -->\nmanaged\n",
      }),
    ).rejects.toThrow(
      'Refusing to write artifact ".config/opencode/commands/pk-status.md": path is not an approved generated artifact location.',
    );
  });
});
