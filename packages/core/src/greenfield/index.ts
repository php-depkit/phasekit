import { join } from "node:path";

import type { PhasekitConfig } from "../config/schema";
import type { GrillMeQuestion } from "../planning/slices";
import type { ProjectState } from "../state/schema";
import { readJsonFile, writeJsonFile } from "../state/json";
import { projectStateSchema } from "../state/schema";

export interface StackDeclaration {
  source: string;
  stack: string;
}

export interface GreenfieldRepositoryInput {
  implementationFiles?: readonly string[];
  stackDeclarations?: readonly StackDeclaration[];
}

export interface DetectGreenfieldProjectOptions {
  project?: ProjectState;
  repository?: GreenfieldRepositoryInput;
}

export type GreenfieldDetection =
  | {
      isGreenfield: true;
      reason: "empty-repository";
    }
  | {
      isGreenfield: false;
      reason: "confirmed-stack" | "declared-stack" | "implementation-files";
    };

export interface DecideStackOptions {
  project?: ProjectState;
  repository?: GreenfieldRepositoryInput;
  greenfield: Pick<PhasekitConfig["greenfield"], "recommend_stack">;
  recommendedStack?: string;
}

export type StackDecision =
  | {
      kind: "confirmed";
      stack: string;
      project: ProjectState;
      source: "project" | "declaration" | "answer";
    }
  | {
      kind: "question";
      question: GrillMeQuestion;
      recommendedStack: string;
    }
  | {
      kind: "blocker";
      reason: string;
      next_step: string;
      conflictingStacks?: readonly StackDeclaration[];
    }
  | {
      kind: "none";
      reason: "recommendation-disabled" | "existing-implementation";
    };

export type ConfirmedStackDecision = Extract<StackDecision, { kind: "confirmed" }>;
export type StackDecisionBlocker = Extract<StackDecision, { kind: "blocker" }>;

export function detectGreenfieldProject(options: DetectGreenfieldProjectOptions = {}): GreenfieldDetection {
  if (hasText(options.project?.stack)) {
    return { isGreenfield: false, reason: "confirmed-stack" };
  }

  const declarations = normalizeStackDeclarations(options.repository?.stackDeclarations ?? []);
  if (declarations.length > 0) {
    return { isGreenfield: false, reason: "declared-stack" };
  }

  const implementationFiles = normalizeValues(options.repository?.implementationFiles ?? []);
  if (implementationFiles.length > 0) {
    return { isGreenfield: false, reason: "implementation-files" };
  }

  return { isGreenfield: true, reason: "empty-repository" };
}

export function decideStack(options: DecideStackOptions): StackDecision {
  if (hasText(options.project?.stack)) {
    return confirmStackDecision(options.project?.stack ?? "", "project");
  }

  const declarations = normalizeStackDeclarations(options.repository?.stackDeclarations ?? []);
  const declarationStacks = uniqueNormalizedStacks(declarations);

  if (declarationStacks.length > 1) {
    return {
      kind: "blocker",
      reason: `Conflicting stack declarations found: ${declarationStacks.join(", ")}.`,
      next_step: "Ask the user which stack should be canonical before planning implementation.",
      conflictingStacks: declarations,
    };
  }

  const declaredStack = declarations[0]?.stack;
  if (declaredStack !== undefined) {
    return confirmStackDecision(declaredStack, "declaration");
  }

  if (!detectGreenfieldProject(options).isGreenfield) {
    return { kind: "none", reason: "existing-implementation" };
  }

  if (!options.greenfield.recommend_stack) {
    return { kind: "none", reason: "recommendation-disabled" };
  }

  if (!hasText(options.recommendedStack)) {
    return {
      kind: "blocker",
      reason: "Stack recommendation is enabled, but no recommended stack was provided.",
      next_step: "Provide an explicit recommended stack or disable greenfield stack recommendation.",
    };
  }

  const recommendedStack = options.recommendedStack.trim();

  return {
    kind: "question",
    recommendedStack,
    question: {
      id: "greenfield-stack",
      requirement_ids: ["greenfield-stack"],
      prompt: "Which tech stack should Phasekit use for this greenfield project?",
      options: [
        {
          id: "approve-recommended-stack",
          text: recommendedStack,
          recommended: true,
        },
      ],
      custom_answer: {
        enabled: true,
        label: "Use a different stack",
      },
    },
  };
}

export function confirmStackDecision(
  stack: string,
  source: "project" | "declaration" | "answer" = "answer",
): ConfirmedStackDecision | StackDecisionBlocker {
  if (!hasText(stack)) {
    return {
      kind: "blocker",
      reason: "Confirmed stack must not be empty.",
      next_step: "Ask the user for the stack before writing project state.",
    };
  }

  const confirmedStack = stack.trim();

  return {
    kind: "confirmed",
    stack: confirmedStack,
    project: { stack: confirmedStack },
    source,
  };
}

export async function writeConfirmedProjectStack(rootDir: string, stack: string): Promise<ProjectState> {
  const decision = confirmStackDecision(stack);

  if (decision.kind !== "confirmed") {
    throw new Error(decision.reason);
  }

  const projectPath = join(rootDir, ".planning", "project.json");
  const existingProject = await readJsonFile(projectPath, projectStateSchema);
  const nextProject: ProjectState = {
    ...existingProject,
    stack: decision.stack,
  };

  await writeJsonFile(projectPath, nextProject);

  return nextProject;
}

function normalizeStackDeclarations(declarations: readonly StackDeclaration[]): StackDeclaration[] {
  return declarations
    .filter((declaration) => hasText(declaration.source) && hasText(declaration.stack))
    .map((declaration) => ({
      source: declaration.source.trim(),
      stack: declaration.stack.trim(),
    }))
    .sort((left, right) => compareValues(left.source, right.source) || compareValues(left.stack, right.stack));
}

function uniqueNormalizedStacks(declarations: readonly StackDeclaration[]): string[] {
  return [...new Set(declarations.map((declaration) => declaration.stack.toLowerCase()))].sort(compareValues);
}

function normalizeValues(values: readonly string[]): string[] {
  return values.filter(hasText).map((value) => value.trim()).filter(isProjectImplementationPath).sort(compareValues);
}

function isProjectImplementationPath(path: string): boolean {
  const normalizedPath = path.replaceAll("\\", "/").replace(/^\.\//, "");
  return !normalizedPath.split("/").includes(".planning");
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

function compareValues(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
