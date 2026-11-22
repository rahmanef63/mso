import { describe, expect, it } from "vitest";
import {
  actionRefFromEvent,
  actionRefFromSemantic,
  diffLineCap,
  findLatestArtifactEvent,
  handleDiffCommand,
} from "./mso-agent-diff.mjs";

describe("MSO Agent diff command and renderer", () => {
  it("action-ref builder from a semantic {step, action} produces S3.A2", () => {
    // Direct semantic object
    expect(actionRefFromSemantic({ step: 3, action: 2 })).toBe("S3.A2");

    // Semantic wrapped in an event object
    expect(actionRefFromEvent({ semantic: { step: 3, action: 2, category: "implement", version: 1 } })).toBe("S3.A2");

    // Explicit actionRef field is preferred over semantic coordinates
    expect(actionRefFromEvent({ actionRef: "action_1234567890abcdef1234", semantic: { step: 3, action: 2 } })).toBe("action_1234567890abcdef1234");
    expect(actionRefFromEvent({ ref: "action_ref_custom", semantic: { step: 1, action: 1 } })).toBe("action_ref_custom");

    // Malformed inputs return null safely
    expect(actionRefFromSemantic(null)).toBeNull();
    expect(actionRefFromSemantic({ step: "invalid", action: 2 } as unknown as { step: number; action: number })).toBeNull();
    expect(actionRefFromEvent(null)).toBeNull();
  });

  it("finds the most recent event with an artifact revision", () => {
    const events = [
      { at: "2026-10-29T10:00:00Z", kind: "tool", tool: "fs_read" },
      {
        at: "2026-10-29T10:01:00Z",
        kind: "tool",
        tool: "fs_write",
        artifactRevision: { version: 1, cwd: "/app", relativePath: "first.ts" },
        semantic: { step: 1, action: 2 },
      },
      { at: "2026-10-29T10:02:00Z", kind: "note" },
      {
        at: "2026-10-29T10:03:00Z",
        kind: "tool",
        tool: "fs_write",
        artifactRevision: { version: 1, cwd: "/app", relativePath: "second.ts" },
        semantic: { step: 2, action: 1 },
      },
      { at: "2026-10-29T10:04:00Z", kind: "workflow" },
    ];

    const latest = findLatestArtifactEvent(events);
    expect(latest).toBeDefined();
    expect(latest?.artifactRevision?.relativePath).toBe("second.ts");
    expect(actionRefFromEvent(latest)).toBe("S2.A1");
  });

  it("calculates terminal height line cap within bounds", () => {
    // 24 - 6 = 18
    expect(diffLineCap(24)).toBe(18);
    // Upper capped at 200
    expect(diffLineCap(500)).toBe(200);
    // Lower bounded at 1
    expect(diffLineCap(5)).toBe(1);
  });

  it("handles /diff command integration without throwing errors out of the TUI", async () => {
    const printed: string[] = [];
    const errors: string[] = [];
    const print = (text: string) => printed.push(text);
    const error = (text: string) => errors.push(text);

    const apiCalls: string[] = [];
    const mockApi = async (path: string) => {
      apiCalls.push(path);
      if (path.includes("view=artifact")) {
        return {
          artifact: { relativePath: "src/index.ts" },
          diff: { available: true, changed: true, unifiedDiff: "@@ -1,1 +1,1 @@\n-a\n+b" },
        };
      }
      return {
        session: {
          events: [
            {
              kind: "tool",
              artifactRevision: { version: 1, cwd: "/repo", relativePath: "src/index.ts" },
              semantic: { step: 3, action: 2 },
            },
          ],
        },
      };
    };

    const session = {
      agentSession: { id: "session-xyz" },
    };

    // Invoking without args fetches session events, resolves ref, then diffs
    await handleDiffCommand(session, [], { api: mockApi, print, error });
    expect(apiCalls[0]).toContain("/api/v1/agent-sessions?ref=session-xyz");
    expect(apiCalls[1]).toContain("action_ref=S3.A2");
    expect(printed[0]).toContain("src/index.ts");
    expect(printed[0]).toContain("+b");

    // Invoking with explicit action ref skips session events fetch
    apiCalls.length = 0;
    printed.length = 0;
    await handleDiffCommand(session, ["S4.A1"], { api: mockApi, print, error });
    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0]).toContain("action_ref=S4.A1");
    expect(printed[0]).toContain("src/index.ts");

    // Server failures are caught and reported without crashing
    const failingApi = async () => {
      throw new Error("network down");
    };
    await expect(handleDiffCommand(session, ["S4.A1"], { api: failingApi, print, error })).resolves.not.toThrow();
    expect(errors[0]).toContain("network down");
  });
});
