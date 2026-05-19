import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function createVerificationResult(runId: string, phaseId: string) {
  return {
    id: `verify-${runId}`,
    scope: { kind: "phase", phase_id: phaseId },
    status: "passed",
    review_status: "passed",
    verification_status: "passed",
    checked_at: "2026-05-17T00:01:00.000Z",
    command_evidence: [{ kind: "test", command: "bun test", status: "passed", output_references: [] }],
    output_references: [],
    findings: [],
    blockers: [],
    linked_requirement_ids: ["REQ-1"],
    integration_risks: [{ id: "risk-1", description: "gate", status: "covered" }],
    missing_check_proposals: [],
  };
}

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

async function writeProject(rootDir: string, project: { stack?: string }): Promise<void> {
  await writeTextFile(rootDir, ".planning/project.json", `${JSON.stringify(project, null, 2)}\n`);
}

async function writeRequirements(rootDir: string, requirements: { id: string; text: string; locator: string }[]): Promise<void> {
  await writeTextFile(
    rootDir,
    ".planning/requirements.json",
    `${JSON.stringify(
      {
        requirements: requirements.map((requirement) => ({
          id: requirement.id,
          text: requirement.text,
          sources: [{ path: "docs/prd.md", locator: requirement.locator }],
        })),
      },
      null,
      2,
    )}\n`,
  );
}

async function writeRules(rootDir: string, rules: { id: string; category: string; text: string }[]): Promise<void> {
  await writeTextFile(rootDir, ".planning/rules.json", `${JSON.stringify({ rules }, null, 2)}\n`);
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
      expect(result.data.verification_commands.stored_in_project_config).toBe(false);
    });
  });

  test("accepts explicit init command approval payload for discovered verification commands", async () => {
    await withTempDir(async (rootDir) => {
      await writeTextFile(
        rootDir,
        "package.json",
        `${JSON.stringify({ packageManager: "bun@1.1.0", scripts: { test: "bun test" } }, null, 2)}\n`,
      );

      const tools = createPhasekitToolHandlers({ rootDir });
      await tools.phasekit_init_project();
      const approved = await tools.phasekit_init_project({
        confirmationAnswer: {
          question: {
            id: "init-verify-commands",
            prompt: "Do you approve persisting discovered verification commands into .planning/config.json?",
          },
          requirement_ids: ["verification-test"],
          selected_recommended_option: {
            id: "approve-discovered-commands",
            text: "Approve and persist discovered verification commands",
          },
        },
      });

      expect(approved).toMatchObject({
        ok: true,
        data: {
          verification_commands: {
            stored_in_project_config: true,
          },
        },
      });
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

  test("ingests multiple paths through core ingest behavior and writes planning state", async () => {
    await withTempDir(async (rootDir) => {
      await writeProject(rootDir, { stack: "Bun + TypeScript" });
      await writeRequirements(rootDir, []);
      await writePhases(rootDir, []);
      await writeTextFile(rootDir, "docs/zeta.md", "Zeta\n");
      await writeTextFile(rootDir, "docs/alpha.txt", "Alpha\n");
      await writeTextFile(
        rootDir,
        "README.md",
        [
          "# Product",
          "",
          "**Success Criteria:**",
          "- Read me.",
          "",
          "**Story 1: Inputs**",
          "Acceptance criteria:",
          "- Alpha.",
          "- Zeta.",
          "",
        ].join("\n"),
      );

      const tools = createPhasekitToolHandlers({ rootDir });
      const result = await tools.phasekit_ingest_paths({ inputPaths: ["docs/zeta.md", "README.md", "docs"] });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.data.inputs.map((input) => input.relativePath)).toEqual(["README.md", "docs/alpha.txt", "docs/zeta.md"]);
      expect(result.data.requirements.requirements.map((requirement) => requirement.text)).toEqual([
        "Success Criteria: Read me.",
        "Inputs: Alpha.",
        "Inputs: Zeta.",
        "Ingested Requirements: Alpha",
        "Ingested Requirements: Zeta",
      ]);
      expect(result.data.phases.phases.map((phase) => phase.id)).toEqual([
        "INGEST-success-criteria",
        "INGEST-inputs",
        "INGEST-ingested-requirements-docs-alpha",
        "INGEST-ingested-requirements-docs-zeta",
      ]);
    });
  });

  test("adds one phase from a short goal through a core-backed tool", async () => {
    await withTempDir(async (rootDir) => {
      const tools = createPhasekitToolHandlers({ rootDir });
      await tools.phasekit_init_project();

      const result = await tools.phasekit_add_phase({ goal: "Add a command wrapper for pk-add-phase." });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.data.kind).toBe("phase_created");
      if (result.data.kind !== "phase_created") {
        throw new Error("Expected add-phase creation result.");
      }

      expect(result.data.phase.id.startsWith("INGEST-short-goal")).toBe(true);
      expect(result.data.phase.source_requirement_ids).toEqual(["REQ-1"]);
      expect(result.data.phases.phases).toHaveLength(1);
      expect(result.data.requirements.requirements[0]?.text).toBe("Short Goal: Add a command wrapper for pk-add-phase.");
    });
  });

  test("returns question then creates phase for ambiguous add-phase goal", async () => {
    await withTempDir(async (rootDir) => {
      const tools = createPhasekitToolHandlers({ rootDir });
      await tools.phasekit_init_project();

      const questioned = await tools.phasekit_add_phase({ goal: "fix stuff" });
      expect(questioned.ok).toBe(true);
      if (!questioned.ok) {
        throw new Error(questioned.error.message);
      }
      expect(questioned.data).toMatchObject({ kind: "question", question: { id: "add-phase-goal-clarification" } });

      const created = await tools.phasekit_add_phase({
        goal: "fix stuff",
        questionAnswer: {
          question: { id: "add-phase-goal-clarification", prompt: "Clarify" },
          requirement_ids: ["short-goal"],
          custom_answer_text: "Add focused add-phase ambiguity tests and blocking behavior.",
        },
      });

      expect(created.ok).toBe(true);
      if (!created.ok) {
        throw new Error(created.error.message);
      }
      expect(created.data.kind).toBe("phase_created");
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
    await withTempDir(async (rootDir) => {
      const tools = createPhasekitToolHandlers({ rootDir });
      await tools.phasekit_init_project();
      await writePhases(rootDir, [{ id: "P7", status: "pending" }, { id: "P8", status: "pending" }]);
      await writeRequirements(rootDir, [{ id: "REQ-1", text: "Scope", locator: "1" }]);
      await writeTextFile(rootDir, "package.json", JSON.stringify({ scripts: { test: "bun test" } }, null, 2));

      await expect(tools.phasekit_verify_scope({ scope: { kind: "task", phase_id: "P7", plan_id: "plan-1", task_id: "task-1" } })).resolves.toMatchObject({
        ok: true,
        data: {
          scope: { kind: "task", phase_id: "P7", plan_id: "plan-1", task_id: "task-1" },
          id: "verify-task-P7-plan-1-task-1",
        },
      });
      await expect(tools.phasekit_verify_scope({ scope: { kind: "phase", phase_id: "P7" } })).resolves.toMatchObject({
        ok: true,
        data: { scope: { kind: "phase", phase_id: "P7" }, id: "verify-phase-P7" },
      });
      await expect(tools.phasekit_verify_scope({ scope: { kind: "group", group_id: "release-1", phase_ids: ["P7", "P8"] } })).resolves.toMatchObject({
        ok: true,
        data: { scope: { kind: "group", group_id: "release-1", phase_ids: ["P7", "P8"] }, id: "verify-group-release-1" },
      });
      await expect(tools.phasekit_verify_scope({ scope: { kind: "all" } })).resolves.toMatchObject({
        ok: true,
        data: { scope: { kind: "all" }, id: "verify-all" },
      });
    });
  });

  test("requires and accepts missing-check approvals through verify tool input", async () => {
    await withTempDir(async (rootDir) => {
      const tools = createPhasekitToolHandlers({ rootDir });
      await tools.phasekit_init_project();
      await writePhases(rootDir, [{ id: "P7", status: "pending" }]);
      await writeRequirements(rootDir, [{ id: "REQ-1", text: "Scope", locator: "1" }]);
      await writeTextFile(rootDir, "package.json", JSON.stringify({ scripts: { "test:unit": "bun test" } }, null, 2));

      const blocked = await tools.phasekit_verify_scope({ scope: { kind: "phase", phase_id: "P7" } });
      expect(blocked.ok).toBe(true);
      if (!blocked.ok) {
        throw new Error(blocked.error.message);
      }
      expect(blocked.data.status).toBe("blocked");
      expect(blocked.data.missing_check_proposals.length).toBeGreaterThan(0);

      const approved = await tools.phasekit_verify_scope({
        scope: { kind: "phase", phase_id: "P7" },
        approvedMissingCheckIds: blocked.data.missing_check_proposals.map((proposal) => proposal.id),
        reviewStatus: "passed",
      });
      expect(approved.ok).toBe(true);
      if (!approved.ok) {
        throw new Error(approved.error.message);
      }
      expect(approved.data.status).toBe("failed");
      expect(approved.data.missing_check_proposals).toEqual([]);
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

  test("advances runs and writes approved artifacts through core-backed tools", async () => {
    await withTempDir(async (rootDir) => {
      await withTempDir(async (configRoot) => {
        const tools = createPhasekitToolHandlers({ rootDir, configRoot });
        await tools.phasekit_init_project();
        await writeRun(rootDir);

        const advanced = await tools.phasekit_advance({ runId: "phase-P6-T4", targetStage: "review" });
        const written = await tools.phasekit_write_artifact({
          path: "opencode/commands/pk-status.md",
          content: "<!-- phasekit:managed opencode-command v1 -->\nmanaged\n",
        });

        expect(advanced).toMatchObject({
          ok: true,
          data: {
            current_stage: "review",
            last_successful_stage_transition: {
              from: "execution",
              to: "review",
            },
          },
        });
        expect(written).toEqual({ ok: true, data: { path: "opencode/commands/pk-status.md" } });
        expect(await readFile(join(configRoot, "opencode", "commands", "pk-status.md"), "utf8")).toBe(
          "<!-- phasekit:managed opencode-command v1 -->\nmanaged\n",
        );
      });
    });
  });

  test("generates AGENTS.md through core using canonical rules and managed overwrite policy", async () => {
    await withTempDir(async (rootDir) => {
      const tools = createPhasekitToolHandlers({ rootDir });
      await tools.phasekit_init_project();
      await writeRules(rootDir, [{ id: "rule-1", category: "workflow", text: "Keep scope narrow." }]);

      const input = {
        projectContext: {
          projectName: "Phasekit",
          stack: "TypeScript + Bun",
          packageManager: "bun",
          commandNames: ["/pk-status"],
          toolNames: ["phasekit_generate_agents_md"],
        },
      };

      const first = await tools.phasekit_generate_agents_md(input);
      const firstContent = await readFile(join(rootDir, "AGENTS.md"), "utf8");
      const second = await tools.phasekit_generate_agents_md(input);
      const secondContent = await readFile(join(rootDir, "AGENTS.md"), "utf8");

      expect(first).toEqual({ ok: true, data: { path: "AGENTS.md" } });
      expect(second).toEqual({ ok: true, data: { path: "AGENTS.md" } });
      expect(firstContent).toBe(secondContent);
      expect(firstContent).toContain("<!-- phasekit:managed agents-md v1 -->");
      expect(firstContent).toContain("### workflow");
      expect(firstContent).toContain("`rule-1`: Keep scope narrow.");

      await writeFile(join(rootDir, "AGENTS.md"), "# unmanaged\n", "utf8");
      await expect(tools.phasekit_generate_agents_md(input)).resolves.toEqual({
        ok: false,
        error: {
          code: "PHASEKIT_TOOL_ERROR",
          message: "Refusing to overwrite unmanaged AGENTS.md content.",
        },
      });
    });
  });

  test("returns structured actionable errors for invalid advancement and artifact writes", async () => {
    await withTempDir(async (rootDir) => {
      const tools = createPhasekitToolHandlers({ rootDir });
      await tools.phasekit_init_project();
      await writeRun(rootDir);

      const skipped = await tools.phasekit_advance({ runId: "phase-P6-T4", targetStage: "verification" });
      const unapprovedPath = await tools.phasekit_write_artifact({ path: "docs/guide.md", content: "# no" });

      expect(skipped).toEqual({
        ok: false,
        error: {
          code: "PHASEKIT_TOOL_ERROR",
          message: 'Invalid run stage transition from "execution" to "verification": expected next stage: review.',
        },
      });
      expect(unapprovedPath).toEqual({
        ok: false,
        error: {
          code: "PHASEKIT_TOOL_ERROR",
          message: 'Refusing to write artifact "docs/guide.md": path is not an approved generated artifact location.',
        },
      });
    });
  });

  test("does not expose runtime slash command or agent registration", () => {
    expect(Object.keys(createPhasekitToolHandlers()).sort()).toEqual([
      "phasekit_add_phase",
      "phasekit_advance",
      "phasekit_claim_task",
      "phasekit_complete_task",
      "phasekit_create_run",
      "phasekit_generate_agents_md",
      "phasekit_get_status",
      "phasekit_ingest_paths",
      "phasekit_init_project",
      "phasekit_next_action",
      "phasekit_record_blocker",
      "phasekit_run_phase",
      "phasekit_validate_plan",
      "phasekit_verify_scope",
      "phasekit_write_artifact",
    ]);
  });

  test("exports native OpenCode tool definitions for the tool surface", () => {
    const tools = createPhasekitOpenCodeTools();

    expect(Object.keys(tools).sort()).toEqual([
      "phasekit_add_phase",
      "phasekit_advance",
      "phasekit_claim_task",
      "phasekit_complete_task",
      "phasekit_create_run",
      "phasekit_generate_agents_md",
      "phasekit_get_status",
      "phasekit_ingest_paths",
      "phasekit_init_project",
      "phasekit_next_action",
      "phasekit_record_blocker",
      "phasekit_run_phase",
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
      const ingest = await tools.phasekit_ingest_paths.execute({ inputPaths: ["docs/prd.md"] }, context);
      const ingestResult = parseToolOutput(ingest) as {
        ok: boolean;
        data?: {
          phases: {
            phases: { id: string }[];
          };
        };
      };

      if (!ingestResult.ok || ingestResult.data === undefined) {
        throw new Error("Expected ingest tool to produce phase state.");
      }

      const run = await tools.phasekit_run_phase.execute({ phaseId: ingestResult.data.phases.phases[0]?.id ?? "missing" }, context);
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
        data: {
          inputs: [{ relativePath: "docs/prd.md", text: "Requirement\n" }],
        },
      });
      expect(parseToolOutput(run)).toMatchObject({
        ok: true,
        data: { phase: { id: "INGEST-ingested-requirements" } },
      });
      expect(parseToolOutput(verify)).toMatchObject({
        ok: true,
        data: {
          scope: { kind: "all" },
          id: "verify-all",
          status: "blocked",
          review_status: "skipped",
          verification_status: "passed",
        },
      });
    });
  });

  test("phasekit_run_phase tool requires a second request-bound verification call", async () => {
    await withTempDir(async (rootDir) => {
      const context = createToolContext(rootDir);
      const tools = createPhasekitOpenCodeTools();

      await tools.phasekit_init_project.execute({}, context);
      await writeRequirements(rootDir, [{ id: "REQ-1", text: "Run the phase end to end.", locator: "Story 4" }]);
      await writePhases(rootDir, [{ id: "P6-T4", status: "pending" }]);

      const initial = parseToolOutput(await tools.phasekit_run_phase.execute({ phaseId: "P6-T4", plan: taskPlan }, context)) as {
        ok: boolean;
        data?: { stage: string };
      };
      expect(initial).toMatchObject({ ok: true, data: { stage: "execution" } });

      const review = parseToolOutput(
        await tools.phasekit_run_phase.execute(
          {
            phaseId: "P6-T4",
            plan: taskPlan,
            executionEvidence: [
              {
                task_id: "task-1",
                evidence: {
                  check_results: [{ command: "bun test packages/install/tests/index.test.ts", status: "passed" }],
                  changed_files: ["packages/install/src/index.ts"],
                },
              },
            ],
            verificationRequestId: "ignored-same-call-request",
            verificationResult: createVerificationResult("phase-P6-T4", "P6-T4"),
          },
          context,
        ),
      ) as {
        ok: boolean;
        data?: {
          stage: string;
          next_required?: { kind: string; request_id: string };
        };
      };

      expect(review).toMatchObject({ ok: true, data: { stage: "review" } });
      expect(review.data?.next_required?.kind).toBe("review_verification_request");

      const reviewRequestId = review.data?.next_required?.request_id;
      if (!reviewRequestId) {
        throw new Error("Expected issued review request id.");
      }

      const verification = parseToolOutput(
        await tools.phasekit_run_phase.execute(
          {
            phaseId: "P6-T4",
            plan: taskPlan,
            verificationRequestId: reviewRequestId,
            verificationResult: createVerificationResult("phase-P6-T4", "P6-T4"),
          },
          context,
        ),
      ) as {
        ok: boolean;
        data?: {
          stage: string;
          next_required?: { kind: string; request_id: string };
        };
      };

      expect(verification).toMatchObject({ ok: true, data: { stage: "verification" } });
      expect(verification.data?.next_required?.kind).toBe("review_verification_request");

      const verificationRequestId = verification.data?.next_required?.request_id;
      if (!verificationRequestId) {
        throw new Error("Expected issued verification request id.");
      }

      const complete = parseToolOutput(
        await tools.phasekit_run_phase.execute(
          {
            phaseId: "P6-T4",
            plan: taskPlan,
            verificationRequestId,
            verificationResult: createVerificationResult("phase-P6-T4", "P6-T4"),
          },
          context,
        ),
      ) as {
        ok: boolean;
        data?: { stage: string };
      };

      expect(complete).toMatchObject({ ok: true, data: { stage: "verification" } });
    });
  });

  test("ingests the Phasekit PRD through the OpenCode tool path deterministically", async () => {
    await withTempDir(async (rootDir) => {
      const prdText = await Bun.file(join(process.cwd(), ".planning", "PHASEKIT-PRD.md")).text();
      const tools = createPhasekitToolHandlers({ rootDir });

      await tools.phasekit_init_project();
      await writeTextFile(rootDir, ".planning/PHASEKIT-PRD.md", prdText);

      const first = await tools.phasekit_ingest_paths({ inputPaths: [".planning/PHASEKIT-PRD.md"] });
      const second = await tools.phasekit_ingest_paths({ inputPaths: [".planning/PHASEKIT-PRD.md"] });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) {
        throw new Error("Expected PRD ingest to succeed through the OpenCode tool path.");
      }

      expect(second.data).toEqual(first.data);
      expect(first.data.phases.phases.map((phase) => phase.id)).toEqual([
        "INGEST-success-criteria",
        "INGEST-initialize-phasekit",
        "INGEST-ingest-product-intent",
        "INGEST-add-one-phase",
        "INGEST-run-a-phase",
        "INGEST-resume-interrupted-work",
        "INGEST-verify-whole-project-fit",
        "INGEST-generate-project-docs",
      ]);
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
        "phasekit_add_phase",
        "phasekit_advance",
        "phasekit_claim_task",
        "phasekit_complete_task",
        "phasekit_create_run",
        "phasekit_generate_agents_md",
        "phasekit_get_status",
        "phasekit_ingest_paths",
        "phasekit_init_project",
        "phasekit_next_action",
        "phasekit_record_blocker",
        "phasekit_run_phase",
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
