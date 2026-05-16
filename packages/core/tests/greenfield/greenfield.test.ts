import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import {
  confirmStackQuestionAnswer,
  createConfirmedStackContexts,
  decideStack,
  detectGreenfieldProject,
  initializePlanningState,
  projectStateSchema,
  readJsonFile,
  writeConfirmedProjectStack,
  type StackDeclaration,
} from "../../src/index";

const recommendStack = { recommend_stack: true } as const;
const disableRecommendation = { recommend_stack: false } as const;

describe("greenfield detection", () => {
  test("treats empty repository input as deterministic greenfield", () => {
    expect(detectGreenfieldProject()).toEqual({
      isGreenfield: true,
      reason: "empty-repository",
    });

    expect(
      detectGreenfieldProject({
        repository: {
          implementationFiles: [],
          stackDeclarations: [],
        },
      }),
    ).toEqual({
      isGreenfield: true,
      reason: "empty-repository",
    });
  });

  test("treats Phasekit-only state as greenfield input", () => {
    expect(
      detectGreenfieldProject({
        repository: {
          implementationFiles: [
            ".planning/project.json",
            "./.planning/requirements.json",
            "/repo/.planning/phases.json",
          ],
        },
      }),
    ).toEqual({
      isGreenfield: true,
      reason: "empty-repository",
    });
  });

  test("respects existing confirmed project stack", () => {
    expect(
      detectGreenfieldProject({
        project: { stack: "Bun + TypeScript" },
        repository: { implementationFiles: ["src/index.ts"] },
      }),
    ).toEqual({
      isGreenfield: false,
      reason: "confirmed-stack",
    });

    expect(
      decideStack({
        project: { stack: "Bun + TypeScript" },
        greenfield: recommendStack,
        recommendedStack: "Next.js + TypeScript",
      }),
    ).toEqual({
      kind: "confirmed",
      stack: "Bun + TypeScript",
      project: { stack: "Bun + TypeScript" },
      source: "project",
    });
  });

  test("uses a single existing stack declaration", () => {
    const declarations: StackDeclaration[] = [
      { source: "package.json#phasekit.stack", stack: "Bun + TypeScript" },
    ];

    expect(detectGreenfieldProject({ repository: { stackDeclarations: declarations } })).toEqual({
      isGreenfield: false,
      reason: "declared-stack",
    });

    expect(decideStack({ repository: { stackDeclarations: declarations }, greenfield: recommendStack })).toEqual({
      kind: "confirmed",
      stack: "Bun + TypeScript",
      project: { stack: "Bun + TypeScript" },
      source: "declaration",
    });
  });

  test("returns a blocker for conflicting stack signals", () => {
    const decision = decideStack({
      repository: {
        stackDeclarations: [
          { source: "a", stack: "Next.js + TypeScript" },
          { source: "b", stack: "Bun + TypeScript" },
        ],
      },
      greenfield: recommendStack,
    });

    expect(decision.kind).toBe("blocker");
    expect(decision).toMatchObject({
      kind: "blocker",
      reason: "Conflicting stack declarations found: bun + typescript, next.js + typescript.",
      next_step: "Ask the user which stack should be canonical before planning implementation.",
    });
  });

  test("does not silently assume a stack when recommendation is disabled", () => {
    expect(
      decideStack({
        repository: { implementationFiles: [], stackDeclarations: [] },
        greenfield: disableRecommendation,
        recommendedStack: "Next.js + TypeScript",
      }),
    ).toEqual({
      kind: "none",
      reason: "recommendation-disabled",
    });
  });

  test("does not ask for a stack when existing implementation has no declaration", () => {
    expect(
      decideStack({
        repository: { implementationFiles: ["src/index.ts"] },
        greenfield: recommendStack,
        recommendedStack: "Bun + TypeScript",
      }),
    ).toEqual({
      kind: "none",
      reason: "existing-implementation",
    });
  });

  test("asks before using a recommended stack for greenfield input", () => {
    expect(
      decideStack({
        repository: { implementationFiles: [], stackDeclarations: [] },
        greenfield: recommendStack,
        recommendedStack: "Bun + TypeScript + SQLite",
      }),
    ).toEqual({
      kind: "question",
      recommendedStack: "Bun + TypeScript + SQLite",
      question: {
        id: "greenfield-stack",
        requirement_ids: ["greenfield-stack"],
        prompt: "Which tech stack should Phasekit use for this greenfield project?",
        options: [
          {
            id: "approve-recommended-stack",
            text: "Bun + TypeScript + SQLite",
            recommended: true,
          },
          {
            id: "edit-recommended-stack",
            text: "Edit the recommended stack before confirming",
            recommended: false,
          },
          {
            id: "use-different-stack",
            text: "Use a different stack",
            recommended: false,
          },
        ],
        custom_answer: {
          enabled: true,
          label: "Enter the stack to confirm",
        },
      },
    });
  });

  test("blocks instead of inventing a stack when recommendation input is missing", () => {
    expect(
      decideStack({
        repository: { implementationFiles: [], stackDeclarations: [] },
        greenfield: recommendStack,
      }),
    ).toEqual({
      kind: "blocker",
      reason: "Stack recommendation is enabled, but no recommended stack was provided.",
      next_step: "Provide an explicit recommended stack or disable greenfield stack recommendation.",
    });
  });
});

describe("stack confirmation payloads", () => {
  test("confirms the recommended option without silently accepting it before an answer", () => {
    const decision = decideStack({
      repository: { implementationFiles: [], stackDeclarations: [] },
      greenfield: recommendStack,
      recommendedStack: "Bun + TypeScript",
    });

    expect(decision.kind).toBe("question");

    if (decision.kind !== "question") {
      throw new Error("Expected a stack question decision.");
    }

    expect(decision.question.options.filter((option) => option.recommended)).toEqual([
      {
        id: "approve-recommended-stack",
        text: "Bun + TypeScript",
        recommended: true,
      },
    ]);

    expect(
      confirmStackQuestionAnswer({
        question: {
          id: decision.question.id,
          prompt: decision.question.prompt,
        },
        requirement_ids: decision.question.requirement_ids,
        selected_recommended_option: {
          id: "approve-recommended-stack",
          text: "Bun + TypeScript",
        },
      }),
    ).toEqual({
      kind: "confirmed",
      stack: "Bun + TypeScript",
      project: { stack: "Bun + TypeScript" },
      source: "answer",
    });
  });

  test("confirms custom stack answers", () => {
    expect(
      confirmStackQuestionAnswer({
        question: {
          id: "greenfield-stack",
          prompt: "Which tech stack should Phasekit use for this greenfield project?",
        },
        requirement_ids: ["greenfield-stack"],
        custom_answer_text: "SvelteKit + TypeScript",
      }),
    ).toEqual({
      kind: "confirmed",
      stack: "SvelteKit + TypeScript",
      project: { stack: "SvelteKit + TypeScript" },
      source: "answer",
    });
  });

  test("does not confirm edit or different-stack choices without custom stack text", () => {
    for (const option of ["edit-recommended-stack", "use-different-stack"]) {
      expect(
        confirmStackQuestionAnswer({
          question: {
            id: "greenfield-stack",
            prompt: "Which tech stack should Phasekit use for this greenfield project?",
          },
          requirement_ids: ["greenfield-stack"],
          selected_recommended_option: {
            id: option,
            text: "Use a different stack",
          },
        }),
      ).toEqual({
        kind: "blocker",
        reason: `Stack question option ${option} requires a custom stack answer before confirmation.`,
        next_step: "Ask the user to provide the exact stack to confirm.",
      });
    }
  });

  test("propagates confirmed stack into downstream contexts", () => {
    expect(createConfirmedStackContexts({ stack: "Bun + TypeScript" })).toEqual({
      ingest: { confirmed_stack: "Bun + TypeScript" },
      planning: { confirmed_stack: "Bun + TypeScript" },
      docs: { confirmed_stack: "Bun + TypeScript" },
      verification: { confirmed_stack: "Bun + TypeScript" },
    });
  });

  test("does not propagate a stack when none is confirmed", () => {
    expect(createConfirmedStackContexts({})).toEqual({
      ingest: {},
      planning: {},
      docs: {},
      verification: {},
    });
  });
});

describe("confirmed stack storage", () => {
  test("writes confirmed stack decisions to .planning/project.json", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "phasekit-greenfield-"));

    try {
      await initializePlanningState(rootDir);

      await writeConfirmedProjectStack(rootDir, "Bun + TypeScript");

      await expect(readJsonFile(join(rootDir, ".planning", "project.json"), projectStateSchema)).resolves.toEqual({
        stack: "Bun + TypeScript",
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
