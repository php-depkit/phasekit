import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const defaultImage = "ghcr.io/anomalyco/opencode:latest";
const defaultArtifactRoot = "tmp/opencode-acp";
const defaultTimeoutSeconds = 600;
const defaultCommands = ["pk-init", "pk-ingest PRD.md", "pk-status"] as const;
const defaultHostname = "127.0.0.1";
const defaultWorkspaceRoot = "/tmp/opencode-acp-workspaces";
const smokePluginSpec = "@depkit/phasekit-opencode";
const providerEnvNames = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GOOGLE_API_KEY",
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
] as const;

type Options = {
  artifactDir: string;
  providerConfig?: string;
  commands: string[];
  image: string;
  timeoutSeconds: number;
  skipBuild: boolean;
  dryRun: boolean;
  envNames: string[];
};

type SessionInfo = {
  id: string;
  title: string;
};

type PermissionEventRecord = {
  observedAt: string;
  event: unknown;
};

type CompletedToolOutput = {
  tool: string;
  callId: string;
  input: unknown;
  output: unknown;
  rawOutput: string;
  messageId?: string;
};

type StepContext = {
  command: string;
  response: unknown;
  tools: CompletedToolOutput[];
  tool: Record<string, unknown>;
};

type TemplateContext = {
  steps: Record<string, StepContext>;
  last: StepContext | null;
};

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const args = parseCliArgs(repoRoot);
  const artifactDir = resolve(repoRoot, args.artifactDir);
  const workspaceDir = join(defaultWorkspaceRoot, basename(artifactDir), "workspace");
  const logsDir = join(artifactDir, "logs");
  const providerConfigPath = args.providerConfig ? resolve(args.providerConfig) : undefined;

  if (!args.dryRun && !providerConfigPath) {
    throw new Error("--provider-config is required unless --dry-run is set.");
  }

  if (providerConfigPath) {
    await assertFileExists(providerConfigPath, "provider config");
  }

  await mkdir(logsDir, { recursive: true });
  await writeFile(join(artifactDir, ".gitignore"), "*\n", "utf8");

  if (!args.skipBuild) {
    await runCommand(["bun", "run", "build"], { cwd: repoRoot, label: "build repo packages" });
  }

  await createWorkspace({ repoRoot, workspaceDir });
  await runCommand(["bun", "install"], { cwd: workspaceDir, label: "install generated workspace dependencies" });
  await runCommand([join(workspaceDir, "node_modules", ".bin", "phasekit-install"), "--project", "--plugin", smokePluginSpec], {
    cwd: workspaceDir,
    label: "install Phasekit OpenCode artifacts",
  });
  const runtimePluginSpec = await replaceWorkspacePluginWithLocalFile(workspaceDir);

  const envNames = collectEnvNames(args.envNames);
  const port = await getAvailablePort();
  const baseUrl = `http://${defaultHostname}:${port}`;
  const containerName = createContainerName(artifactDir);
  const dockerArgs = buildServerArgs({
    repoRoot,
    workspaceDir,
    image: args.image,
    providerConfigPath,
    envNames,
    port,
    containerName,
  });

  const metadata = {
    createdAt: new Date().toISOString(),
    repoRoot,
    artifactDir,
    workspaceDir,
    image: args.image,
    commands: args.commands,
    timeoutSeconds: args.timeoutSeconds,
    providerConfigPath: providerConfigPath ?? null,
    providerEnvNames: envNames,
    server: {
      hostname: defaultHostname,
      port,
      baseUrl,
      containerName,
      docker: ["docker", ...dockerArgs],
    },
    pluginSpec: runtimePluginSpec,
    commandsRun: args.commands.map((command) => ({ command })),
  };

  await writeFile(join(artifactDir, "run-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  if (args.dryRun) {
    console.log(`Dry run complete. Artifacts written to ${artifactDir}`);
    return;
  }

  const server = await spawnDockerServer({ dockerArgs, repoRoot, containerName });
  try {
    console.log("==> wait for OpenCode health");
    await waitForHealth({ baseUrl, timeoutSeconds: Math.min(args.timeoutSeconds, 60) });
    console.log("==> resolve model");
    const model = await resolveModel({ baseUrl, workspaceDir });
    console.log("==> create session");
    const session = await createSession({ baseUrl, workspaceDir });
    const permissionEvents: PermissionEventRecord[] = [];
    const permissionWatcher = watchPermissions({
      baseUrl,
      workspaceDir,
      sessionId: session.id,
      records: permissionEvents,
    });
    await writeFile(join(logsDir, "model.txt"), `${model}\n`, "utf8");
    await writeFile(join(logsDir, "session.json"), `${JSON.stringify(session, null, 2)}\n`, "utf8");

    try {
      const templateContext: TemplateContext = {
        steps: {},
        last: null,
      };
      const seenToolCallIds = new Set<string>();

      for (const [index, command] of args.commands.entries()) {
        const stepNumber = index + 1;
        const resolvedCommand = renderCommandTemplate(command, templateContext);
        console.log(`==> run session command ${stepNumber}/${args.commands.length}: ${resolvedCommand}`);
        const response = await runSessionCommand({
          baseUrl,
          workspaceDir,
          sessionId: session.id,
          command: resolvedCommand,
          model,
        });
        const stepMessages = await fetchSessionMessages({
          baseUrl,
          workspaceDir,
          sessionId: session.id,
        });
        const stepTools = collectCompletedToolOutputs(stepMessages, seenToolCallIds);
        const stepContext: StepContext = {
          command: resolvedCommand,
          response,
          tools: stepTools,
          tool: Object.fromEntries(stepTools.map((tool) => [tool.tool, tool.output])),
        };
        templateContext.steps[String(stepNumber)] = stepContext;
        templateContext.last = stepContext;

        await writeFile(join(logsDir, `step-${stepNumber}.command.txt`), `${resolvedCommand}\n`, "utf8");
        await writeFile(join(logsDir, `step-${stepNumber}.response.json`), `${JSON.stringify(response, null, 2)}\n`, "utf8");
        await writeFile(join(logsDir, `step-${stepNumber}.messages.json`), `${JSON.stringify(stepMessages, null, 2)}\n`, "utf8");
        await writeFile(join(logsDir, `step-${stepNumber}.tools.json`), `${JSON.stringify(stepTools, null, 2)}\n`, "utf8");
      }

      const messages = await fetchSessionMessages({ baseUrl, workspaceDir, sessionId: session.id });
      await writeFile(join(logsDir, "messages.json"), `${JSON.stringify(messages, null, 2)}\n`, "utf8");
    } finally {
      await permissionWatcher.stop();
      await writeFile(join(logsDir, "permission-events.json"), `${JSON.stringify(permissionEvents, null, 2)}\n`, "utf8");
    }
  } finally {
    await stopDockerServer(server, logsDir);
  }

  console.log(`Smoke run complete. Artifacts written to ${artifactDir}`);
}

function parseCliArgs(repoRoot: string): Options {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const parsed = parseArgs({
    options: {
      "artifact-dir": { type: "string", default: join(defaultArtifactRoot, timestamp) },
      "provider-config": { type: "string" },
      command: { type: "string", multiple: true, default: [...defaultCommands] },
      image: { type: "string", default: defaultImage },
      "timeout-seconds": { type: "string", default: String(defaultTimeoutSeconds) },
      "skip-build": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      env: { type: "string", multiple: true, default: [] },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    printHelp(repoRoot);
    process.exit(0);
  }

  const timeoutSeconds = Number(parsed.values["timeout-seconds"]);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error("--timeout-seconds must be a positive integer.");
  }

  return {
    artifactDir: parsed.values["artifact-dir"],
    providerConfig: parsed.values["provider-config"],
    commands: parsed.values.command,
    image: parsed.values.image,
    timeoutSeconds,
    skipBuild: parsed.values["skip-build"],
    dryRun: parsed.values["dry-run"],
    envNames: parsed.values.env,
  };
}

function printHelp(repoRoot: string) {
  const lines = [
    "Manual OpenCode server smoke harness",
    "",
    "Usage:",
    "  bun run smoke:opencode -- --provider-config ./path/to/opencode-provider.jsonc",
    "  bun run smoke:opencode -- --command pk-init --command 'pk-ingest PRD.md' --command pk-status",
    "",
    "Notes:",
    `  - Creates a disposable workspace under ${defaultWorkspaceRoot}/<artifact-name>/workspace to avoid loading ancestor repo config.`,
    "  - Builds local packages, installs them into the generated workspace, then runs phasekit-install --project.",
    "  - Starts ghcr.io/anomalyco/opencode:latest with `opencode serve` in Docker and calls the HTTP session command API directly.",
    "  - The generated workspace rewrites .opencode/opencode.jsonc to a file URL for a local bridge plugin after installer-managed artifacts are written.",
    "  - Docker mounts the generated workspace, the repo root read-only for file: dependency symlinks, and the optional provider config.",
    "  - Provider secrets should be exported in your shell before running; common provider env vars are passed through automatically.",
    "  - Use --env NAME to pass additional environment variable names into the container.",
    "  - Repeating --command runs multiple session commands sequentially and writes per-step JSON responses.",
    "  - Use --dry-run to generate the workspace and command metadata without starting Docker.",
    "",
    `Repository root: ${repoRoot}`,
  ];

  console.log(lines.join("\n"));
}

async function createWorkspace(input: { repoRoot: string; workspaceDir: string }) {
  const { repoRoot, workspaceDir } = input;
  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });

  const prdFixturePath = join(repoRoot, "packages", "core", "tests", "fixtures", "sample-prd.md");
  const packageJson = createWorkspacePackageJson(repoRoot);

  await writeFile(join(workspaceDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  await cp(prdFixturePath, join(workspaceDir, "PRD.md"));
  await writeFile(
    join(workspaceDir, "README.md"),
    [
      "# Phasekit Smoke Workspace",
      "",
      "This directory is generated by `scripts/run-opencode-acp-smoke.ts`.",
      "It exists only to exercise the local installer, generated OpenCode artifacts, and a Dockerized OpenCode server session.",
      "",
      "Input fixture:",
      "- `PRD.md` copied from `packages/core/tests/fixtures/sample-prd.md`",
      "",
    ].join("\n"),
    "utf8",
  );
}

export function createWorkspacePackageJson(repoRoot: string) {
  return {
    name: "phasekit-opencode-smoke-workspace",
    private: true,
    type: "module",
    // The container executes verification commands with Node tooling on PATH, not Bun.
    packageManager: "npm@10.0.0",
    scripts: {
      test: "node --version",
      typecheck: "node --version",
      lint: "node --version",
    },
    dependencies: {
      "@depkit/phasekit-core": `file:${join(repoRoot, "packages", "core")}`,
      "@depkit/phasekit-opencode": `file:${join(repoRoot, "packages", "opencode")}`,
      "@depkit/phasekit-install": `file:${join(repoRoot, "packages", "install")}`,
    },
  };
}

async function replaceWorkspacePluginWithLocalFile(workspaceDir: string) {
  const pluginDir = join(workspaceDir, ".opencode", "plugins");
  const configPath = join(workspaceDir, ".opencode", "opencode.jsonc");
  const pluginPath = join(pluginDir, "phasekit-plugin.js");
  const pluginSpec = pathToFileURL(pluginPath).href;

  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [pluginSpec] }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    pluginPath,
    [
      'import phasekitOpenCodePlugin from "../../node_modules/@depkit/phasekit-opencode/dist/plugin.js";',
      "",
      "export default phasekitOpenCodePlugin;",
      "",
    ].join("\n"),
    "utf8",
  );

  return pluginSpec;
}

function collectEnvNames(explicitEnvNames: string[]) {
  const names = new Set<string>();
  for (const envName of providerEnvNames) {
    if (process.env[envName]) {
      names.add(envName);
    }
  }
  for (const envName of explicitEnvNames) {
    if (!/^[A-Z0-9_]+$/.test(envName)) {
      throw new Error(`Invalid environment variable name: ${envName}`);
    }
    names.add(envName);
  }
  return [...names].sort();
}

function buildServerArgs(input: {
  repoRoot: string;
  workspaceDir: string;
  image: string;
  providerConfigPath?: string;
  envNames: string[];
  port: number;
  containerName: string;
}) {
  const args = [
    "run",
    "--rm",
    "--interactive",
    "--name",
    input.containerName,
    "--workdir",
    input.workspaceDir,
    "--publish",
    `${defaultHostname}:${input.port}:${input.port}`,
    "--volume",
    `${input.workspaceDir}:${input.workspaceDir}`,
    "--volume",
    `${input.repoRoot}:${input.repoRoot}:ro`,
  ];

  for (const envName of input.envNames) {
    args.push("--env", envName);
  }

  if (input.providerConfigPath) {
    const mountedConfigPath = "/root/.config/opencode/opencode.jsonc";
    args.push("--volume", `${input.providerConfigPath}:${mountedConfigPath}:ro`);
  }

  args.push("--entrypoint", "opencode");
  args.push(input.image, "serve", "--hostname", "0.0.0.0", "--port", String(input.port), "--print-logs");
  return args;
}

async function spawnDockerServer(input: { dockerArgs: string[]; repoRoot: string; containerName: string }) {
  console.log("==> start Dockerized OpenCode server");
  await removeDockerContainer(input.containerName);
  const proc = spawn("docker", input.dockerArgs, {
    cwd: input.repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (chunk: string | Buffer) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(text);
  });
  proc.stderr.on("data", (chunk: string | Buffer) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });

  return { proc, stdout: () => stdout, stderr: () => stderr, containerName: input.containerName };
}

async function stopDockerServer(
  server: { proc: ChildProcess; stdout: () => string; stderr: () => string; containerName: string },
  logsDir: string,
) {
  server.proc.kill("SIGTERM");
  await new Promise<void>((resolveClose) => {
    if (server.proc.exitCode !== null) {
      resolveClose();
      return;
    }
    server.proc.once("close", () => resolveClose());
    setTimeout(() => {
      if (server.proc.exitCode === null) {
        server.proc.kill("SIGKILL");
      }
    }, 5000);
  });

  await removeDockerContainer(server.containerName);

  await writeFile(join(logsDir, "server.stdout.log"), server.stdout(), "utf8");
  await writeFile(join(logsDir, "server.stderr.log"), server.stderr(), "utf8");
}

function createContainerName(artifactDir: string) {
  const artifactName = basename(artifactDir).toLowerCase().replace(/[^a-z0-9_.-]+/g, "-");
  return `phasekit-opencode-smoke-${artifactName}`;
}

async function removeDockerContainer(containerName: string) {
  const proc = spawn("docker", ["rm", "-f", containerName], {
    env: process.env,
    stdio: "ignore",
  });

  await new Promise<void>((resolveClose) => {
    proc.once("close", () => resolveClose());
    proc.once("error", () => resolveClose());
  });
}

async function waitForHealth(input: { baseUrl: string; timeoutSeconds: number }) {
  const deadline = Date.now() + input.timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${input.baseUrl}/global/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling until the server is ready
    }
    await sleep(500);
  }

  throw new Error(`OpenCode server did not become healthy within ${input.timeoutSeconds} seconds.`);
}

async function createSession(input: { baseUrl: string; workspaceDir: string }) {
  const response = await fetchJson({
    url: `${input.baseUrl}/session?directory=${encodeURIComponent(input.workspaceDir)}`,
    method: "POST",
    body: { title: "Phasekit smoke run" },
  });
  return response as SessionInfo;
}

async function runSessionCommand(input: {
  baseUrl: string;
  workspaceDir: string;
  sessionId: string;
  command: string;
  model: string;
}) {
  const parsedCommand = parseSessionCommand(input.command);
  return fetchJson({
    url: `${input.baseUrl}/session/${encodeURIComponent(input.sessionId)}/command?directory=${encodeURIComponent(input.workspaceDir)}`,
    method: "POST",
    body: {
      command: parsedCommand.command,
      arguments: parsedCommand.arguments,
      model: input.model,
    },
  });
}

export function parseSessionCommand(commandText: string) {
  const trimmed = commandText.trim();
  if (trimmed.length === 0) {
    throw new Error("Smoke command text must not be empty.");
  }

  const firstWhitespace = trimmed.search(/\s/);
  if (firstWhitespace === -1) {
    return {
      command: trimmed,
      arguments: "",
    };
  }

  return {
    command: trimmed.slice(0, firstWhitespace),
    arguments: trimmed.slice(firstWhitespace).trimStart(),
  };
}

export function renderCommandTemplate(commandText: string, context: TemplateContext) {
  return commandText.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, expression: string) => {
    const resolved = resolveTemplatePath(context, expression.trim());
    if (resolved === undefined) {
      throw new Error(`Template expression '${expression.trim()}' did not resolve to a value.`);
    }

    if (typeof resolved === "string") {
      return resolved;
    }

    return JSON.stringify(resolved);
  });
}

export function resolveTemplatePath(context: TemplateContext, expression: string): unknown {
  const segments = expression
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  let current: unknown = context;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

async function fetchSessionMessages(input: { baseUrl: string; workspaceDir: string; sessionId: string }) {
  return fetchJson({
    url: `${input.baseUrl}/session/${encodeURIComponent(input.sessionId)}/message?directory=${encodeURIComponent(input.workspaceDir)}`,
    method: "GET",
  });
}

export function collectCompletedToolOutputs(messages: unknown, seenCallIds?: Set<string>) {
  const toolOutputs: CompletedToolOutput[] = [];
  for (const part of collectToolParts(messages)) {
    const tool = typeof part.tool === "string" ? part.tool : undefined;
    const callId = typeof part.callID === "string" ? part.callID : undefined;
    const state = isRecord(part.state) ? part.state : undefined;
    if (!tool || !callId || state?.status !== "completed") {
      continue;
    }
    if (seenCallIds?.has(callId)) {
      continue;
    }

    const rawOutput = typeof state.output === "string" ? state.output : JSON.stringify(state.output ?? null);
    toolOutputs.push({
      tool,
      callId,
      input: state.input,
      output: parseCompletedToolOutput(rawOutput),
      rawOutput,
      messageId: typeof part.messageID === "string" ? part.messageID : undefined,
    });
    seenCallIds?.add(callId);
  }

  return toolOutputs;
}

function collectToolParts(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectToolParts(item));
  }
  if (!isRecord(value)) {
    return [];
  }

  const parts = Array.isArray(value.parts)
    ? value.parts.flatMap((part) => collectToolParts(part))
    : [];
  return value.type === "tool" ? [value, ...parts] : parts;
}

function parseCompletedToolOutput(rawOutput: string): unknown {
  try {
    return JSON.parse(rawOutput);
  } catch {
    return rawOutput;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function watchPermissions(input: {
  baseUrl: string;
  workspaceDir: string;
  sessionId: string;
  records: PermissionEventRecord[];
}) {
  const abortController = new AbortController();
  const approvedPermissionIds = new Set<string>();
  const done = (async () => {
    try {
      const response = await fetch(`${input.baseUrl}/global/event`, {
        method: "GET",
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error(`Request failed (${response.status}) for GET ${input.baseUrl}/global/event`);
      }
      if (!response.body) {
        throw new Error("OpenCode event stream did not include a response body.");
      }

      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();

      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += value;

        while (true) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary === -1) {
            break;
          }

          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const parsed = parseServerSentEvent(rawEvent);
          if (!parsed) {
            continue;
          }

          input.records.push({
            observedAt: new Date().toISOString(),
            event: parsed,
          });
          await maybeApprovePermission({
            baseUrl: input.baseUrl,
            workspaceDir: input.workspaceDir,
            sessionId: input.sessionId,
            approvedPermissionIds,
            event: parsed,
          });
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }
      throw error;
    }
  })();

  return {
    async stop() {
      abortController.abort();
      await done.catch((error) => {
        if (!(error instanceof Error && error.name === "AbortError")) {
          throw error;
        }
      });
    },
  };
}

function parseServerSentEvent(rawEvent: string) {
  const lines = rawEvent.split("\n");
  const eventType = lines
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim();
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return null;
  }

  const parsed = JSON.parse(dataLines.join("\n")) as {
    directory?: string;
    type?: string;
    properties?: Record<string, unknown>;
    payload?: {
      type?: string;
      properties?: Record<string, unknown>;
    };
  };

  if (parsed.payload) {
    return {
      directory: parsed.directory,
      payload: {
        type: parsed.payload.type ?? eventType,
        properties: parsed.payload.properties,
      },
    };
  }

  return {
    directory: parsed.directory,
    payload: {
      type: parsed.type ?? eventType,
      properties: parsed.properties ?? parsed,
    },
  };
}

async function maybeApprovePermission(input: {
  baseUrl: string;
  workspaceDir: string;
  sessionId: string;
  approvedPermissionIds: Set<string>;
  event: {
    directory?: string;
    payload?: {
      type?: string;
      properties?: Record<string, unknown>;
    };
  };
}) {
  if (input.event.directory && input.event.directory !== input.workspaceDir) {
    return;
  }

  const eventType = input.event.payload?.type;
  if (eventType !== "permission.asked" && eventType !== "permission.updated") {
    return;
  }

  const properties = input.event.payload?.properties;
  const permissionId = typeof properties?.id === "string" ? properties.id : undefined;
  const permissionSessionId = typeof properties?.sessionID === "string" ? properties.sessionID : undefined;

  if (!permissionId || permissionSessionId !== input.sessionId || input.approvedPermissionIds.has(permissionId)) {
    return;
  }

  input.approvedPermissionIds.add(permissionId);
  console.log(`==> auto-approve permission ${permissionId}`);
  await fetchJson({
    url: `${input.baseUrl}/session/${encodeURIComponent(input.sessionId)}/permissions/${encodeURIComponent(permissionId)}?directory=${encodeURIComponent(input.workspaceDir)}`,
    method: "POST",
    body: { response: "once" },
  });
}

async function resolveModel(input: { baseUrl: string; workspaceDir: string }) {
  const response = (await fetchJson({
    url: `${input.baseUrl}/config/providers?directory=${encodeURIComponent(input.workspaceDir)}`,
    method: "GET",
  })) as {
    providers?: Array<{
      id: string;
      models: Record<string, {
        capabilities?: {
          toolcall?: boolean;
          input?: {
            image?: boolean;
            video?: boolean;
            audio?: boolean;
          };
        };
      }>;
    }>;
    default?: Record<string, string>;
  };

  for (const [providerId, modelId] of Object.entries(response.default ?? {})) {
    if (modelId && supportsToolUse(response.providers, providerId, modelId)) {
      return `${providerId}/${modelId}`;
    }
  }

  for (const provider of response.providers ?? []) {
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      if (!model.capabilities?.toolcall) {
        continue;
      }
      if (model.capabilities.input?.image || model.capabilities.input?.video || model.capabilities.input?.audio) {
        continue;
      }

      return `${provider.id}/${modelId}`;
    }
  }

  for (const provider of response.providers ?? []) {
    const [modelId] = Object.keys(provider.models ?? {});
    if (modelId) {
      return `${provider.id}/${modelId}`;
    }
  }

  throw new Error("Could not resolve a model from /config/providers.");
}

function supportsToolUse(
  providers: Array<{
    id: string;
    models: Record<string, { capabilities?: { toolcall?: boolean } }>;
  }> | undefined,
  providerId: string,
  modelId: string,
) {
  const provider = providers?.find((item) => item.id === providerId);
  return provider?.models?.[modelId]?.capabilities?.toolcall === true;
}

async function getAvailablePort() {
  return new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();
    server.on("error", rejectPort);
    server.listen(0, defaultHostname, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => rejectPort(new Error("Failed to determine an available port.")));
        return;
      }
      server.close((error) => {
        if (error) {
          rejectPort(error);
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

async function fetchJson(input: { url: string; method: string; body?: unknown }) {
  const response = await fetch(input.url, {
    method: input.method,
    headers: input.body ? { "content-type": "application/json" } : undefined,
    body: input.body ? JSON.stringify(input.body) : undefined,
  });

  const text = await response.text();
  const parsed = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${input.method} ${input.url}: ${text}`);
  }
  return parsed;
}

async function assertFileExists(filePath: string, label: string) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error(`${label} path is not a file: ${filePath}`);
    }
  } catch (error) {
    throw new Error(`${label} not found: ${filePath}`, { cause: error });
  }
}

async function runCommand(
  command: string[],
  options: {
    cwd: string;
    label: string;
    env?: NodeJS.ProcessEnv;
    allowFailure?: boolean;
  },
) {
  console.log(`==> ${options.label}`);
  const [commandName, ...commandArgs] = command;
  const proc = spawn(commandName, commandArgs, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (chunk: string | Buffer) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(text);
  });
  proc.stderr.on("data", (chunk: string | Buffer) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
    proc.on("error", rejectExit);
    proc.on("close", (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0 && !options.allowFailure) {
    throw new Error(`${options.label} failed with exit code ${exitCode}`);
  }

  return { stdout, stderr, exitCode };
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

if (import.meta.main) {
  await main();
}
