import { describe, expect, it, vi } from "vitest";
import { turnPrinter, withPanelSuspended } from "./mso-agent-turn-print.mjs";
import { renderInteractionFailure } from "./mso-agent-turn.mjs";
import { C } from "./mso-agent-runtime.mjs";

describe("mid-turn write routing and panel suspension", () => {
  it("routes writes to the fallback when no sink is installed", () => {
    // When the panel is off or not active, output must be byte-identical to normal terminal writes.
    const session = {};
    const fallback = vi.fn();
    const print = turnPrinter(session, fallback);

    print("plain message");
    print("message", "with", "multiple", "parts");

    expect(fallback).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenNthCalledWith(1, "plain message");
    expect(fallback).toHaveBeenNthCalledWith(2, "message", "with", "multiple", "parts");
  });

  it("routes lines to the stream sink and leaves the fallback untouched when sink is installed", () => {
    // When the panel is active, streamSink catches turn writes so they land in the viewport.
    const sink = { write: vi.fn() };
    const session = { streamSink: sink };
    const fallback = vi.fn();
    const print = turnPrinter(session, fallback);

    print("buffered error or turn notice");

    expect(sink.write).toHaveBeenCalledTimes(1);
    expect(sink.write).toHaveBeenCalledWith("buffered error or turn notice\n");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("sends section divider and each error line to the sink during renderInteractionFailure", () => {
    // Failures mid-turn must land in the viewport buffer instead of breaking frame rows.
    const sink = { write: vi.fn() };
    const session = { streamSink: sink, agentSession: { name: "test-agent" } };
    const print = turnPrinter(session);
    const error = new Error("simulated failure mid-turn");

    renderInteractionFailure(error, session, {}, C, print);

    expect(sink.write).toHaveBeenCalled();
    const combined = sink.write.mock.calls.map((call) => call[0]).join("");
    expect(combined).toContain("Error");
    expect(combined).toContain("simulated failure mid-turn");
  });

  it("suspends active panel so prompt output reaches fallback, sink receives nothing, and repaints after", async () => {
    // Answering approval prompts needs full terminal interaction; panel closes and repaints after.
    const sink = { write: vi.fn() };
    const session = { streamSink: sink };
    const fallback = vi.fn();
    const loop = {
      active: true,
      session,
      paint: vi.fn(),
    };
    const print = turnPrinter(session, fallback);

    await withPanelSuspended(loop, async () => {
      // During suspended execution, turnPrinter falls back to stdout instead of corrupting the sink.
      print("approval prompt: allow or deny?");
    });

    expect(fallback).toHaveBeenCalledWith("approval prompt: allow or deny?");
    expect(sink.write).not.toHaveBeenCalled();
    expect(loop.paint).toHaveBeenCalledTimes(1);
    expect(session.streamSink).toBe(sink);
  });

  it("repaints and restores the sink even when the suspended function throws, propagating the error", async () => {
    // Panel must not remain disabled if an interrupt or error terminates prompt input early.
    const sink = { write: vi.fn() };
    const session = { streamSink: sink };
    const loop = {
      active: true,
      session,
      paint: vi.fn(),
    };

    await expect(
      withPanelSuspended(loop, async () => {
        throw new Error("turn interrupted during approval");
      }),
    ).rejects.toThrow("turn interrupted during approval");

    expect(loop.paint).toHaveBeenCalledTimes(1);
    expect(session.streamSink).toBe(sink);
  });

  it("calls the function and repaints nothing when the panel is inactive", async () => {
    // When the panel is inactive, withPanelSuspended is a transparent passthrough.
    const loop = {
      active: false,
      paint: vi.fn(),
    };
    const fallback = vi.fn();

    const result = await withPanelSuspended(loop, () => {
      fallback("un-panelled call");
      return 42;
    });

    expect(result).toBe(42);
    expect(fallback).toHaveBeenCalledWith("un-panelled call");
    expect(loop.paint).not.toHaveBeenCalled();
  });
});
