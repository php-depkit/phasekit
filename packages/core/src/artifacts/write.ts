import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

import { agentsMdManagedMarker, assertCanOverwriteAgentsMd } from "./agents-md";

export const projectArtifactManagedMarker = "<!-- phasekit:managed project-artifact v1 -->";

const projectGeneratedArtifacts = new Set([
  "PROJECT.md",
  "PHASES.md",
  "RUN-SUMMARY.md",
  "VERIFICATION.md",
  "AGENTS.md",
]);

export type ManagedConfigArtifactPolicy = {
  directory: string;
  fileNamePattern: RegExp;
  managedMarker: string;
};

export type WriteGeneratedArtifactOptions = {
  rootDir?: string;
  configRoot?: string;
  approvedConfigArtifacts?: ManagedConfigArtifactPolicy[];
  path: string;
  content: string;
};

export type WriteGeneratedArtifactResult = {
  path: string;
};

export async function writeGeneratedArtifact(options: WriteGeneratedArtifactOptions): Promise<WriteGeneratedArtifactResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const approvedConfigArtifacts = options.approvedConfigArtifacts ?? [];
  const targetPath = options.path;
  const content = options.content;

  assertSafePathInput(targetPath);

  const resolvedRoot = resolve(rootDir);
  const resolvedConfigRoot = resolve(options.configRoot ?? join(homedir(), ".config"));
  const resolvedProjectTarget = resolve(resolvedRoot, targetPath);
  const relativeProjectTarget = normalize(relative(resolvedRoot, resolvedProjectTarget));
  const resolvedConfigTarget = resolve(resolvedConfigRoot, targetPath);
  const relativeConfigTarget = normalize(relative(resolvedConfigRoot, resolvedConfigTarget));

  const policy = resolveArtifactPolicy({
    resolvedRoot,
    resolvedConfigRoot,
    resolvedProjectTarget,
    relativeProjectTarget,
    resolvedConfigTarget,
    relativeConfigTarget,
    approvedConfigArtifacts,
  });
  const resolvedTarget = policy.targetPath;
  await assertManagedPolicyIfRequired(resolvedTarget, policy);

  await mkdir(dirname(resolvedTarget), { recursive: true });
  await writeFile(resolvedTarget, content, "utf8");

  return { path: policy.reportedPath };
}

type ArtifactPolicy = {
  marker?: string;
  reportedPath: string;
  targetPath: string;
};

type ArtifactPolicyInput = {
  resolvedRoot: string;
  resolvedConfigRoot: string;
  resolvedProjectTarget: string;
  relativeProjectTarget: string;
  resolvedConfigTarget: string;
  relativeConfigTarget: string;
  approvedConfigArtifacts: ManagedConfigArtifactPolicy[];
};

function resolveArtifactPolicy(input: ArtifactPolicyInput): ArtifactPolicy {
  if (isAllowedProjectArtifact(input.resolvedRoot, input.resolvedProjectTarget, input.relativeProjectTarget)) {
    const fileName = basename(input.resolvedProjectTarget);
    const marker =
      fileName === "AGENTS.md"
        ? agentsMdManagedMarker
        : fileName === "PROJECT.md" || fileName === "PHASES.md" || fileName === "RUN-SUMMARY.md" || fileName === "VERIFICATION.md"
          ? projectArtifactManagedMarker
          : undefined;

    return {
      marker,
      reportedPath: fileName,
      targetPath: input.resolvedProjectTarget,
    };
  }

  const configArtifactPolicy = resolveManagedConfigArtifactPolicy(
    input.approvedConfigArtifacts,
    input.resolvedConfigTarget,
    input.relativeConfigTarget,
  );
  if (configArtifactPolicy) {
    return {
      marker: configArtifactPolicy.managedMarker,
      reportedPath: input.relativeConfigTarget,
      targetPath: input.resolvedConfigTarget,
    };
  }

  throw new Error(
    `Refusing to write artifact ${JSON.stringify(input.relativeProjectTarget)}: path is not an approved generated artifact location.`,
  );
}

function isAllowedProjectArtifact(rootDir: string, resolvedTarget: string, relativeTarget: string): boolean {
  return dirname(resolvedTarget) === rootDir && projectGeneratedArtifacts.has(relativeTarget);
}

function resolveManagedConfigArtifactPolicy(
  policies: ManagedConfigArtifactPolicy[],
  resolvedTarget: string,
  relativeTarget: string,
): ManagedConfigArtifactPolicy | null {
  const targetDirectory = dirname(relativeTarget);
  const targetFileName = basename(resolvedTarget);

  for (const policy of policies) {
    if (targetDirectory !== policy.directory) {
      continue;
    }

    if (!policy.fileNamePattern.test(targetFileName)) {
      continue;
    }

    return policy;
  }

  return null;
}

async function assertManagedPolicyIfRequired(path: string, policy: ArtifactPolicy): Promise<void> {
  if (!policy.marker) {
    return;
  }

  const existingContent = await readExistingContent(path);

  if (policy.marker === agentsMdManagedMarker) {
    assertCanOverwriteAgentsMd(existingContent);
    return;
  }

  if (existingContent !== null && !existingContent.startsWith(policy.marker)) {
    throw new Error(`Refusing to overwrite unmanaged generated artifact: ${path}`);
  }
}

function assertSafePathInput(path: string): void {
  if (!path || path.trim().length === 0) {
    throw new Error("Refusing to write artifact: path is required.");
  }

  if (isAbsolute(path)) {
    throw new Error(`Refusing to write artifact ${JSON.stringify(path)}: absolute paths are not allowed.`);
  }
}

async function readExistingContent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
