import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

const taskPlan = {
  id: "plan-1",
  phase_id: "P6-T4",
  tasks: [
    {
      id: "task-1",
      title: "Wire run-phase artifact",
      source_requirement_ids: ["REQ-1"],
      scope: "Wire the run phase artifact to native tools with focused coverage.",
      files: ["packages/install/src/index.ts"],
      checks: [{ command: "bun test packages/install/tests/index.test.ts" }],
      adds_behavior: true,
    },
  ],
};

const validatorOptions = {
  source_requirement_ids: ["REQ-1"],
  max_tasks: 3,
  max_scope_characters: 180,
  max_files_per_task: 3,
  max_checks_per_task: 2,
  max_dependencies_per_task: 1,
  min_scope_words: 8,
};

async function withTempDir<T>(run: (rootDir: string) => Promise<T>): Promise<T> {
  const rootDir = await mkdtemp(join(tmpdir(), "phasekit-opencode-"));

  try {
    return await run(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function writeTextFile(rootDir: string, relativePath: string, text: string): Promise<void> {
  const filePath = join(rootDir, ...relativePath.split("/"));
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, text, "utf8");
}

async function writePhases(
  rootDir: string,
  phases: { id: string; status: "pending" | "in_progress" | "blocked" | "complete" }[],
): Promise<void> {
  await writeTextFile(
    rootDir,
    ".planning/phases.json",
    `${JSON.stringify(
      {
        phases: phases.map((phase) => ({
          id: phase.id,
          source_requirement_ids: ["REQ-1"],
          expected_behavior: "Run-phase artifacts can create or resume a phase run.",
          relevant_context: ["packages/install/src/index.ts"],
          likely_change_areas: ["packages/install/src/index.ts"],
          test_strategy: ["Run OpenCode adapter tests."],
          integration_risks: [],
          done_criteria: ["The native run creation tool succeeds."],
          status: phase.status,
        })),
      },
      null,
      2,
    )}\n`,
  );
}

async function writeRun(rootDir: string): Promise<void> {
  await writeTextFile(
    rootDir,
    ".planning/runs/phase-P6-T4.json",
    `${JSON.stringify(
      {
        id: "phase-P6-T4",
        current_phase: "P6-T4",
        current_plan: "plan-1",
        current_stage: "execution",
        started_at: "2026-05-16T00:00:00.000Z",
        claimed_tasks: [],
        completed_checks: [],
        changed_files: [],
        commit_ids: [],
        blockers: [],
      },
      null,
      2,
    )}\n`,
  );
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

  test("ingests multiple paths through core ingest behavior", async () => {
    await withTempDir(async (rootDir) => {
      await writeTextFile(rootDir, "docs/zeta.md", "Zeta\n");
      await writeTextFile(rootDir, "docs/alpha.txt", "Alpha\n");
      await writeTextFile(rootDir, "README.md", "Read me\n");

      const tools = createPhasekitToolHandlers({ rootDir });
      const result = await tools.phasekit_ingest_paths({ inputPaths: ["docs/zeta.md", "README.md", "docs"] });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.data.map((input) => input.relativePath)).toEqual(["README.md", "docs/alpha.txt", "docs/zeta.md"]);
      expect(result.data.map((input) => input.text)).toEqual(["Read me\n", "Alpha\n", "Zeta\n"]);
    });
  });

  test("creates or resumes a run through a core-backed tool", async () => {
    await withTempDir(async (rootDir) => {
      const tools = createPhasekitToolHandlers({ rootDir });

      await tools.phasekit_init_project();
      await writePhases(rootDir, [{ id: "P6-T4", status: "pending" }]);

      const created = await tools.phasekit_create_run({ phaseId: "P6-T4" });
      const resumed = await tools.phasekit_create_run({ phaseId: "P6-T4" });

      expect(created.ok).toBe(true);
      expect(resumed.ok).toBe(true);
      if (!created.ok || !resumed.ok) {
        throw new Error("Expected run creation tools to succeed.");
      }

      expect(created.data.resumed).toBe(false);
      expect(created.data.run).toMatchObject({ id: "phase-P6-T4", current_phase: "P6-T4" });
      expect(resumed.data.resumed).toBe(true);
      expect(resumed.data.run).toEqual(created.data.run);
    });
  });

  test("validates, claims, completes, and blocks tasks through core-backed tools", async () => {
    await withTempDir(async (rootDir) => {
      const tools = createPhasekitToolHandlers({ rootDir });

      await tools.phasekit_init_project();
      await writeRun(rootDir);

      const validated = await tools.phasekit_validate_plan({ plan: taskPlan, options: validatorOptions });
      const claimed = await tools.phasekit_claim_task({ runId: "phase-P6-T4", plan: taskPlan, taskId: "task-1" });
      const completed = await tools.phasekit_complete_task({
        runId: "phase-P6-T4",
        plan: taskPlan,
        taskId: "task-1",
        evidence: {
          check_results: [{ command: "bun test packages/install/tests/index.test.ts", status: "passed" }],
          changed_files: ["packages/install/src/index.ts"],
        },
      });
      const blocked = await tools.phasekit_record_blocker({
        runId: "phase-P6-T4",
        blocker: { reason: "Need user decision.", next_step: "Ask the user for the missing decision." },
      });

      expect(validated).toMatchObject({ ok: true, data: { id: "plan-1" } });
      expect(claimed).toMatchObject({ ok: true, data: { claimed_tasks: [{ id: "task-1" }] } });
      expect(completed).toMatchObject({
        ok: true,
        data: { claimed_tasks: [{ id: "task-1", changed_files: ["packages/install/src/index.ts"] }] },
      });
      expect(blocked).toMatchObject({ ok: true, data: { blockers: [{ reason: "Need user decision." }] } });
    });
  });

  test("converts ingest failures into structured actionable errors", async () => {
    await withTempDir(async (rootDir) => {
      await writeTextFile(rootDir, "docs/page.html", "<h1>Unsupported</h1>\n");

      const tools = createPhasekitToolHandlers({ rootDir });
      const result = await tools.phasekit_ingest_paths({ inputPaths: ["docs/page.html"] });

      expect(result).toEqual({
        ok: false,
        error: {
          code: "PHASEKIT_TOOL_ERROR",
          message: "Unsupported ingest input docs/page.html: only .md, .markdown, and .txt files are supported in this phase.",
        },
      });
    });
  });

  test("prepares verification scopes through core-backed schema validation", async () => {
    const tools = createPhasekitToolHandlers();

    await expect(tools.phasekit_verify_scope({ scope: { kind: "task", phase_id: "P7", plan_id: "plan-1", task_id: "task-1" } })).resolves.toMatchObject({
      ok: true,
      data: {
        scope: { kind: "task", phase_id: "P7", plan_id: "plan-1", task_id: "task-1" },
        scope_id: "task-P7-plan-1-task-1",
        approved_check_policy: {
          command_execution: "not_started",
          run_approved_checks_only: true,
          missing_checks_require_approval: true,
        },
        repair_policy: {
          focused_repair_only: true,
          repair_persistence: "not_implemented",
        },
      },
    });
    await expect(tools.phasekit_verify_scope({ scope: { kind: "phase", phase_id: "P7" } })).resolves.toMatchObject({
      ok: true,
      data: { scope: { kind: "phase", phase_id: "P7" }, scope_id: "phase-P7" },
    });
    await expect(tools.phasekit_verify_scope({ scope: { kind: "group", group_id: "release-1", phase_ids: ["P7", "P8"] } })).resolves.toMatchObject({
      ok: true,
      data: { scope: { kind: "group", group_id: "release-1", phase_ids: ["P7", "P8"] }, scope_id: "group-release-1" },
    });
    await expect(tools.phasekit_verify_scope({ scope: { kind: "all" } })).resolves.toMatchObject({
      ok: true,
      data: { scope: { kind: "all" }, scope_id: "all" },
    });
  });

  test("converts invalid verification scopes into structured actionable errors", async () => {
    const tools = createPhasekitToolHandlers();

    await expect(tools.phasekit_verify_scope({ scope: { kind: "group", phase_ids: [] } })).resolves.toEqual({
      ok: false,
      error: {
        code: "PHASEKIT_INVALID_VERIFY_SCOPE",
        message: "Invalid verification-scope.json: phase_ids: Array must contain at least 1 element(s)",
      },
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
      "phasekit_claim_task",
      "phasekit_complete_task",
      "phasekit_create_run",
      "phasekit_get_status",
      "phasekit_ingest_paths",
      "phasekit_init_project",
      "phasekit_next_action",
      "phasekit_record_blocker",
      "phasekit_validate_plan",
      "phasekit_verify_scope",
      "phasekit_write_artifact",
    ]);
  });

  test("exports native OpenCode tool definitions for the tool surface", () => {
    const tools = createPhasekitOpenCodeTools();

    expect(Object.keys(tools).sort()).toEqual([
      "phasekit_advance",
      "phasekit_claim_task",
      "phasekit_complete_task",
      "phasekit_create_run",
      "phasekit_get_status",
      "phasekit_ingest_paths",
      "phasekit_init_project",
      "phasekit_next_action",
      "phasekit_record_blocker",
      "phasekit_validate_plan",
      "phasekit_verify_scope",
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
      await writeTextFile(rootDir, "docs/prd.md", "Requirement\n");
      await writePhases(rootDir, [{ id: "P6-T4", status: "pending" }]);
      const ingest = await tools.phasekit_ingest_paths.execute({ inputPaths: ["docs/prd.md"] }, context);
      const run = await tools.phasekit_create_run.execute({ phaseId: "P6-T4" }, context);
      const verify = await tools.phasekit_verify_scope.execute({ scope: { kind: "all" } }, context);

      expect(parseToolOutput(init)).toMatchObject({ ok: true });
      expect(parseToolOutput(status)).toMatchObject({
        ok: true,
        data: {
          project: { initialized: true },
          next_action: { kind: "ingest_project" },
        },
      });
      expect(parseToolOutput(ingest)).toMatchObject({
        ok: true,
        data: [{ relativePath: "docs/prd.md", text: "Requirement\n" }],
      });
      expect(parseToolOutput(run)).toMatchObject({
        ok: true,
        data: { resumed: false, run: { id: "phase-P6-T4", current_phase: "P6-T4" } },
      });
      expect(parseToolOutput(verify)).toMatchObject({
        ok: true,
        data: { scope: { kind: "all" }, scope_id: "all" },
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
        "phasekit_claim_task",
        "phasekit_complete_task",
        "phasekit_create_run",
        "phasekit_get_status",
        "phasekit_ingest_paths",
        "phasekit_init_project",
        "phasekit_next_action",
        "phasekit_record_blocker",
        "phasekit_validate_plan",
        "phasekit_verify_scope",
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
