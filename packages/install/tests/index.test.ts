import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultPhasekitPluginSpec,
  describeInstallPackage,
  generateOpenCodeAgentArtifacts,
  generateOpenCodeCommandArtifacts,
  getOpenCodeAgentsDir,
  getOpenCodeCommandsDir,
  installPhasekitOpenCode,
  installOpenCodeAgentArtifacts,
  installOpenCodeBootstrapArtifacts,
  installOpenCodeCommandArtifacts,
  installPackageName,
  uninstallPhasekitOpenCode,
} from "../src/index";

const commandNames = ["pk-init", "pk-status", "pk-next", "pk-config", "pk-ingest", "pk-add-phase", "pk-run-phase", "pk-verify"] as const;
const supersededCommandPrefixes = ["/phasekit:"] as const;

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

describe("@depkit/phasekit-install", () => {
  test("exports minimal package metadata", () => {
    expect(installPackageName).toBe("@depkit/phasekit-install");
    expect(describeInstallPackage()).toEqual({ name: "@depkit/phasekit-install" });
  });

  test("generates deterministic OpenCode command artifact paths under a config root", async () => {
    await withTempDir(async (configRoot) => {
      const commandsDir = join(configRoot, "opencode", "commands");

      expect(getOpenCodeCommandsDir({ configRoot })).toBe(commandsDir);
      expect(generateOpenCodeCommandArtifacts({ configRoot })).toEqual(generateOpenCodeCommandArtifacts({ configRoot }));
      expect(generateOpenCodeCommandArtifacts({ configRoot }).map((artifact) => artifact.path)).toEqual(
        commandNames.map((name) => join(commandsDir, `${name}.md`)),
      );
    });
  });

  test("generates deterministic OpenCode command artifact paths under a home dir", async () => {
    await withTempDir(async (homeDir) => {
      expect(generateOpenCodeCommandArtifacts({ homeDir }).map((artifact) => artifact.path)).toEqual(
        commandNames.map((name) => join(homeDir, ".config", "opencode", "commands", `${name}.md`)),
      );
    });
  });

  test("writes managed command files that call plugin tools", async () => {
    await withTempDir(async (configRoot) => {
      const result = await installOpenCodeCommandArtifacts({ configRoot });

      expect(result.commandsDir).toBe(join(configRoot, "opencode", "commands"));
      expect(result.artifacts.map((artifact) => artifact.name)).toEqual([...commandNames]);

      await expectCommandContent(configRoot, "pk-init", "phasekit_init_project");
      await expectCommandContent(configRoot, "pk-status", "phasekit_get_status");
      await expectCommandContent(configRoot, "pk-next", "phasekit_next_action");
      await expectCommandContent(configRoot, "pk-config", "phasekit_get_status");
      await expectCommandContent(configRoot, "pk-ingest", "phasekit_ingest_paths");
      await expectCommandContent(configRoot, "pk-add-phase", "phasekit_add_phase");
      await expectCommandContent(configRoot, "pk-run-phase", "phasekit_run_phase");
      await expectCommandContent(configRoot, "pk-verify", "phasekit_verify_scope");
    });
  });

  test("pk-init command calls the native init tool without exploratory reads", async () => {
    await withTempDir(async (configRoot) => {
      const artifact = generateOpenCodeCommandArtifacts({ configRoot }).find(({ name }) => name === "pk-init");

      if (artifact === undefined) {
        throw new Error("Missing pk-init generated artifact.");
      }

      expect(artifact.content).toContain("native Phasekit tool wrapper, not a project exploration task");
      expect(artifact.content).toContain("Your next action must be to call `phasekit_init_project`");
      expect(artifact.content).toContain("Do not call `glob`, `read`, `grep`, `bash`, or any other exploratory tool before `phasekit_init_project`");
      expect(artifact.content).toContain("the init tool owns discovery");
      expect(artifact.content).toContain("Do not call the `question` tool at all for this wrapper");
      expect(artifact.content).toContain("pass those exact paths as `contextPaths`");
      expect(artifact.content).toContain("default discovery for `PRD.md` and `IMPLEMENTATION-GUIDE.md`");
      expect(artifact.content).toContain("relay that payload directly and stop");
      expect(artifact.content).toContain("do not call any other tool");
      expect(artifact.content).toContain("phasekit_init_project");
    });
  });

  test("generates a thin pk-add-phase command wrapper", async () => {
    await withTempDir(async (configRoot) => {
      const artifact = generateOpenCodeCommandArtifacts({ configRoot }).find(({ name }) => name === "pk-add-phase");

      if (artifact === undefined) {
        throw new Error("Missing pk-add-phase generated artifact.");
      }

      expect(artifact.path).toBe(join(configRoot, "opencode", "commands", "pk-add-phase.md"));
      expect(artifact.content).toContain("# /pk-add-phase");
      expect(artifact.content).toContain("phasekit_add_phase");
      expect(artifact.content).toContain("goal");
      expect(artifact.content).toContain("user-provided goal");
      expect(artifact.content).toContain("do not call any other tool");
      expect(artifact.content).not.toContain("extractSourceRequirements");
      expect(artifact.content).not.toContain("sliceRequirementsIntoPhases");
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
      expect(artifact.content).toContain("do not call any other tool");
      expect(artifact.content).not.toContain("expandIngestPaths");
      expect(artifact.content).not.toContain("extractSourceRequirements");
      expect(artifact.content).not.toContain("/phasekit:ingest");
    });
  });

  test("generates a thin pk-run-phase command wrapper", async () => {
    await withTempDir(async (configRoot) => {
      const artifact = generateOpenCodeCommandArtifacts({ configRoot }).find(({ name }) => name === "pk-run-phase");

      if (artifact === undefined) {
        throw new Error("Missing pk-run-phase generated artifact.");
      }

      expect(artifact.path).toBe(join(configRoot, "opencode", "commands", "pk-run-phase.md"));
      expect(artifact.content).toContain("# /pk-run-phase");
      expect(artifact.content).toContain("phasekit_run_phase");
      expect(artifact.content).toContain("phasekit_run_next_phase({})");
      expect(artifact.content).toContain("Do not call `phasekit_next_action`, `phasekit_create_run`, `phasekit_advance`, `phasekit_verify_scope`, `bash`, or any unrelated tool");
      expect(artifact.content).toContain("Do not implement planning, task execution, review, verification, repair loops, commit-gating, package installation, shell commands, or `.planning` mutations");
      expect(artifact.content).toContain("do not retry and do not call any other tool");
      expect(artifact.content).toContain("If the user provides a phase id or JSON payload");
      expect(artifact.content).toContain("If the user provides no arguments");
      expect(artifact.content).not.toContain("readRunState");
      expect(artifact.content).not.toContain("claimRunTask");
      expect(artifact.content).not.toContain("completeRunTask");
      expect(artifact.content).not.toContain("recordRunBlocker");
      expect(artifact.content).not.toContain("/phasekit:create-run");
      expect(artifact.content).not.toContain("/phasekit:advance");
      expect(artifact.content).not.toContain("/phasekit:run-phase");
    });
  });

  test("generates a non-mutating pk-next command wrapper", async () => {
    await withTempDir(async (configRoot) => {
      const artifact = generateOpenCodeCommandArtifacts({ configRoot }).find(({ name }) => name === "pk-next");

      if (artifact === undefined) {
        throw new Error("Missing pk-next generated artifact.");
      }

      expect(artifact.path).toBe(join(configRoot, "opencode", "commands", "pk-next.md"));
      expect(artifact.content).toContain("# /pk-next");
      expect(artifact.content).toContain("phasekit_next_action");
      expect(artifact.content).toContain("Do not advance state");
      expect(artifact.content).toContain("do not call any other tool");
      expect(artifact.content).not.toContain("phasekit_advance");
    });
  });

  test("generates a thin pk-verify command wrapper", async () => {
    await withTempDir(async (configRoot) => {
      const artifact = generateOpenCodeCommandArtifacts({ configRoot }).find(({ name }) => name === "pk-verify");

      if (artifact === undefined) {
        throw new Error("Missing pk-verify generated artifact.");
      }

      expect(artifact.path).toBe(join(configRoot, "opencode", "commands", "pk-verify.md"));
      expect(artifact.content).toContain("# /pk-verify");
      expect(artifact.content).toContain("phasekit_verify_scope");
      expect(artifact.content).toContain("user-provided verification scope");
      expect(artifact.content).toContain("task, phase, group, or all scope");
      expect(artifact.content).toContain("matching phase run context is available");
      expect(artifact.content).toContain("do not call any other tool");
      expect(artifact.content).not.toContain("verifyScopeSchema");
      expect(artifact.content).not.toContain("verificationResultSchema");
      expect(artifact.content).not.toContain("writeRunState");
      expect(artifact.content).not.toContain("/phasekit:verify");
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

  test("installs command and agent bootstrap artifacts through one deterministic path", async () => {
    await withTempDir(async (configRoot) => {
      const result = await installOpenCodeBootstrapArtifacts({ configRoot });

      expect(result.commands.commandsDir).toBe(join(configRoot, "opencode", "commands"));
      expect(result.agents.agentsDir).toBe(join(configRoot, "opencode", "agents"));
      expect(result.commands.artifacts.map((artifact) => artifact.name)).toEqual([...commandNames]);
      expect(result.agents.artifacts.map((artifact) => artifact.name)).toEqual([...agentNames]);
    });
  });

  test("installs global OpenCode config, commands, and agents", async () => {
    await withTempDir(async (configRoot) => {
      const result = await installPhasekitOpenCode({ configRoot });

      expect(result.scope).toBe("global");
      expect(result.config.configPath).toBe(join(configRoot, "opencode", "opencode.jsonc"));
      expect(result.config.created).toBe(true);
      expect(result.commands.commandsDir).toBe(join(configRoot, "opencode", "commands"));
      expect(result.agents.agentsDir).toBe(join(configRoot, "opencode", "agents"));

      expect(await readConfigFile(join(configRoot, "opencode", "opencode.jsonc"))).toEqual({
        $schema: "https://opencode.ai/config.json",
        plugin: [defaultPhasekitPluginSpec],
      });
    });
  });

  test("installs project-scoped OpenCode artifacts under .opencode", async () => {
    await withTempDir(async (projectDir) => {
      const result = await installPhasekitOpenCode({ projectDir });

      expect(result.scope).toBe("project");
      expect(result.baseDir).toBe(join(projectDir, ".opencode"));
      expect(result.config.configPath).toBe(join(projectDir, ".opencode", "opencode.jsonc"));
      expect(result.commands.commandsDir).toBe(join(projectDir, ".opencode", "commands"));
      expect(result.agents.agentsDir).toBe(join(projectDir, ".opencode", "agents"));
    });
  });

  test("updates an existing OpenCode json config instead of creating jsonc", async () => {
    await withTempDir(async (configRoot) => {
      const configDir = join(configRoot, "opencode");
      const configPath = join(configDir, "opencode.json");

      await mkdir(configDir, { recursive: true });
      await writeFile(
        configPath,
        `${JSON.stringify({ plugin: ["example-plugin", "@depkit/phasekit-opencode"] }, null, 2)}\n`,
        "utf8",
      );

      const result = await installPhasekitOpenCode({ configRoot });

      expect(result.config.configPath).toBe(configPath);
      expect(await readConfigFile(configPath)).toEqual({
        $schema: "https://opencode.ai/config.json",
        plugin: ["example-plugin", defaultPhasekitPluginSpec],
      });
      await expect(readFile(join(configDir, "opencode.jsonc"), "utf8")).rejects.toThrow();
    });
  });

  test("replaces the legacy plugin subpath with the package root spec", async () => {
    await withTempDir(async (configRoot) => {
      const configDir = join(configRoot, "opencode");
      const configPath = join(configDir, "opencode.jsonc");

      await mkdir(configDir, { recursive: true });
      await writeFile(
        configPath,
        `${JSON.stringify({ plugin: ["@depkit/phasekit-opencode/plugin", "example-plugin"] }, null, 2)}\n`,
        "utf8",
      );

      const result = await installPhasekitOpenCode({ configRoot });

      expect(result.config.removedManagedPluginSpecs).toEqual(["@depkit/phasekit-opencode/plugin"]);
      expect(await readConfigFile(configPath)).toEqual({
        $schema: "https://opencode.ai/config.json",
        plugin: ["example-plugin", defaultPhasekitPluginSpec],
      });
    });
  });

  test("does not update config when project install hits unmanaged command conflicts", async () => {
    await withTempDir(async (projectDir) => {
      const commandsDir = join(projectDir, ".opencode", "commands");
      const configPath = join(projectDir, ".opencode", "opencode.jsonc");
      const unmanagedPath = join(commandsDir, "pk-next.md");

      await mkdir(commandsDir, { recursive: true });
      await writeFile(unmanagedPath, "custom project command\n", "utf8");

      await expect(installPhasekitOpenCode({ projectDir })).rejects.toThrow(
        `Refusing to overwrite unmanaged OpenCode command artifact: ${unmanagedPath}`,
      );
      await expect(readFile(configPath, "utf8")).rejects.toThrow();
      expect(await readFile(unmanagedPath, "utf8")).toBe("custom project command\n");
    });
  });

  test("force install overwrites unmanaged project command conflicts", async () => {
    await withTempDir(async (projectDir) => {
      const commandsDir = join(projectDir, ".opencode", "commands");
      const configPath = join(projectDir, ".opencode", "opencode.jsonc");
      const unmanagedPath = join(commandsDir, "pk-next.md");

      await mkdir(commandsDir, { recursive: true });
      await writeFile(unmanagedPath, "custom project command\n", "utf8");

      const result = await installPhasekitOpenCode({ projectDir, overwriteUnmanaged: true });

      expect(result.scope).toBe("project");
      expect(await readConfigFile(configPath)).toEqual({
        $schema: "https://opencode.ai/config.json",
        plugin: [defaultPhasekitPluginSpec],
      });
      expect(await readFile(unmanagedPath, "utf8")).toContain("phasekit_next_action");
      expect(await readFile(unmanagedPath, "utf8")).toStartWith("<!-- phasekit:managed opencode-command v1 -->");
    });
  });

  test("removes superseded managed artifacts during install", async () => {
    await withTempDir(async (configRoot) => {
      const commandsDir = join(configRoot, "opencode", "commands");
      const legacyPath = join(commandsDir, "pk-legacy.md");

      await installOpenCodeCommandArtifacts({ configRoot });
      await writeFile(legacyPath, "<!-- phasekit:managed opencode-command v0 -->\nlegacy\n", "utf8");

      const result = await installOpenCodeCommandArtifacts({ configRoot });

      expect(result.removedPaths).toContain(legacyPath);
      await expect(readFile(legacyPath, "utf8")).rejects.toThrow();
    });
  });

  test("uninstall removes managed plugin entries and artifacts but leaves user content", async () => {
    await withTempDir(async (configRoot) => {
      const configPath = join(configRoot, "opencode", "opencode.jsonc");
      const unmanagedCommandPath = join(configRoot, "opencode", "commands", "custom.md");

      await installPhasekitOpenCode({ configRoot });
      await writeFile(
        configPath,
        `${JSON.stringify({ plugin: [defaultPhasekitPluginSpec, "example-plugin"] }, null, 2)}\n`,
        "utf8",
      );
      await writeFile(unmanagedCommandPath, "custom command\n", "utf8");

      const result = await uninstallPhasekitOpenCode({ configRoot });

      expect(result.config.removedManagedPluginSpecs).toEqual([defaultPhasekitPluginSpec]);
      expect(await readConfigFile(configPath)).toEqual({ plugin: ["example-plugin"] });
      expect(await readFile(unmanagedCommandPath, "utf8")).toBe("custom command\n");
      await expect(readFile(join(configRoot, "opencode", "commands", "pk-init.md"), "utf8")).rejects.toThrow();
      await expect(readFile(join(configRoot, "opencode", "agents", "orchestrator.md"), "utf8")).rejects.toThrow();
    });
  });

  test("generates executor instructions for one claimed task and native task transitions", async () => {
    await withTempDir(async (configRoot) => {
      const artifact = generateOpenCodeAgentArtifacts({ configRoot }).find(({ name }) => name === "executor");

      if (artifact === undefined) {
        throw new Error("Missing executor generated artifact.");
      }

      expect(artifact.path).toBe(join(configRoot, "opencode", "agents", "executor.md"));
      expect(artifact.content).toContain("exactly one claimed task");
      expect(artifact.content).toContain("phasekit_claim_task");
      expect(artifact.content).toContain("phasekit_complete_task");
      expect(artifact.content).toContain("phasekit_record_blocker");
      expect(artifact.content).toContain("required checks and changed-file evidence");
      expect(artifact.content).toContain("scope drift, ambiguity, missing evidence, failed required checks, unplanned changed files");
      expect(artifact.content).not.toContain("claimRunTask");
      expect(artifact.content).not.toContain("completeRunTask");
      expect(artifact.content).not.toContain("recordRunBlocker");
      expect(artifact.content).not.toContain("/phasekit:run-phase");
    });
  });

  test("generates scoped reviewer, verifier, and repairer instructions", async () => {
    await withTempDir(async (configRoot) => {
      const artifacts = generateOpenCodeAgentArtifacts({ configRoot });
      const reviewer = artifacts.find(({ name }) => name === "reviewer");
      const verifier = artifacts.find(({ name }) => name === "verifier");
      const repairer = artifacts.find(({ name }) => name === "repairer");

      if (reviewer === undefined || verifier === undefined || repairer === undefined) {
        throw new Error("Missing reviewer, verifier, or repairer generated artifact.");
      }

      expect(reviewer.content).toContain("assigned scope");
      expect(reviewer.content).toContain("required scoped checks");
      expect(verifier.content).toContain("phasekit_verify_scope");
      expect(verifier.content).toContain("approved for the validated scope");
      expect(verifier.content).toContain("propose it for user approval");
      expect(verifier.content).toContain("whole-project integration risks");
      expect(repairer.content).toContain("exactly one focused verifier or reviewer failure");
      expect(repairer.content).toContain("Do not create or persist repair-loop state");
      expect(repairer.content).toContain("report changed files and the scoped checks");
    });
  });

  test("generated command and agent artifacts avoid old command names and core run logic", () => {
    const artifacts = [
      ...generateOpenCodeCommandArtifacts({ configRoot: "/config" }),
      ...generateOpenCodeAgentArtifacts({ configRoot: "/config" }),
    ];

    for (const artifact of artifacts) {
      for (const supersededPrefix of supersededCommandPrefixes) {
        expect(artifact.content).not.toContain(supersededPrefix);
      }
      expect(artifact.content).not.toContain("claimRunTask");
      expect(artifact.content).not.toContain("completeRunTask");
      expect(artifact.content).not.toContain("recordRunBlocker");
      expect(artifact.content).not.toContain("readRunState");
      expect(artifact.content).not.toContain("writeRunState");
    }
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
  for (const supersededPrefix of supersededCommandPrefixes) {
    expect(content).not.toContain(supersededPrefix);
  }
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
  expect(content).not.toContain("/phasekit:run-phase");
  expect(content).not.toContain("/phasekit:verify");
}

async function withTempDir(run: (path: string) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "phasekit-install-"));

  try {
    await run(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

async function readConfigFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}
