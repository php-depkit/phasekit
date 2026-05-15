import { tool, type Plugin, type ToolDefinition, type ToolResult } from "@opencode-ai/plugin";
import {
  describeCorePackage,
  expandIngestPaths,
  getStatus,
  initializePlanningState,
  type ExpandIngestPathsOptions,
  type GetStatusOptions,
  type InitializePlanningStateOptions,
  type InitializePlanningStateResult,
  type IngestTextInput,
  type NextAction,
  type PhasekitStatus,
} from "@phasekit/core";

export const opencodePackageName = "@phasekit/opencode" as const;

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
};

export type InitProjectInput = PhasekitToolContext & InitializePlanningStateOptions;
export type StatusInput = PhasekitToolContext & Pick<GetStatusOptions, "runId">;
export type NextActionInput = StatusInput;
export type IngestPathsInput = PhasekitToolContext & Pick<ExpandIngestPathsOptions, "inputPaths">;
export type AdvanceInput = PhasekitToolContext & {
  runId: string;
  targetStage: string;
};
export type WriteArtifactInput = PhasekitToolContext & {
  path: string;
  content: string;
};

export type PhasekitToolHandlers = {
  phasekit_init_project(input?: InitProjectInput): Promise<PhasekitToolResult<InitializePlanningStateResult>>;
  phasekit_get_status(input?: StatusInput): Promise<PhasekitToolResult<PhasekitStatus>>;
  phasekit_next_action(input?: NextActionInput): Promise<PhasekitToolResult<NextAction>>;
  phasekit_ingest_paths(input: IngestPathsInput): Promise<PhasekitToolResult<IngestTextInput[]>>;
  phasekit_advance(input: AdvanceInput): Promise<PhasekitToolResult<never>>;
  phasekit_write_artifact(input: WriteArtifactInput): Promise<PhasekitToolResult<never>>;
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
      return initializePlanningState(resolveRootDir(input, defaultContext), { config: input.config });
    }),
    phasekit_get_status: (input = {}) => runTool(async () => {
      return getStatus({ rootDir: resolveRootDir(input, defaultContext), runId: input.runId });
    }),
    phasekit_next_action: (input = {}) => runTool(async () => {
      const status = await getStatus({ rootDir: resolveRootDir(input, defaultContext), runId: input.runId });

      return status.next_action;
    }),
    phasekit_ingest_paths: (input) => runTool(async () => {
      return expandIngestPaths({ rootDir: resolveRootDir(input, defaultContext), inputPaths: input.inputPaths });
    }),
    phasekit_advance: () => notImplementedTool("phasekit_advance", "Run advancement is implemented in a later Phasekit phase."),
    phasekit_write_artifact: () => notImplementedTool(
      "phasekit_write_artifact",
      "Artifact writing is implemented in a later Phasekit phase.",
    ),
  };
}

export function createPhasekitOpenCodeTools(defaultContext: PhasekitToolContext = {}): PhasekitOpenCodeTools {
  const schema = tool.schema;

  return {
    phasekit_init_project: tool({
      description: "Initialize Phasekit canonical .planning state when missing.",
      args: {
        rootDir: schema.string().optional(),
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult("Phasekit init", await handlers.phasekit_init_project({ rootDir: args.rootDir }));
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
      },
      execute: async (args, context) => {
        const handlers = createPhasekitToolHandlers(resolveToolContext(context, defaultContext));

        return toOpenCodeToolResult(
          "Phasekit ingest paths",
          await handlers.phasekit_ingest_paths({ rootDir: args.rootDir, inputPaths: args.inputPaths }),
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
  };
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

function resolveToolContext(
  context: { worktree?: string; directory?: string },
  defaultContext: PhasekitToolContext,
): PhasekitToolContext {
  return {
    rootDir: defaultContext.rootDir ?? context.worktree ?? context.directory,
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

async function notImplementedTool(toolName: string, message: string): Promise<PhasekitToolResult<never>> {
  return {
    ok: false,
    error: {
      code: "PHASEKIT_TOOL_NOT_IMPLEMENTED",
      message: `${toolName}: ${message}`,
    },
  };
}

function toToolError(error: unknown): PhasekitToolError {
  if (error instanceof Error) {
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
