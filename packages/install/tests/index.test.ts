import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  describeInstallPackage,
  generateOpenCodeAgentArtifacts,
  generateOpenCodeCommandArtifacts,
  getOpenCodeAgentsDir,
  getOpenCodeCommandsDir,
  installOpenCodeAgentArtifacts,
  installOpenCodeCommandArtifacts,
  installPackageName,
} from "../src/index";

const agentNames = [
  "orchestrator",
  "context-scout",
  "prd-ingestor",
  "grill-me",
  "slice-planner",
  "task-planner",
  "executor",
  "reviewer",
  "verifier",
  "repairer",
  "docs-writer",
] as const;

describe("@phasekit/install", () => {
  test("exports minimal package metadata", () => {
    expect(installPackageName).toBe("@phasekit/install");
    expect(describeInstallPackage()).toEqual({ name: "@phasekit/install" });
  });

  test("generates deterministic OpenCode command artifact paths under a config root", async () => {
    await withTempDir(async (configRoot) => {
      const commandsDir = join(configRoot, "opencode", "commands");

      expect(getOpenCodeCommandsDir({ configRoot })).toBe(commandsDir);
      expect(generateOpenCodeCommandArtifacts({ configRoot })).toEqual(generateOpenCodeCommandArtifacts({ configRoot }));
      expect(generateOpenCodeCommandArtifacts({ configRoot }).map((artifact) => artifact.path)).toEqual([
        join(commandsDir, "pk-init.md"),
        join(commandsDir, "pk-status.md"),
        join(commandsDir, "pk-next.md"),
        join(commandsDir, "pk-config.md"),
        join(commandsDir, "pk-ingest.md"),
      ]);
    });
  });

  test("generates deterministic OpenCode command artifact paths under a home dir", async () => {
    await withTempDir(async (homeDir) => {
      expect(generateOpenCodeCommandArtifacts({ homeDir }).map((artifact) => artifact.path)).toEqual([
        join(homeDir, ".config", "opencode", "commands", "pk-init.md"),
        join(homeDir, ".config", "opencode", "commands", "pk-status.md"),
        join(homeDir, ".config", "opencode", "commands", "pk-next.md"),
        join(homeDir, ".config", "opencode", "commands", "pk-config.md"),
        join(homeDir, ".config", "opencode", "commands", "pk-ingest.md"),
      ]);
    });
  });

  test("writes managed command files that call plugin tools", async () => {
    await withTempDir(async (configRoot) => {
      const result = await installOpenCodeCommandArtifacts({ configRoot });

      expect(result.commandsDir).toBe(join(configRoot, "opencode", "commands"));
      expect(result.artifacts.map((artifact) => artifact.name)).toEqual([
        "pk-init",
        "pk-status",
        "pk-next",
        "pk-config",
        "pk-ingest",
      ]);

      await expectCommandContent(configRoot, "pk-init", "phasekit_init_project");
      await expectCommandContent(configRoot, "pk-status", "phasekit_get_status");
      await expectCommandContent(configRoot, "pk-next", "phasekit_next_action");
      await expectCommandContent(configRoot, "pk-config", "phasekit_get_status");
      await expectCommandContent(configRoot, "pk-ingest", "phasekit_ingest_paths");
    });
  });

  test("generates a thin pk-ingest command wrapper", async () => {
    await withTempDir(async (configRoot) => {
      const artifact = generateOpenCodeCommandArtifacts({ configRoot }).find(({ name }) => name === "pk-ingest");

      if (artifact === undefined) {
        throw new Error("Missing pk-ingest generated artifact.");
      }

      expect(artifact.path).toBe(join(configRoot, "opencode", "commands", "pk-ingest.md"));
      expect(artifact.content).toContain("# /pk-ingest");
      expect(artifact.content).toContain("phasekit_ingest_paths");
      expect(artifact.content).toContain("inputPaths");
      expect(artifact.content).toContain("user-provided paths");
      expect(artifact.content).not.toContain("expandIngestPaths");
      expect(artifact.content).not.toContain("extractSourceRequirements");
      expect(artifact.content).not.toContain("/phasekit:ingest");
    });
  });

  test("safely overwrites managed command artifacts", async () => {
    await withTempDir(async (configRoot) => {
      await installOpenCodeCommandArtifacts({ configRoot });
      await writeFile(
        join(configRoot, "opencode", "commands", "pk-status.md"),
        "<!-- phasekit:managed opencode-command v1 -->\nmodified managed content\n",
        "utf8",
      );

      await installOpenCodeCommandArtifacts({ configRoot });

      const expectedContent = generateOpenCodeCommandArtifacts({ configRoot }).find(
        (artifact) => artifact.name === "pk-status",
      )?.content;

      if (expectedContent === undefined) {
        throw new Error("Missing pk-status generated artifact.");
      }

      expect(await readFile(join(configRoot, "opencode", "commands", "pk-status.md"), "utf8")).toBe(expectedContent);
    });
  });

  test("refuses to overwrite unmanaged command artifacts", async () => {
    await withTempDir(async (configRoot) => {
      const unmanagedPath = join(configRoot, "opencode", "commands", "pk-next.md");

      await installOpenCodeCommandArtifacts({ configRoot });
      await writeFile(unmanagedPath, "user command\n", "utf8");

      await expect(installOpenCodeCommandArtifacts({ configRoot })).rejects.toThrow(
        `Refusing to overwrite unmanaged OpenCode command artifact: ${unmanagedPath}`,
      );
      expect(await readFile(unmanagedPath, "utf8")).toBe("user command\n");
    });
  });

  test("generates deterministic OpenCode agent artifact paths under a config root", async () => {
    await withTempDir(async (configRoot) => {
      const agentsDir = join(configRoot, "opencode", "agents");
      const artifacts = generateOpenCodeAgentArtifacts({ configRoot });

      expect(getOpenCodeAgentsDir({ configRoot })).toBe(agentsDir);
      expect(artifacts).toEqual(generateOpenCodeAgentArtifacts({ configRoot }));
      expect(artifacts.map((artifact) => artifact.path)).toEqual(
        agentNames.map((name) => join(agentsDir, `${name}.md`)),
      );
    });
  });

  test("generates deterministic OpenCode agent artifact paths under a home dir", async () => {
    await withTempDir(async (homeDir) => {
      expect(generateOpenCodeAgentArtifacts({ homeDir }).map((artifact) => artifact.path)).toEqual(
        agentNames.map((name) => join(homeDir, ".config", "opencode", "agents", `${name}.md`)),
      );
    });
  });

  test("writes managed agent files with narrow tool-focused instructions", async () => {
    await withTempDir(async (configRoot) => {
      const result = await installOpenCodeAgentArtifacts({ configRoot });

      expect(result.agentsDir).toBe(join(configRoot, "opencode", "agents"));
      expect(result.artifacts.map((artifact) => artifact.name)).toEqual([...agentNames]);

      for (const name of agentNames) {
        await expectAgentContent(configRoot, name);
      }
    });
  });

  test("safely overwrites managed agent artifacts", async () => {
    await withTempDir(async (configRoot) => {
      await installOpenCodeAgentArtifacts({ configRoot });
      await writeFile(
        join(configRoot, "opencode", "agents", "executor.md"),
        "<!-- phasekit:managed opencode-agent v1 -->\nmodified managed content\n",
        "utf8",
      );

      await installOpenCodeAgentArtifacts({ configRoot });

      const expectedContent = generateOpenCodeAgentArtifacts({ configRoot }).find(
        (artifact) => artifact.name === "executor",
      )?.content;

      if (expectedContent === undefined) {
        throw new Error("Missing executor generated artifact.");
      }

      expect(await readFile(join(configRoot, "opencode", "agents", "executor.md"), "utf8")).toBe(expectedContent);
    });
  });

  test("refuses to overwrite unmanaged agent artifacts", async () => {
    await withTempDir(async (configRoot) => {
      const unmanagedPath = join(configRoot, "opencode", "agents", "reviewer.md");

      await installOpenCodeAgentArtifacts({ configRoot });
      await writeFile(unmanagedPath, "user agent\n", "utf8");

      await expect(installOpenCodeAgentArtifacts({ configRoot })).rejects.toThrow(
        `Refusing to overwrite unmanaged OpenCode agent artifact: ${unmanagedPath}`,
      );
      expect(await readFile(unmanagedPath, "utf8")).toBe("user agent\n");
    });
  });
});

async function expectCommandContent(configRoot: string, name: string, toolName: string): Promise<void> {
  const content = await readFile(join(configRoot, "opencode", "commands", `${name}.md`), "utf8");

  expect(content).toStartWith("<!-- phasekit:managed opencode-command v1 -->\n");
  expect(content).toContain(`description:`);
  expect(content).toContain(`# /${name}`);
  expect(content).toContain(toolName);
  expect(content).toContain("tool");
  expect(content).not.toContain("initializePlanningState");
  expect(content).not.toContain("getStatus({");
}

async function expectAgentContent(configRoot: string, name: string): Promise<void> {
  const content = await readFile(join(configRoot, "opencode", "agents", `${name}.md`), "utf8");

  expect(content).toStartWith("<!-- phasekit:managed opencode-agent v1 -->\n");
  expect(content).toContain("description:");
  expect(content).toContain(`# ${name}`);
  expect(content).toContain("Phasekit plugin tools as the executable surface");
  expect(content).toContain("Do not make assumptions");
  expect(content).toContain("Do not perform broad rewrites");
  expect(content).toContain("Do not continue through scope drift");
  expect(content).toContain("Do not add compatibility with old GSD commands");
  expect(content).toContain("Do not treat markdown artifacts");
  expect(content).toContain("Do not bypass native Phasekit tool validation");
  expect(content).not.toContain("phasekit_create_run");
  expect(content).not.toContain("phasekit_complete_task");
}

async function withTempDir(run: (path: string) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "phasekit-install-"));

  try {
    await run(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}
