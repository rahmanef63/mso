import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowOptimizerCandidate } from "./graph-optimizer";

const executeIntegrationAction = vi.fn();
vi.mock("@/lib/infra/connection-dispatch", () => ({ executeIntegrationAction }));

const { createJevWorkflowOptimizerEvaluator } = await import("./jev-optimizer");

const candidate = (id: string): WorkflowOptimizerCandidate => ({
  id,
  kind: "presentation-group",
  title: `Candidate ${id}`,
  description: "Compact a reviewed workflow segment without changing authority.",
  nodeIds: ["a", "b", "c"],
  risk: "safe",
  estimatedNodeDelta: 0,
  hostEligible: true,
});

beforeEach(() => executeIntegrationAction.mockReset());

describe("Jev workflow optimizer adapter", () => {
  it("adapts to state/questions typed evaluate schemas", async () => {
    executeIntegrationAction
      .mockResolvedValueOnce({ result: [{ name: "evaluate", inputSchema: { type: "object", properties: { state: {}, questions: {}, model: {} } } }] })
      .mockResolvedValueOnce({ result: { content: [{ type: "text", text: JSON.stringify({ answers: { q1: { type: "noul", noul: 0.91 } } }) }] } });
    const evaluate = createJevWorkflowOptimizerEvaluator({ user: "owner", connection: "jev", model: "jev-1.13.0" });
    const result = await evaluate({ workflow: { nodeCount: 8 } }, [candidate("safe-1")]);

    expect(result).toEqual({ provider: "jev", probabilities: { "safe-1": 0.91 } });
    expect(executeIntegrationAction).toHaveBeenCalledTimes(2);
    expect(executeIntegrationAction.mock.calls[1]?.[0]).toMatchObject({
      provider: "mcp",
      connection: "jev",
      operation: "mcp.tool",
      arguments: { name: "evaluate", arguments: { model: "jev-1.13.0" } },
    });
  });

  it("adapts to jev_decide bounded-alternative schemas", async () => {
    executeIntegrationAction
      .mockResolvedValueOnce({ result: [{ name: "jev_decide", inputSchema: { type: "object", properties: { decision: {}, evidence: {}, priorities: {}, candidates: {}, requirements: {} } } }] })
      .mockResolvedValueOnce({ result: { content: [{ type: "text", text: JSON.stringify({ recommendation: { selected: "apply", confidence: 0.88, probabilities: { apply: 0.84, skip: 0.16 } } }) }] } });
    const evaluate = createJevWorkflowOptimizerEvaluator({ user: "owner", connection: "jev" });
    const result = await evaluate({ workflow: { nodeCount: 8 } }, [candidate("safe-1")]);

    expect(result.probabilities["safe-1"]).toBe(0.84);
    expect(executeIntegrationAction.mock.calls[1]?.[0]).toMatchObject({
      operation: "mcp.tool",
      arguments: {
        name: "jev_decide",
        arguments: {
          candidates: [
            { id: "apply", description: expect.any(String) },
            { id: "skip", description: expect.any(String) },
          ],
          requirements: expect.any(Array),
        },
      },
    });
  });

  it("fails closed on an unsupported advertised decision schema so the core can fallback", async () => {
    executeIntegrationAction.mockResolvedValueOnce({
      result: [{ name: "jev_decide", inputSchema: { type: "object", properties: { prompt: {} } } }],
    });
    const evaluate = createJevWorkflowOptimizerEvaluator({ user: "owner", connection: "jev" });
    await expect(evaluate({}, [candidate("safe-1")])).rejects.toThrow("Unsupported Jev tool schema");
  });
});
