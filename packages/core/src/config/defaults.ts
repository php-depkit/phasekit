import type { PhasekitConfig } from "./schema";

export const defaultConfig: PhasekitConfig = {
  commit: {
    mode: "ask",
    planning_commits: false,
  },
  quality: {
    review: "always",
    verify: "always",
  },
  greenfield: {
    recommend_stack: true,
    ask_before_locking_stack: true,
  },
  models: {
    orchestrator: "anthropic/claude-sonnet-4.5",
    context_scout: "anthropic/claude-haiku-4.5",
    prd_ingestor: "anthropic/claude-sonnet-4.5",
    grill_me: "anthropic/claude-sonnet-4.5",
    planner: "anthropic/claude-opus-4.5",
    executor: "anthropic/claude-sonnet-4.5",
    reviewer: "anthropic/claude-sonnet-4.5",
    verifier: "anthropic/claude-opus-4.5",
  },
  verification: {
    commands: {},
  },
};
