import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  describeInstallPackage,
  generateOpenCodeCommandArtifacts,
  getOpenCodeCommandsDir,
  installOpenCodeCommandArtifacts,
  installPackageName,
} from "../src/index";

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
      ]);
    });
  });

  test("writes managed command files that call plugin tools", async () => {
    await withTempDir(async (configRoot) => {
      const result = await installOpenCodeCommandArtifacts({ configRoot });

      expect(result.commandsDir).toBe(join(configRoot, "opencode", "commands"));
      expect(result.artifacts.map((artifact) => artifact.name)).toEqual(["pk-init", "pk-status", "pk-next", "pk-config"]);

      await expectCommandContent(configRoot, "pk-init", "phasekit_init_project");
      await expectCommandContent(configRoot, "pk-status", "phasekit_get_status");
      await expectCommandContent(configRoot, "pk-next", "phasekit_next_action");
      await expectCommandContent(configRoot, "pk-config", "phasekit_get_status");
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

async function withTempDir(run: (path: string) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "phasekit-install-"));

  try {
    await run(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}
