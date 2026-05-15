import type {
  PhasesState,
  ProjectState,
  RequirementsState,
  RulesState,
} from "./schema";

export const defaultProjectState: ProjectState = {};

export const defaultRequirementsState: RequirementsState = {
  requirements: [],
};

export const defaultPhasesState: PhasesState = {
  phases: [],
};

export const defaultRulesState: RulesState = {
  rules: [],
};
