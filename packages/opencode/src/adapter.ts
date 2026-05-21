import { tool, type Plugin, type ToolDefinition, type ToolResult } from "@opencode-ai/plugin";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  createPhaseRun,
  addPhaseFromGoal,
  advanceRunStage,
  claimRunTask,
  completeRunTask,
  describeCorePackage,
  getStatus,
  generateAgentsMdArtifact,
  ingestProjectInputs,
  initializePlanningState,
  executeVerificationScope,
  orchestrateRunPhase,
  recordRunBlocker,
  validateTaskPlan,
  writeGeneratedArtifact,
  type GetStatusOptions,
  type IngestProjectResult,
  type InitializePlanningStateOptions,
  type InitializePlanningStateResult,
  type ManagedConfigArtifactPolicy,
  type NextAction,
  type PhasekitStatus,
  type VerificationResult,
  type CreateRunResult,
  type AddPhaseFromGoalResult,
  type AgentsMdProjectContext,
  type GrillMeQuestionAnswer,
  type StackQuestionAnswer,
  type RunPhaseOrchestrationResult,
  type RunState,
  type TaskPlan,
  type WriteGeneratedArtifactResult,
} from "@depkit/phasekit-core";

export const opencodePackageName = "@depkit/phasekit-opencode" as const;
const opencodeCommandManagedMarker = "<!-- phasekit:managed opencode-command v1 -->";
const opencodeAgentManagedMarker = "<!-- phasekit:managed opencode-agent v1 -->";

export function createOpenCodeArtifactPolicy(): ManagedConfigArtifactPolicy[] {
  return [
    {
      directory: "opencode/commands",
      fileNamePattern: /^pk-[a-z0-9-]+\.md$/,
      managedMarker: opencodeCommandManagedMarker,
    },
    {
      directory: "opencode/agents",
      fileNamePattern: /^[a-z0-9-]+\.md$/,
      managedMarker: opencodeAgentManagedMarker,
    },
  ];
}

export type PhasekitToolError = {
  code: string;
  message: string;
  details?: unknown;
};

export type PhasekitToolResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: PhasekitToolError;
    };

export type PhasekitToolContext = {
  rootDir?: string;
  configRoot?: string;
};

export type InitProjectInput = PhasekitToolContext & InitializePlanningStateOptions & {
  contextPaths?: string[];
};
export type StatusInput = PhasekitToolContext & Partial<Pick<GetStatusOptions, "runId">>;
export type NextActionInput = StatusInput;
export type IngestPathsInput = PhasekitToolContext & {
  inputPaths: string[];
  questionAnswers?: readonly GrillMeQuestionAnswer[];
};
export type AddPhaseInput = PhasekitToolContext & {
  goal: string;
  questionAnswer?: GrillMeQuestionAnswer;
};
export type CreateRunInput = PhasekitToolContext & {
  phaseId: string;
};
export type RunPhaseInput = PhasekitToolContext & {
  phaseId: string;
  plan?: unknown;
  executionEvidence?: {
    task_id: string;
    evidence: unknown;
  }[];
  planValidationOptions?: unknown;
  verificationResult?: unknown;
  verificationRequestId?: string;
  changeKind?: "planning_only" | "implementation" | "mixed";
};
export type ValidatePlanInput = {
  plan: unknown;
  options: unknown;
};
export type ClaimTaskInput = PhasekitToolContext & {
  runId: string;
  plan: unknown;
  taskId: string;
  ownerAgentId?: string;
};
export type CompleteTaskInput = PhasekitToolContext & {
  runId: string;
  plan: unknown;
  taskId: string;
  evidence: unknown;
};
export type RecordBlockerInput = PhasekitToolContext & {
  runId: string;
  blocker: unknown;
};
export type AdvanceInput = PhasekitToolContext & {
  runId: string;
  targetStage: string;
};
export type VerifyScopeInput = PhasekitToolContext & {
  scope: unknown;
  approvedMissingCheckIds?: string[];
  reviewStatus?: VerificationResult["review_status"];
};
export type WriteArtifactInput = PhasekitToolContext & {
  path: string;
  content: string;
};
export type GenerateAgentsMdInput = PhasekitToolContext & {
  projectContext: AgentsMdProjectContext;
};

export type PhasekitToolHandlers = {
  phasekit_init_project(input?: InitProjectInput): Promise<PhasekitToolResult<InitializePlanningStateResult>>;
  phasekit_get_status(input?: StatusInput): Promise<PhasekitToolResult<PhasekitStatus>>;
  phasekit_next_action(input?: NextActionInput): Promise<PhasekitToolResult<NextAction>>;
  phasekit_ingest_paths(input: IngestPathsInput): Promise<PhasekitToolResult<IngestProjectResult>>;
  phasekit_add_phase(input: AddPhaseInput): Promise<PhasekitToolResult<AddPhaseFromGoalResult>>;
  phasekit_create_run(input: CreateRunInput): Promise<PhasekitToolResult<CreateRunResult>>;
  phasekit_run_phase(input: RunPhaseInput): Promise<PhasekitToolResult<RunPhaseOrchestrationResult>>;
  phasekit_validate_plan(input: ValidatePlanInput): Promise<PhasekitToolResult<TaskPlan>>;
  phasekit_claim_task(input: ClaimTaskInput): Promise<PhasekitToolResult<RunState>>;
  phasekit_complete_task(input: CompleteTaskInput): Promise<PhasekitToolResult<RunState>>;
  phasekit_record_blocker(input: RecordBlockerInput): Promise<PhasekitToolResult<RunState>>;
  phasekit_advance(input: AdvanceInput): Promise<PhasekitToolResult<RunState>>;
  phasekit_verify_scope(input: VerifyScopeInput): Promise<PhasekitToolResult<VerificationResult>>;
  phasekit_write_artifact(input: WriteArtifactInput): Promise<PhasekitToolResult<WriteGeneratedArtifactResult>>;
  phasekit_generate_agents_md(input: GenerateAgentsMdInput): Promise<PhasekitToolResult<WriteGeneratedArtifactResult>>;
};

export type PhasekitOpenCodeTools = {
  [Name in keyof PhasekitToolHandlers]: ToolDefinition;
};

export function describeOpenCodeAdapter(): {
  name: typeof opencodePackageName;
  core: ReturnType<typeof describeCorePackage>;
} {
  return {
    name: opencodePackageName,
    core: describeCorePackage(),
  };
}

export function createPhasekitToolHandlers(defaultContext: PhasekitToolContext = {}): PhasekitToolHandlers {
  return {
    phasekit_init_project: (input = {}) => runTool(async () => {
      const rootDir = resolveRootDir(input, defaultContext);
      const configRoot = resolveConfigRoot(input, defaultContext);
      const initOptions = {
        config: input.config,
        configRoot,
        contextPaths: normalizeContextPaths(input.contextPaths),
        verificationCommandAnswer: normalizeQuestionAnswerForId(input.verificationCommandAnswer, "init-verify-commands"),
        stackAnswer: normalizeQuestionAnswerForId(input.stackAnswer, "greenfield-stack"),
        confirmationAnswer: normalizeQuestionAnswerForId(input.confirmationAnswer, "init-verify-commands"),
      };
      const initResult = await initializePlanningState(rootDir, initOptions);

      await generateAgentsMdArtifact({
        rootDir,
        projectContext: await buildInitAgentsContext(rootDir, initResult),
      });

      return initResult;
    }),
    phasekit_get_status: (input = {}) => runTool(async () => {
      return getStatus({ rootDir: resolveRootDir(input, defaultContext), runId: input.runId });
    }),
    phasekit_next_action: (input = {}) => runTool(async () => {
      const status = await getStatus({ rootDir: resolveRootDir(input, defaultContext), runId: input.runId });

      return status.next_action;
    }),
    phasekit_ingest_paths: (input) => runTool(async () => {
      return ingestProjectInputs({
        rootDir: resolveRootDir(input, defaultContext),
        inputPaths: input.inputPaths,
        questionAnswers: input.questionAnswers,
      });
    }),
    phasekit_add_phase: (input) => runTool(async () => {
      return addPhaseFromGoal({
        rootDir: resolveRootDir(input, defaultContext),
        goal: input.goal,
        questionAnswer: input.questionAnswer,
      });
    }),
    phasekit_create_run: (input) => runTool(async () => {
      return createPhaseRun({ rootDir: resolveRootDir(input, defaultContext), phaseId: input.phaseId });
    }),
    phasekit_run_phase: (input) => runTool(async () => {
      return orchestrateRunPhase({
        rootDir: resolveRootDir(input, defaultContext),
        phaseId: input.phaseId,
        plan: input.plan,
        executionEvidence: input.executionEvidence,
        planValidationOptions: input.planValidationOptions,
        verificationResult: input.verificationResult,
        verificationRequestId: input.verificationRequestId,
        changeKind: input.changeKind,
      });
    }),
    phasekit_validate_plan: (input) => runTool(async () => {
      return validateTaskPlan(input.plan, input.options);
    }),
    phasekit_claim_task: (input) => runTool(async () => {
      return claimRunTask({
        rootDir: resolveRootDir(input, defaultContext),
        runId: input.runId,
        plan: input.plan,
        taskId: input.taskId,
        ownerAgentId: input.ownerAgentId,
      });
    }),
    phasekit_complete_task: (input) => runTool(async () => {
      return completeRunTask({
        rootDir: resolveRootDir(input, defaultContext),
        runId: input.runId,
        plan: input.plan,
        taskId: input.taskId,
        evidence: input.evidence,
      });
    }),
    phasekit_record_blocker: (input) => runTool(async () => {
      return recordRunBlocker({
        rootDir: resolveRootDir(input, defaultContext),
        runId: input.runId,
        blocker: input.blocker,
      });
    }),
    phasekit_advance: (input) => runTool(async () => {
      return advanceRunStage({
        rootDir: resolveRootDir(input, defaultContext),
        runId: input.runId,
        targetStage: input.targetStage,
      });
    }),
    phasekit_verify_scope: (input) => runTool(async () => {
      return executeVerificationScope({
        rootDir: resolveRootDir(input, defaultContext),
        scope: input.scope,
        approvedMissingCheckIds: input.approvedMissingCheckIds,
        reviewStatus: input.reviewStatus,
      });
    }),
    phasekit_write_artifact: (input) => runTool(async () => {
      return writeGeneratedArtifact({
        rootDir: resolveRootDir(input, defaultContext),
        configRoot: resolveConfigRoot(input, defaultContext),
        approvedConfigArtifacts: createOpenCodeArtifactPolicy(),
        path: input.path,
        content: input.content,
      });
    }),
    phasekit_generate_agents_md: (input) => runTool(async () => {
      return generateAgentsMdArtifact({
        rootDir: resolveRootDir(input, defaultContext),
        projectContext: input.projectContext,
      });
    }),
  };
}

const phasekitCommandNames = [
  "/pk-init",
  "/pk-status",
  "/pk-next",
  "/pk-config",
  "/pk-ingest",
  "/pk-add-phase",
  "/pk-run-phase",
  "/pk-verify",
] as const;

const phasekitToolNames = [
  "phasekit_init_project",
  "phasekit_get_status",
  "phasekit_next_action",
  "phasekit_ingest_paths",
  "phasekit_add_phase",
  "phasekit_create_run",
  "phasekit_run_phase",
  "phasekit_validate_plan",
  "phasekit_claim_task",
  "phasekit_complete_task",
  "phasekit_record_blocker",
  "phasekit_advance",
  "phasekit_verify_scope",
  "phasekit_write_artifact",
  "phasekit_generate_agents_md",
] as const;

async function buildInitAgentsContext(
  rootDir: string,
  initResult: InitializePlanningStateResult,
): Promise<AgentsMdProjectContext> {
  const packageMetadata = await readRootPackageMetadata(rootDir);

  return {
    projectName: packageMetadata?.name ?? basename(rootDir),
    stack: initResult.stack_decision.kind === "confirmed" ? initResult.stack_decision.stack : undefined,
    packageManager: initResult.discovery.package_manager === "unknown" ? undefined : initResult.discovery.package_manager,
    verificationCommands: [
      ...initResult.discovery.test_commands,
      ...initResult.discovery.build_commands,
    ],
    commandNames: [...phasekitCommandNames],
    toolNames: [...phasekitToolNames],
    architectureBoundaries: [
      "v1 is OpenCode-only with a harness-agnostic core.",
      "OpenCode plugin tools are the executable surface.",
      "OpenCode commands and agents are generated markdown artifacts; no runtime registration.",
      "Canonical shared state lives in committed .planning JSON files.",
    ],
  };
}

async function readRootPackageMetadata(rootDir: string): Promise<{ name?: string } | undefined> {
  try {
    return JSON.parse(await readFile(`${rootDir}/package.json`, "utf8")) as { name?: string };
  } catch {
    return undefined;
  }
}

export function createPhasekitOpenCodeTools(defaultContext: PhasekitToolContext = {}): PhasekitOpenCodeTools {
  const schema = tool.schema;

  return {
    phasekit_init_project: tool({
      description: "Initialize Phasekit canonical .planning state when missing.",
      args: {
        rootDir: schema.string().optional(),
        contextPaths: schema.array(schema.string()).optional(),
        confirmationAnswer: schema
          .object({
            question: schema.object({
              id: schema.string(),
              prompt: schema.string(),
            }),
            requirement_ids: schema.array(schema.string()),
            selected_recommended_option: schema
              .object({
                id: schema.string(),
                text: schema.string(),
              })
              .optional(),
            custom_answer_text: schema.string().optional(),
          })
          .optional(),
        verificationCommandAnswer: schema
          .object({
            question: schema.object({
              id: schema.string(),
              prompt: schema.string(),
            }),
            requirement_ids: schema.array(schema.string()),
            selected_recommended_option: schema
              .object({
                id: schema.string(),
                text: schema.string(),
              })
              .optional(),
            custom_answer_text: schema.string().optional(),
          })
          .optional(),
        stackAnswer: schema
          .object({
            question: schema.object({
              id: schema.string(),
              prompt: schema.string(),
            }),
            requirement_ids: schema.array(schema.string()),
            selected_recommended_option: schema
              .object({
                id: schema.string(),
                text: schema.string(),
              })
              .optional(),
            custom_answer_text: schema.string().optional(),
          })
          .optional(),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult(
          "Phasekit init",
          await handlers.phasekit_init_project({
            rootDir: args.rootDir,
            contextPaths: normalizeContextPaths(args.contextPaths),
            verificationCommandAnswer: normalizeQuestionAnswer(args.verificationCommandAnswer) as GrillMeQuestionAnswer | undefined,
            stackAnswer: normalizeQuestionAnswer(args.stackAnswer) as StackQuestionAnswer | undefined,
            confirmationAnswer: normalizeQuestionAnswer(args.confirmationAnswer) as GrillMeQuestionAnswer | undefined,
          }),
        );
      },
    }),
    phasekit_get_status: tool({
      description: "Return the current Phasekit status from canonical .planning JSON state.",
      args: {
        rootDir: schema.string().optional(),
        runId: schema.string().optional(),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult(
          "Phasekit status",
          await handlers.phasekit_get_status({ rootDir: args.rootDir, runId: args.runId }),
        );
      },
    }),
    phasekit_next_action: tool({
      description: "Return the next valid Phasekit action without guessing a command.",
      args: {
        rootDir: schema.string().optional(),
        runId: schema.string().optional(),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult(
          "Phasekit next action",
          await handlers.phasekit_next_action({ rootDir: args.rootDir, runId: args.runId }),
        );
      },
    }),
    phasekit_ingest_paths: tool({
      description: "Expand Phasekit ingest input paths through core ingest behavior.",
        args: {
          rootDir: schema.string().optional(),
          inputPaths: schema.array(schema.string()),
          questionAnswers: schema.array(
            schema.object({
              question: schema.object({
                id: schema.string(),
                prompt: schema.string(),
              }),
              requirement_ids: schema.array(schema.string()),
              selected_recommended_option: schema
                .object({
                  id: schema.string(),
                  text: schema.string(),
                })
                .optional(),
              custom_answer_text: schema.string().optional(),
            }),
          ).optional(),
        },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult(
          "Phasekit ingest paths",
          await handlers.phasekit_ingest_paths({
            rootDir: args.rootDir,
            inputPaths: args.inputPaths,
            questionAnswers: args.questionAnswers as GrillMeQuestionAnswer[] | undefined,
          }),
        );
      },
    }),
    phasekit_add_phase: tool({
      description: "Create exactly one Phasekit phase from a short goal.",
      args: {
        rootDir: schema.string().optional(),
        goal: schema.string(),
        questionAnswer: schema
          .object({
            question: schema.object({
              id: schema.string(),
              prompt: schema.string(),
            }),
            requirement_ids: schema.array(schema.string()),
            selected_recommended_option: schema
              .object({
                id: schema.string(),
                text: schema.string(),
              })
              .optional(),
            custom_answer_text: schema.string().optional(),
          })
          .optional(),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult(
          "Phasekit add phase",
          await handlers.phasekit_add_phase({
            rootDir: args.rootDir,
            goal: args.goal,
            questionAnswer: args.questionAnswer as GrillMeQuestionAnswer | undefined,
          }),
        );
      },
    }),
    phasekit_create_run: tool({
      description: "Create or resume a Phasekit run for one approved phase.",
      args: {
        rootDir: schema.string().optional(),
        phaseId: schema.string(),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult(
          "Phasekit create run",
          await handlers.phasekit_create_run({ rootDir: args.rootDir, phaseId: args.phaseId }),
        );
      },
    }),
    phasekit_run_phase: tool({
      description: "Run one phase through native orchestration stages with required gates.",
      args: {
        rootDir: schema.string().optional(),
        phaseId: schema.string(),
        plan: schema.unknown().optional(),
        executionEvidence: schema
          .array(
            schema.object({
              task_id: schema.string(),
              evidence: schema.unknown(),
            }),
          )
          .optional(),
        planValidationOptions: schema.unknown().optional(),
        verificationResult: schema.unknown().optional(),
        verificationRequestId: schema.string().optional(),
        changeKind: schema.enum(["planning_only", "implementation", "mixed"]).optional(),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult(
          "Phasekit run phase",
          await handlers.phasekit_run_phase({
            rootDir: args.rootDir,
            phaseId: args.phaseId,
            plan: args.plan,
            executionEvidence: args.executionEvidence,
            planValidationOptions: args.planValidationOptions,
            verificationResult: args.verificationResult,
            verificationRequestId: args.verificationRequestId,
            changeKind: args.changeKind,
          }),
        );
      },
    }),
    phasekit_validate_plan: tool({
      description: "Validate one Phasekit task plan before executor work starts.",
      args: {
        plan: schema.unknown(),
        options: schema.unknown(),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult(
          "Phasekit validate plan",
          await handlers.phasekit_validate_plan({ plan: args.plan, options: args.options }),
        );
      },
    }),
    phasekit_claim_task: tool({
      description: "Claim exactly one next Phasekit task for a sequential run.",
      args: {
        rootDir: schema.string().optional(),
        runId: schema.string(),
        plan: schema.unknown(),
        taskId: schema.string(),
        ownerAgentId: schema.string().optional(),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult(
          "Phasekit claim task",
          await handlers.phasekit_claim_task({
            rootDir: args.rootDir,
            runId: args.runId,
            plan: args.plan,
            taskId: args.taskId,
            ownerAgentId: args.ownerAgentId,
          }),
        );
      },
    }),
    phasekit_complete_task: tool({
      description: "Complete one claimed Phasekit task with required native evidence.",
      args: {
        rootDir: schema.string().optional(),
        runId: schema.string(),
        plan: schema.unknown(),
        taskId: schema.string(),
        evidence: schema.unknown(),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult(
          "Phasekit complete task",
          await handlers.phasekit_complete_task({
            rootDir: args.rootDir,
            runId: args.runId,
            plan: args.plan,
            taskId: args.taskId,
            evidence: args.evidence,
          }),
        );
      },
    }),
    phasekit_record_blocker: tool({
      description: "Record an actionable Phasekit run blocker and stop progression.",
      args: {
        rootDir: schema.string().optional(),
        runId: schema.string(),
        blocker: schema.unknown(),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult(
          "Phasekit record blocker",
          await handlers.phasekit_record_blocker({ rootDir: args.rootDir, runId: args.runId, blocker: args.blocker }),
        );
      },
    }),
    phasekit_advance: tool({
      description: "Advance a Phasekit run when the core transition API is available.",
      args: {
        rootDir: schema.string().optional(),
        runId: schema.string(),
        targetStage: schema.string(),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult("Phasekit advance", await handlers.phasekit_advance(args));
      },
    }),
    phasekit_write_artifact: tool({
      description: "Write a Phasekit artifact when the core artifact API is available.",
      args: {
        rootDir: schema.string().optional(),
        path: schema.string(),
        content: schema.string(),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult("Phasekit write artifact", await handlers.phasekit_write_artifact(args));
      },
    }),
    phasekit_generate_agents_md: tool({
      description: "Generate deterministic managed AGENTS.md from canonical rules and explicit project context.",
      args: {
        rootDir: schema.string().optional(),
        projectContext: schema.object({
          projectName: schema.string(),
          stack: schema.string().optional(),
          packageManager: schema.string().optional(),
          languages: schema.array(schema.string()).optional(),
          frameworks: schema.array(schema.string()).optional(),
          architectureBoundaries: schema.array(schema.string()).optional(),
          verificationCommands: schema.array(schema.string()).optional(),
          commandNames: schema.array(schema.string()).optional(),
          toolNames: schema.array(schema.string()).optional(),
          globalPreferences: schema.array(schema.string()).optional(),
        }),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult(
          "Phasekit generate AGENTS.md",
          await handlers.phasekit_generate_agents_md({ rootDir: args.rootDir, projectContext: args.projectContext }),
        );
      },
    }),
    phasekit_verify_scope: tool({
      description: "Execute approved scoped verification checks and persist verification evidence.",
      args: {
        rootDir: schema.string().optional(),
        scope: schema.unknown(),
        approvedMissingCheckIds: schema.array(schema.string()).optional(),
        reviewStatus: schema.enum(["passed", "failed", "skipped"]).optional(),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult("Phasekit verify scope", await handlers.phasekit_verify_scope(args));
      },
    }),
  };
}

type QuestionAnswerLike = {
  question: {
    id: string;
    prompt: string;
  };
  requirement_ids: readonly string[];
  selected_recommended_option?: {
    id: string;
    text: string;
  };
  custom_answer_text?: string;
};

function normalizeContextPaths(contextPaths: string[] | undefined): string[] | undefined {
  return contextPaths && contextPaths.length > 0 ? contextPaths : undefined;
}

function normalizeQuestionAnswer<T extends QuestionAnswerLike>(answer: T | undefined): T | undefined {
  if (answer === undefined) {
    return undefined;
  }

  const hasQuestion = answer.question.id.trim().length > 0 || answer.question.prompt.trim().length > 0;
  const hasRequirements = answer.requirement_ids.length > 0;
  const hasRecommendedOption = answer.selected_recommended_option !== undefined
    && (answer.selected_recommended_option.id.trim().length > 0 || answer.selected_recommended_option.text.trim().length > 0);
  const hasCustomAnswer = answer.custom_answer_text !== undefined && answer.custom_answer_text.trim().length > 0;

  return hasQuestion || hasRequirements || hasRecommendedOption || hasCustomAnswer ? answer : undefined;
}

function normalizeQuestionAnswerForId<T extends QuestionAnswerLike>(answer: T | undefined, expectedQuestionId: string): T | undefined {
  const normalized = normalizeQuestionAnswer(answer);

  if (normalized?.question.id !== expectedQuestionId) {
    return undefined;
  }

  return normalized;
}

export const phasekitOpenCodePlugin: Plugin = async (input) => {
  return {
    tool: createPhasekitOpenCodeTools({ rootDir: input.worktree || input.directory }),
  };
};

export default phasekitOpenCodePlugin;

function resolveRootDir(input: PhasekitToolContext, defaultContext: PhasekitToolContext): string {
  return input.rootDir ?? defaultContext.rootDir ?? process.cwd();
}

function resolveConfigRoot(input: PhasekitToolContext, defaultContext: PhasekitToolContext): string | undefined {
  return input.configRoot ?? defaultContext.configRoot;
}

function resolveToolContext(
  context: { worktree?: string; directory?: string },
  defaultContext: PhasekitToolContext,
): PhasekitToolContext {
  return {
    rootDir: defaultContext.rootDir ?? context.worktree ?? context.directory,
    configRoot: defaultContext.configRoot,
  };
}

function toOpenCodeToolResult<T>(title: string, result: PhasekitToolResult<T>): ToolResult {
  return {
    title,
    output: JSON.stringify(result, null, 2),
    metadata: result.ok
      ? { ok: true }
      : {
          ok: false,
          error_code: result.error.code,
        },
  };
}

async function runTool<T>(operation: () => Promise<T>): Promise<PhasekitToolResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return { ok: false, error: toToolError(error) };
  }
}

function toToolError(error: unknown): PhasekitToolError {
  if (error instanceof Error) {
    if (error.message.startsWith("Invalid verification-scope.json:")) {
      return {
        code: "PHASEKIT_INVALID_VERIFY_SCOPE",
        message: error.message,
      };
    }

    return {
      code: "PHASEKIT_TOOL_ERROR",
      message: error.message,
    };
  }

  return {
    code: "PHASEKIT_TOOL_ERROR",
    message: "Unknown Phasekit tool error.",
    details: error,
  };
}
