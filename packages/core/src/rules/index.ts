import {
  ruleSchema,
  rulesStateSchema,
  type Rule,
  type RulesState,
} from "../state/schema";
import { parseStateFile } from "../state/parse";

export type AddRuleOptions = {
  state: RulesState;
  rule: Rule;
};

export type EditRuleOptions = {
  state: RulesState;
  rule: Rule;
};

export type RemoveRuleOptions = {
  state: RulesState;
  ruleId: string;
};

/** Validates canonical `.planning/rules.json` state. */
export function validateRulesState(value: unknown): RulesState {
  return parseStateFile("rules.json", rulesStateSchema, value);
}

/** Appends a new rule while preserving existing rule order. */
export function addRule(options: AddRuleOptions): RulesState {
  const state = validateRulesState(options.state);
  const rule = parseStateFile("rule", ruleSchema, options.rule);

  if (state.rules.some((existingRule) => existingRule.id === rule.id)) {
    throw new Error(`Cannot add rule ${rule.id}: rule already exists.`);
  }

  return validateRulesState({
    rules: [...state.rules, rule],
  });
}

/** Replaces an existing rule without changing rule order. */
export function editRule(options: EditRuleOptions): RulesState {
  const state = validateRulesState(options.state);
  const rule = parseStateFile("rule", ruleSchema, options.rule);
  const existingIndex = state.rules.findIndex((existingRule) => existingRule.id === rule.id);

  if (existingIndex === -1) {
    throw new Error(`Cannot edit rule ${rule.id}: rule does not exist.`);
  }

  return validateRulesState({
    rules: state.rules.map((existingRule, index) => index === existingIndex ? rule : existingRule),
  });
}

/** Removes an existing rule while preserving the remaining rule order. */
export function removeRule(options: RemoveRuleOptions): RulesState {
  const state = validateRulesState(options.state);

  if (options.ruleId.length === 0) {
    throw new Error("Cannot remove rule: rule id is required.");
  }

  if (!state.rules.some((rule) => rule.id === options.ruleId)) {
    throw new Error(`Cannot remove rule ${options.ruleId}: rule does not exist.`);
  }

  return validateRulesState({
    rules: state.rules.filter((rule) => rule.id !== options.ruleId),
  });
}
