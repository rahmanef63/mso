import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { handleSettingsCommand, applySettings } from "./mso-agent-cmd-settings.mjs";
import { MOUSE_OFF, MOUSE_ON } from "./mso-agent-mouse.mjs";
import { mountScreenLoop } from "./mso-agent-screen-loop.mjs";
import { SETTINGS } from "./mso-agent-settings-entries.mjs";

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 80;
  rows = 24;
  chunks: string[] = [];
  write(str: string) {
    this.chunks.push(String(str));
    return true;
  }
}

describe("mouse setting gates terminal mouse reporting and dispatch", () => {
  it("entry matches expected schema in settings registry", () => {
    // Registry entry must define key, path, category and binary on/off options.
    const entry = SETTINGS.find((s) => s.key === "mouse");
    expect(entry).toBeDefined();
    expect(entry?.category).toBe("Input");
    expect(entry?.path).toBe("mouse");
    expect(entry?.default).toBe("on");
    expect(entry?.values).toEqual(["on", "off"]);
  });

  it("1. default on writes the on sequence at mount, asserted against today's behaviour", () => {
    // Preserves existing behavior: when no mouse setting is specified, mouse reporting turns on.
    const output = new FakeOutput();
    const input = new EventEmitter();
    const session = { agentSession: { id: "s1", name: "test" }, history: [] };

    const loop = mountScreenLoop({ enabled: true, session, output, input });
    expect(output.chunks[0]).toBe(MOUSE_ON);

    loop.dispose();
    expect(output.chunks).toContain(MOUSE_OFF);
  });

  it("2. off writes nothing at mount and ignores wheel and click", () => {
    // With mouse disabled, terminal selection must remain unobstructed.
    const output = new FakeOutput();
    const input = new EventEmitter();
    const onTabClick = vi.fn();
    const session = {
      agentSession: { id: "s1", name: "test" },
      history: [],
      mouse: "off",
    };

    const loop = mountScreenLoop({
      enabled: true,
      session,
      output,
      input,
      onTabClick,
      getSessions: () => [{ id: "s1", name: "alpha" }, { id: "s2", name: "beta" }],
    });

    // Neither MOUSE_ON nor MOUSE_OFF should be emitted at mount when disabled.
    expect(output.chunks).not.toContain(MOUSE_ON);
    expect(output.chunks).not.toContain(MOUSE_OFF);

    const initialChunkCount = output.chunks.length;

    // Simulate mouse wheel sequence through input hook; must be ignored.
    input.emit("data", "\x1b[<64;20;15M");
    expect(output.chunks.length).toBe(initialChunkCount);

    // Simulate mouse click sequence on tab bar; callback must not be invoked.
    input.emit("data", "\x1b[<0;10;1M");
    expect(onTabClick).not.toHaveBeenCalled();

    loop.dispose();
  });

  it("3. toggling from on to off at runtime writes the off sequence immediately", async () => {
    // Turning mouse off at runtime releases terminal selection without restarting the agent.
    const output = new FakeOutput();
    const input = new EventEmitter();
    const session: any = { agentSession: { id: "s1", name: "test" }, history: [] };

    const loop = mountScreenLoop({ enabled: true, session, output, input });
    expect(output.chunks[0]).toBe(MOUSE_ON);

    // Toggle off via settings command to simulate user typing /settings mouse off.
    const ctx = { session, print: () => {}, C: {} };
    await handleSettingsCommand(ctx, ["mouse", "off"]);

    expect(session.mouse).toBe("off");
    expect(output.chunks).toContain(MOUSE_OFF);

    // Toggling back on writes MOUSE_ON immediately.
    await handleSettingsCommand(ctx, ["mouse", "on"]);
    expect(session.mouse).toBe("on");
    const onCount = output.chunks.filter((c) => c === MOUSE_ON).length;
    expect(onCount).toBe(2);

    loop.dispose();
  });

  it("4. after a suspend and resume with the setting off, no mouse sequence is written", () => {
    // When mouse is off, entering and leaving prompts must not turn mouse capture back on.
    const output = new FakeOutput();
    const input = new EventEmitter();
    const session = {
      agentSession: { id: "s1", name: "test" },
      history: [],
      mouse: "off",
    };

    const loop = mountScreenLoop({ enabled: true, session, output, input });
    const baselineChunks = [...output.chunks];

    loop.suspend();
    loop.resume();

    const postResumeChunks = output.chunks.slice(baselineChunks.length);
    const mouseSequences = postResumeChunks.filter((c) => c.includes(MOUSE_ON) || c.includes(MOUSE_OFF));
    expect(mouseSequences).toHaveLength(0);

    loop.dispose();
  });

  it("5. after a suspend and resume with the setting on, mouse is restored exactly once", () => {
    // Suspend must disable mouse capture, and resume must restore it once.
    const output = new FakeOutput();
    const input = new EventEmitter();
    const session = {
      agentSession: { id: "s1", name: "test" },
      history: [],
      mouse: "on",
    };

    const loop = mountScreenLoop({ enabled: true, session, output, input });
    expect(output.chunks[0]).toBe(MOUSE_ON);

    output.chunks = [];
    loop.suspend();
    expect(output.chunks).toContain(MOUSE_OFF);

    output.chunks = [];
    loop.resume();
    const onChunks = output.chunks.filter((c) => c === MOUSE_ON);
    expect(onChunks).toHaveLength(1);

    loop.dispose();
  });

  it("applySettings propagates mouse preference to session", () => {
    // Stored settings loaded at startup must configure session.mouse before mount.
    const sessionOff: any = {};
    applySettings(sessionOff, { mouse: "off" } as any);
    expect(sessionOff.mouse).toBe("off");

    const sessionOn: any = {};
    applySettings(sessionOn, { mouse: "on" } as any);
    expect(sessionOn.mouse).toBe("on");
  });
});
