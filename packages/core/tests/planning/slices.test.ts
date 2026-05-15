import { describe, expect, test } from "bun:test";

import {
  toPhasesState,
  validateGrillMeQuestionAnswer,
  validateGrillMeQuestion,
  validatePhaseSlices,
  validateRequirementCoverage,
  type GrillMeQuestionAnswer,
  type GrillMeQuestion,
  type PhaseSlice,
  type Requirement,
  type RequirementCoverageBlocker,
} from "../../src/index";

const requirements: Requirement[] = [
  {
    id: "REQ-1",
    text: "A user can ingest one or more PRDs.",
    sources: [{ path: "docs/prd.md", locator: "line:45" }],
  },
  {
    id: "REQ-2",
    text: "Existing projects capture tests and integration risks.",
    sources: [{ path: "docs/prd.md", locator: "line:49" }],
  },
];

function phaseSlice(id: string, requirementIds: readonly string[]): PhaseSlice {
  return {
    id,
    source_requirement_ids: requirementIds,
    expected_behavior: "Ingest produces traceable phase slices.",
    relevant_context: ["packages/core/src/ingest"],
    likely_change_areas: ["packages/core/src/planning"],
    test_strategy: ["Run focused planning tests."],
    integration_risks: ["Coverage gaps must block planning."],
    done_criteria: ["Each source requirement is covered or explicitly blocked."],
  };
}

function question(requirementIds: readonly string[]): GrillMeQuestion {
  return {
    id: "Q-1",
    requirement_ids: requirementIds,
    prompt: "Which persistence behavior should be implemented?",
    options: [
      {
        id: "approve-recommendation",
        text: "Use committed JSON as canonical state.",
        recommended: true,
      },
    ],
    custom_answer: {
      enabled: true,
      label: "Custom answer",
    },
  };
}

function recommendedAnswer(requirementIds: readonly string[]): GrillMeQuestionAnswer {
  return {
    question: {
      id: "Q-1",
      prompt: "Which persistence behavior should be implemented?",
    },
    requirement_ids: requirementIds,
    selected_recommended_option: {
      id: "approve-recommendation",
      text: "Use committed JSON as canonical state.",
    },
  };
}

describe("planning coverage validators", () => {
  test("accept valid requirement coverage through phase slices", () => {
    expect(() =>
      validateRequirementCoverage({
        requirements,
        phases: [phaseSlice("P5-T3", ["REQ-1", "REQ-2"])],
      }),
    ).not.toThrow();
  });

  test("rejects uncovered source requirements", () => {
    expect(() =>
      validateRequirementCoverage({
        requirements,
        phases: [phaseSlice("P5-T3", ["REQ-1"])],
      }),
    ).toThrow("Requirements missing phase, blocker, or question coverage: REQ-2.");
  });

  test("accepts blocked and questioned requirements as explicit non-phase coverage", () => {
    const blockers: RequirementCoverageBlocker[] = [
      {
        requirement_ids: ["REQ-1"],
        reason: "Implementation depends on a user decision.",
        next_step: "Ask for the persistence policy.",
      },
    ];

    expect(() =>
      validateRequirementCoverage({
        requirements,
        phases: [],
        blockers,
        questions: [question(["REQ-2"])],
      }),
    ).not.toThrow();
  });

  test("rejects unknown requirement references", () => {
    expect(() =>
      validateRequirementCoverage({
        requirements,
        phases: [phaseSlice("P5-T3", ["REQ-1", "REQ-404"])],
      }),
    ).toThrow("Requirement coverage phase references unknown requirements: REQ-404.");
  });

  test("rejects assumptions when a requirement needs an answer before implementation", () => {
    expect(() =>
      validateRequirementCoverage({
        requirements,
        phases: [phaseSlice("P5-T3", ["REQ-1", "REQ-2"])],
        questions: [question(["REQ-2"])],
      }),
    ).toThrow("Requirement coverage cannot assume implementation for blocked or questioned requirements: REQ-2.");
  });

  test("rejects raw phase references without testable outcomes", () => {
    expect(() =>
      validateRequirementCoverage({
        requirements,
        phases: [
          {
            id: "P5-T3",
            source_requirement_ids: ["REQ-1", "REQ-2"],
            expected_behavior: "Ingest produces traceable phase slices.",
            done_criteria: ["Each source requirement is covered or explicitly blocked."],
          } as never,
        ],
      }),
    ).toThrow("Phase slice P5-T3 test strategy must include at least one value.");

    expect(() =>
      validateRequirementCoverage({
        requirements,
        phases: [
          {
            ...phaseSlice("P5-T3", ["REQ-1", "REQ-2"]),
            done_criteria: [],
          },
        ],
      }),
    ).toThrow("Phase slice P5-T3 done criteria must include at least one value.");
  });
});

describe("grill-me answered question payload validation", () => {
  test("accepts selected recommended option and custom answer payloads", () => {
    expect(validateGrillMeQuestionAnswer(recommendedAnswer(["REQ-1"]))).toEqual(recommendedAnswer(["REQ-1"]));

    const customAnswer: GrillMeQuestionAnswer = {
      question: {
        id: "Q-1",
        prompt: "Which persistence behavior should be implemented?",
      },
      requirement_ids: ["REQ-1"],
      custom_answer_text: "Use SQLite as canonical state for this project.",
    };

    expect(validateGrillMeQuestionAnswer(customAnswer)).toBe(customAnswer);
  });

  test("rejects unanswered or ambiguous answered question payloads", () => {
    expect(() =>
      validateGrillMeQuestionAnswer({
        question: {
          id: "Q-1",
          prompt: "Which persistence behavior should be implemented?",
        },
        requirement_ids: ["REQ-1"],
      } as never),
    ).toThrow("Answered question Q-1 must include a recommended option or custom answer.");

    expect(() =>
      validateGrillMeQuestionAnswer({
        ...recommendedAnswer(["REQ-1"]),
        custom_answer_text: "Use the custom behavior instead.",
      } as never),
    ).toThrow("Answered question Q-1 must choose either a recommended option or a custom answer, not both.");
  });
});

describe("grill-me question payload validation", () => {
  test("accepts exactly one recommended option and custom answer support", () => {
    expect(validateGrillMeQuestion(question(["REQ-1"]))).toEqual(question(["REQ-1"]));
  });

  test("rejects missing or multiple recommended options and missing custom answers", () => {
    expect(() =>
      validateGrillMeQuestion({
        ...question(["REQ-1"]),
        options: [{ id: "one", text: "One", recommended: false }],
      }),
    ).toThrow("Question Q-1 must include exactly one recommended option.");

    expect(() =>
      validateGrillMeQuestion({
        ...question(["REQ-1"]),
        options: [
          { id: "one", text: "One", recommended: true },
          { id: "two", text: "Two", recommended: true },
        ],
      }),
    ).toThrow("Question Q-1 must include exactly one recommended option.");

    expect(() =>
      validateGrillMeQuestion({
        ...question(["REQ-1"]),
        custom_answer: { enabled: false, label: "Custom answer" } as never,
      }),
    ).toThrow("Question Q-1 must allow a custom answer.");
  });
});

describe("phase slice validation", () => {
  test("accepts phase slice shape and converts it to canonical phase state", () => {
    const slices = [phaseSlice("P5-T3", ["REQ-1"])] as const;

    expect(validatePhaseSlices(slices)).toBe(slices);
    expect(toPhasesState(slices)).toEqual({
      phases: [
        {
          ...slices[0],
          source_requirement_ids: ["REQ-1"],
          relevant_context: ["packages/core/src/ingest"],
          likely_change_areas: ["packages/core/src/planning"],
          test_strategy: ["Run focused planning tests."],
          integration_risks: ["Coverage gaps must block planning."],
          done_criteria: ["Each source requirement is covered or explicitly blocked."],
          status: "pending",
        },
      ],
    });
  });

  test("rejects phase slices without testable outcomes", () => {
    expect(() =>
      validatePhaseSlices([
        {
          ...phaseSlice("P5-T3", ["REQ-1"]),
          test_strategy: [],
        },
      ]),
    ).toThrow("Phase slice P5-T3 test strategy must include at least one value.");
  });
});
