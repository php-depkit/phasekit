import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import { corePackageName } from "@phasekit/core";
import {
  createPhasekitOpenCodeTools,
  createPhasekitToolHandlers,
  describeOpenCodeAdapter,
  opencodePackageName,
  phasekitOpenCodePlugin,
} from "../src/adapter";

async function withTempDir<T>(run: (rootDir: string) => Promise<T>): Promise<T> {
  const rootDir = await mkdtemp(join(tmpdir(), "phasekit-opencode-"));

  try {
    return await run(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

function createToolContext(rootDir: string) {
  return {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "tester",
    directory: rootDir,
    worktree: rootDir,
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: (() => undefined) as never,
  };
}

function parseToolOutput(result: string | { output: string }): unknown {
  return JSON.parse(typeof result === "string" ? result : result.output);
}

describe("@phasekit/opencode", () => {
  test("imports @phasekit/core", () => {
    expect(corePackageName).toBe("@phasekit/core");
    expect(describeOpenCodeAdapter()).toEqual({
      name: opencodePackageName,
      core: { name: "@phasekit/core" },
    });
  });

  test("initializes planning state through a core-backed tool", async () => {
    await withTempDir(async (rootDir) => {
      const tools = createPhasekitToolHandlers({ rootDir });
      const result = await tools.phasekit_init_project();

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.data.createdPaths).toContain(".planning/project.json");
      expect(result.data.createdPaths).toContain(".planning/config.json");
    });
  });

  test("returns status and next action through core-backed tools", async () => {
    await withTempDir(async (rootDir) => {
      const tools = createPhasekitToolHandlers({ rootDir });

      await tools.phasekit_init_project();

      const status = await tools.phasekit_get_status();
      const next = await tools.phasekit_next_action();

      expect(status.ok).toBe(true);
      expect(next.ok).toBe(true);
      if (!status.ok || !next.ok) {
        throw new Error("Expected status and next action tools to succeed.");
      }

      expect(status.data.project.initialized).toBe(true);
      expect(status.data.next_action.kind).toBe("ingest_project");
      expect(next.data.kind).toBe("ingest_project");
    });
  });

  test("converts core failures into structured actionable errors", async () => {
    await withTempDir(async (rootDir) => {
      const tools = createPhasekitToolHandlers({ rootDir });
      await tools.phasekit_init_project();

      const result = await tools.phasekit_get_status({ runId: "missing-run" });

      expect(result).toEqual({
        ok: false,
        error: {
          code: "PHASEKIT_TOOL_ERROR",
          message: "Run state not found: missing-run",
        },
      });
    });
  });

  test("keeps future tools structured without duplicating unavailable core behavior", async () => {
    const tools = createPhasekitToolHandlers();

    await expect(tools.phasekit_advance({ runId: "run-1", targetStage: "review" })).resolves.toEqual({
      ok: false,
      error: {
        code: "PHASEKIT_TOOL_NOT_IMPLEMENTED",
        message: "phasekit_advance: Run advancement is implemented in a later Phasekit phase.",
      },
    });
    await expect(tools.phasekit_write_artifact({ path: "PROJECT.md", content: "# Project" })).resolves.toEqual({
      ok: false,
      error: {
        code: "PHASEKIT_TOOL_NOT_IMPLEMENTED",
        message: "phasekit_write_artifact: Artifact writing is implemented in a later Phasekit phase.",
      },
    });
  });

  test("does not expose runtime slash command or agent registration", () => {
    expect(Object.keys(createPhasekitToolHandlers()).sort()).toEqual([
      "phasekit_advance",
      "phasekit_get_status",
      "phasekit_init_project",
      "phasekit_next_action",
      "phasekit_write_artifact",
    ]);
  });

  test("exports native OpenCode tool definitions for the tool surface", () => {
    const tools = createPhasekitOpenCodeTools();

    expect(Object.keys(tools).sort()).toEqual([
      "phasekit_advance",
      "phasekit_get_status",
      "phasekit_init_project",
      "phasekit_next_action",
      "phasekit_write_artifact",
    ]);
    expect(tools.phasekit_get_status.description).toContain("Phasekit status");
    expect(typeof tools.phasekit_get_status.execute).toBe("function");
    expect("command" in tools).toBe(false);
    expect("agent" in tools).toBe(false);
  });

  test("native OpenCode tools execute through the core-backed handlers", async () => {
    await withTempDir(async (rootDir) => {
      const context = createToolContext(rootDir);
      const tools = createPhasekitOpenCodeTools();

      const init = await tools.phasekit_init_project.execute({}, context);
      const status = await tools.phasekit_get_status.execute({}, context);

      expect(parseToolOutput(init)).toMatchObject({ ok: true });
      expect(parseToolOutput(status)).toMatchObject({
        ok: true,
        data: {
          project: { initialized: true },
          next_action: { kind: "ingest_project" },
        },
      });
    });
  });

  test("native OpenCode plugin registers tools only", async () => {
    await withTempDir(async (rootDir) => {
      const hooks = await phasekitOpenCodePlugin({
        directory: rootDir,
        worktree: rootDir,
      } as Parameters<typeof phasekitOpenCodePlugin>[0]);

      expect(Object.keys(hooks).sort()).toEqual(["tool"]);
      expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([
        "phasekit_advance",
        "phasekit_get_status",
        "phasekit_init_project",
        "phasekit_next_action",
        "phasekit_write_artifact",
      ]);
    });
  });

  test("does not rely on markdown files as runtime tool behavior", async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(join(rootDir, "PHASES.md"), "# Not state\n");

      const tools = createPhasekitToolHandlers({ rootDir });
      const status = await tools.phasekit_get_status();

      expect(status.ok).toBe(true);
      if (!status.ok) {
        throw new Error(status.error.message);
      }

      expect(status.data.state).toBe("clean");
      expect(status.data.next_action.kind).toBe("initialize_project");
    });
  });
});
