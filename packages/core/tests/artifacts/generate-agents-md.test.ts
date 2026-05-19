import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { generateAgentsMdArtifact, initializePlanningState } from "../../src";

const temporaryDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "phasekit-generate-agents-md-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("generateAgentsMdArtifact", () => {
  test("reads canonical rules.json and writes deterministic managed AGENTS.md", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeFile(
      join(rootDir, ".planning", "rules.json"),
      `${JSON.stringify({ rules: [{ id: "r1", category: "workflow", text: "Keep scope narrow." }] }, null, 2)}\n`,
      "utf8",
    );

    const input = {
      rootDir,
      projectContext: {
        projectName: "Phasekit",
        toolNames: ["phasekit_generate_agents_md"],
      },
    };

    const first = await generateAgentsMdArtifact(input);
    const firstContent = await readFile(join(rootDir, "AGENTS.md"), "utf8");
    const second = await generateAgentsMdArtifact(input);
    const secondContent = await readFile(join(rootDir, "AGENTS.md"), "utf8");

    expect(first).toEqual({ path: "AGENTS.md" });
    expect(second).toEqual({ path: "AGENTS.md" });
    expect(firstContent).toBe(secondContent);
    expect(firstContent).toContain("`r1`: Keep scope narrow.");
  });

  test("refuses to overwrite unmanaged AGENTS.md content", async () => {
    const rootDir = await createTempDirectory();
    await initializePlanningState(rootDir);
    await writeFile(join(rootDir, "AGENTS.md"), "# unmanaged\n", "utf8");

    await expect(generateAgentsMdArtifact({ rootDir, projectContext: { projectName: "Phasekit" } })).rejects.toThrow(
      "Refusing to overwrite unmanaged AGENTS.md content.",
    );
  });
});
