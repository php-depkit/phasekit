import { describe, expect, test } from "bun:test";

import { collectCompletedToolOutputs, createWorkspacePackageJson, parseSessionCommand, renderCommandTemplate, resolveTemplatePath } from "./run-opencode-acp-smoke";

describe("parseSessionCommand", () => {
  test("preserves the full argument tail verbatim", () => {
    expect(parseSessionCommand('pk-run-phase {"phaseId":"P11-T2","plan":{"tasks":[{"id":"task-1"}]}}')).toEqual({
      command: "pk-run-phase",
      arguments: '{"phaseId":"P11-T2","plan":{"tasks":[{"id":"task-1"}]}}',
    });
  });

  test("allows commands without arguments", () => {
    expect(parseSessionCommand("pk-status")).toEqual({
      command: "pk-status",
      arguments: "",
    });
  });
});

describe("renderCommandTemplate", () => {
  test("resolves prior step values into later commands", () => {
    const context = {
      steps: {
        "3": {
          command: "pk-run-phase INGEST-ingested-requirements",
          response: {},
          tools: [],
          tool: {
            phasekit_run_phase: {
              data: {
                next_required: {
                  pending_task_ids: ["task-1"],
                  request_id: "review-req-1",
                },
              },
            },
          },
        },
        "4": {
          command: "pk-verify ...",
          response: {},
          tools: [],
          tool: {
            phasekit_verify_scope: {
              id: "verify-phase-INGEST-ingested-requirements",
              scope: { kind: "phase", phase_id: "INGEST-ingested-requirements" },
            },
          },
        },
      },
      last: {
        command: "pk-verify ...",
        response: {},
        tools: [],
        tool: {
          phasekit_verify_scope: {
            id: "verify-phase-INGEST-ingested-requirements",
            scope: { kind: "phase", phase_id: "INGEST-ingested-requirements" },
          },
        },
      },
    };

    expect(
      renderCommandTemplate(
        'pk-run-phase {"phaseId":"INGEST-ingested-requirements","verificationRequestId":"{{steps.3.tool.phasekit_run_phase.data.next_required.request_id}}","verificationResult":{{last.tool.phasekit_verify_scope}}}',
        context,
      ),
    ).toBe(
      'pk-run-phase {"phaseId":"INGEST-ingested-requirements","verificationRequestId":"review-req-1","verificationResult":{"id":"verify-phase-INGEST-ingested-requirements","scope":{"kind":"phase","phase_id":"INGEST-ingested-requirements"}}}',
    );
  });

  test("supports bracketed array indices", () => {
    const context = {
      steps: {
        "3": {
          command: "pk-run-phase ...",
          response: {},
          tools: [],
          tool: {
            phasekit_run_phase: {
              data: {
                next_required: {
                  pending_task_ids: ["task-1"],
                },
              },
            },
          },
        },
      },
      last: null,
    };

    expect(resolveTemplatePath(context, "steps.3.tool.phasekit_run_phase.data.next_required.pending_task_ids[0]")).toBe("task-1");
  });
});

describe("collectCompletedToolOutputs", () => {
  test("returns only newly completed tool parts with parsed JSON output", () => {
    const seen = new Set<string>(["call-seen"]);
    const messages = [
      {
        parts: [
          {
            type: "tool",
            tool: "phasekit_run_phase",
            callID: "call-seen",
            messageID: "msg-1",
            state: {
              status: "completed",
              input: { phaseId: "P1" },
              output: '{"ok":true,"data":{"next_required":{"request_id":"skip-me"}}}',
            },
          },
          {
            type: "tool",
            tool: "phasekit_run_phase",
            callID: "call-new",
            messageID: "msg-2",
            state: {
              status: "completed",
              input: { phaseId: "P1" },
              output: '{"ok":true,"data":{"next_required":{"request_id":"review-1"}}}',
            },
          },
          {
            type: "tool",
            tool: "phasekit_verify_scope",
            callID: "call-pending",
            messageID: "msg-3",
            state: {
              status: "running",
              input: { scope: { kind: "phase", phase_id: "P1" } },
              output: '{}',
            },
          },
        ],
      },
    ];

    expect(collectCompletedToolOutputs(messages, seen)).toEqual([
      {
        tool: "phasekit_run_phase",
        callId: "call-new",
        input: { phaseId: "P1" },
        output: { ok: true, data: { next_required: { request_id: "review-1" } } },
        rawOutput: '{"ok":true,"data":{"next_required":{"request_id":"review-1"}}}',
        messageId: "msg-2",
      },
    ]);
    expect(seen.has("call-new")).toBe(true);
  });
});

describe("createWorkspacePackageJson", () => {
  test("uses portable node-based verification scripts for the smoke container", () => {
    expect(createWorkspacePackageJson("/repo")).toMatchObject({
      packageManager: "npm@10.0.0",
      scripts: {
        test: "node --version",
        typecheck: "node --version",
        lint: "node --version",
      },
    });
  });
});
