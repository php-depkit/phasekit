import { describe, expect, test } from "bun:test";

import {
  addRule,
  editRule,
  removeRule,
  validateRulesState,
  type RulesState,
} from "../../src/index";

function rulesState(): RulesState {
  return {
    rules: [
      {
        id: "rule-1",
        category: "workflow",
        text: "Keep TODO state current.",
      },
      {
        id: "rule-2",
        category: "safety",
        text: "Do not edit generated agent instructions directly.",
      },
    ],
  };
}

describe("rules state helpers", () => {
  test("validates canonical rules state", () => {
    expect(validateRulesState(rulesState())).toEqual(rulesState());
  });

  test("adds, edits, and removes rules deterministically", () => {
    const added = addRule({
      state: rulesState(),
      rule: {
        id: "rule-3",
        category: "verification",
        text: "Run targeted checks before broader checks.",
      },
    });

    expect(added.rules.map((rule) => rule.id)).toEqual(["rule-1", "rule-2", "rule-3"]);

    const edited = editRule({
      state: added,
      rule: {
        id: "rule-2",
        category: "safety",
        text: "Edit canonical JSON instead of generated markdown.",
      },
    });

    expect(edited.rules.map((rule) => rule.id)).toEqual(["rule-1", "rule-2", "rule-3"]);
    expect(edited.rules[1]).toEqual({
      id: "rule-2",
      category: "safety",
      text: "Edit canonical JSON instead of generated markdown.",
    });

    expect(removeRule({ state: edited, ruleId: "rule-1" })).toEqual({
      rules: [
        {
          id: "rule-2",
          category: "safety",
          text: "Edit canonical JSON instead of generated markdown.",
        },
        {
          id: "rule-3",
          category: "verification",
          text: "Run targeted checks before broader checks.",
        },
      ],
    });
  });

  test("rejects duplicate rule IDs", () => {
    expect(() => {
      validateRulesState({
        rules: [
          { id: "rule-1", category: "workflow", text: "First rule." },
          { id: "rule-1", category: "safety", text: "Duplicate rule." },
        ],
      });
    }).toThrow('Invalid rules.json: rules.1.id: Duplicate rule id "rule-1".');

    expect(() => {
      addRule({
        state: rulesState(),
        rule: { id: "rule-1", category: "workflow", text: "Duplicate add." },
      });
    }).toThrow("Cannot add rule rule-1: rule already exists.");
  });

  test("rejects missing edited and removed IDs", () => {
    expect(() => {
      editRule({
        state: rulesState(),
        rule: { id: "missing", category: "workflow", text: "Missing edit." },
      });
    }).toThrow("Cannot edit rule missing: rule does not exist.");

    expect(() => {
      removeRule({ state: rulesState(), ruleId: "missing" });
    }).toThrow("Cannot remove rule missing: rule does not exist.");
  });

  test("surfaces actionable validation errors", () => {
    expect(() => {
      validateRulesState({
        rules: [{ id: "rule-1", category: "workflow", text: "" }],
      });
    }).toThrow("Invalid rules.json: rules.0.text: String must contain at least 1 character(s)");

    expect(() => {
      removeRule({ state: rulesState(), ruleId: "" });
    }).toThrow("Cannot remove rule: rule id is required.");
  });
});
