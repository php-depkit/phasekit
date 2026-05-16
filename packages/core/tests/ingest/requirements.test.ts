import { describe, expect, test } from "bun:test";

import {
  assignSourceRequirementIds,
  extractSourceRequirements,
  type IngestTextInput,
  type SourceRequirementCandidate,
} from "../../src/index";

const inputs: IngestTextInput[] = [
  {
    path: "/repo/docs/prd.md",
    relativePath: "docs/prd.md",
    text: "A user can ingest a PRD.\nA user can rerun ingest safely.\n",
  },
];

function candidate(text: string, locator: string): SourceRequirementCandidate {
  return {
    text,
    sources: [{ path: "docs/prd.md", locator }],
  };
}

describe("source requirement ID assignment", () => {
  test("assigns first ingest IDs sequentially in source order", () => {
    const state = assignSourceRequirementIds({
      candidates: [
        candidate("A user can rerun ingest safely.", "line:2"),
        candidate("A user can inspect ingest output.", "line:10"),
        candidate("A user can ingest a PRD.", "line:1"),
      ],
    });

    expect(state.requirements.map((requirement) => requirement.id)).toEqual(["REQ-1", "REQ-2", "REQ-3"]);
    expect(state.requirements.map((requirement) => requirement.text)).toEqual([
      "A user can ingest a PRD.",
      "A user can rerun ingest safely.",
      "A user can inspect ingest output.",
    ]);
  });

  test("preserves IDs across re-ingest when source requirements are unchanged", () => {
    const firstState = assignSourceRequirementIds({
      candidates: [
        candidate("A user can ingest a PRD.", "line:1"),
        candidate("A user can rerun ingest safely.", "line:2"),
      ],
    });

    const nextState = assignSourceRequirementIds({
      existingState: firstState,
      candidates: [
        candidate("A user can rerun ingest safely.", "line:2"),
        candidate("A user can ingest a PRD.", "line:1"),
      ],
    });

    expect(nextState.requirements.map((requirement) => requirement.id)).toEqual(["REQ-1", "REQ-2"]);
  });

  test("assigns a new ID for changed source requirement text without reusing old IDs", () => {
    const existingState = assignSourceRequirementIds({
      candidates: [candidate("A user can ingest a PRD.", "line:1")],
    });

    const nextState = assignSourceRequirementIds({
      existingState,
      candidates: [candidate("A user can ingest multiple PRDs.", "line:1")],
    });

    expect(nextState.requirements).toEqual([
      {
        id: "REQ-2",
        text: "A user can ingest multiple PRDs.",
        sources: [{ path: "docs/prd.md", locator: "line:1" }],
      },
    ]);
  });

  test("removes missing requirements without reusing removed IDs", () => {
    const existingState = assignSourceRequirementIds({
      candidates: [
        candidate("A user can ingest a PRD.", "line:1"),
        candidate("A user can rerun ingest safely.", "line:2"),
      ],
    });

    const nextState = assignSourceRequirementIds({
      existingState,
      candidates: [
        candidate("A user can rerun ingest safely.", "line:2"),
        candidate("A user can inspect ingest output.", "line:3"),
      ],
    });

    expect(nextState.requirements.map((requirement) => requirement.id)).toEqual(["REQ-2", "REQ-3"]);
    expect(nextState.requirements.map((requirement) => requirement.text)).toEqual([
      "A user can rerun ingest safely.",
      "A user can inspect ingest output.",
    ]);
  });

  test("retains source metadata from extracted requirements", async () => {
    const state = await extractSourceRequirements({
      inputs,
      extractor: (receivedInputs) => [
        {
          text: receivedInputs[0]?.text.split("\n")[0] ?? "",
          sources: [
            {
              path: receivedInputs[0]?.relativePath ?? "missing",
              locator: "line:1",
            },
          ],
        },
      ],
    });

    expect(state.requirements).toEqual([
      {
        id: "REQ-1",
        text: "A user can ingest a PRD.",
        sources: [{ path: "docs/prd.md", locator: "line:1" }],
      },
    ]);
  });

  test("requires source locators for traceable requirement mappings", () => {
    expect(() =>
      assignSourceRequirementIds({
        candidates: [
          {
            text: "A user can ingest a PRD.",
            sources: [{ path: "docs/prd.md", locator: "" }],
          },
        ],
      }),
    ).toThrow("Source requirement candidate for docs/prd.md must include a locator.");
  });

  test("rejects malformed or duplicate existing requirement IDs", () => {
    expect(() =>
      assignSourceRequirementIds({
        existingState: {
          requirements: [
            {
              id: "CUSTOM-1",
              text: "A user can ingest a PRD.",
              sources: [{ path: "docs/prd.md", locator: "line:1" }],
            },
          ],
        },
        candidates: [candidate("A user can ingest a PRD.", "line:1")],
      }),
    ).toThrow("Existing requirement ID CUSTOM-1 is invalid; expected REQ-<number>.");

    expect(() =>
      assignSourceRequirementIds({
        existingState: {
          requirements: [
            {
              id: "REQ-1",
              text: "A user can ingest a PRD.",
              sources: [{ path: "docs/prd.md", locator: "line:1" }],
            },
            {
              id: "REQ-1",
              text: "A user can rerun ingest safely.",
              sources: [{ path: "docs/prd.md", locator: "line:2" }],
            },
          ],
        },
        candidates: [candidate("A user can ingest a PRD.", "line:1")],
      }),
    ).toThrow("Duplicate existing requirement ID REQ-1.");
  });

  test("requires existing requirement sources to retain locators", () => {
    expect(() =>
      assignSourceRequirementIds({
        existingState: {
          requirements: [
            {
              id: "REQ-1",
              text: "A user can ingest a PRD.",
              sources: [{ path: "docs/prd.md" }],
            },
          ],
        },
        candidates: [candidate("A user can ingest a PRD.", "line:1")],
      }),
    ).toThrow("Existing requirement REQ-1 source docs/prd.md must include a locator.");
  });

  test("rejects duplicate existing source mappings with different text", () => {
    expect(() =>
      assignSourceRequirementIds({
        existingState: {
          requirements: [
            {
              id: "REQ-1",
              text: "A user can ingest a PRD.",
              sources: [{ path: "docs/prd.md", locator: "line:1" }],
            },
            {
              id: "REQ-2",
              text: "A user can ingest multiple PRDs.",
              sources: [{ path: "docs/prd.md", locator: "line:1" }],
            },
          ],
        },
        candidates: [candidate("A user can ingest a PRD.", "line:1")],
      }),
    ).toThrow("Duplicate existing source requirement mapping for REQ-2.");
  });

  test("rejects duplicate candidate source mappings with different text", () => {
    expect(() =>
      assignSourceRequirementIds({
        candidates: [
          candidate("A user can ingest a PRD.", "line:1"),
          candidate("A user can ingest multiple PRDs.", "line:1"),
        ],
      }),
    ).toThrow('Duplicate source requirement candidate mapping for [{"path":"docs/prd.md","locator":"line:1"}].');
  });
});
