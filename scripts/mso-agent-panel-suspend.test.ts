import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { ENTER_SEQUENCE, LEAVE_SEQUENCE, enterScreen } from "./mso-agent-altscreen.mjs";
import { MOUSE_OFF, MOUSE_ON, enableMouse } from "./mso-agent-mouse.mjs";
import { createPanelSuspension } from "./mso-agent-panel-suspend.mjs";

function fakeOutput() {
  const chunks: string[] = [];
  const output = new EventEmitter();
  Object.assign(output, {
    columns: 80,
    rows: 24,
    isTTY: true,
    write(value: string) {
      chunks.push(String(value));
      return true;
    },
  });
  return { output, chunks, all: () => chunks.join("") };
}

describe("panel suspension owns the terminal while a prompt runs", () => {
  it("leaves the alternate screen, or the prompt would be painted where the panel overwrites it", () => {
    const { output, all } = fakeOutput();
    const session: any = { streamSink: { write() {} } };
    enterScreen(output);

    const suspension = createPanelSuspension({ session, output, onRepaint() {}, onReset() {} });
    suspension.suspend();

    expect(all()).toContain(LEAVE_SEQUENCE);
    expect(session.streamSink).toBeUndefined();
  });

  it("turns mouse reporting off and the input hook off for the duration", () => {
    const { output, all } = fakeOutput();
    const session: any = { streamSink: { write() {} } };
    const toggles: boolean[] = [];
    enterScreen(output);
    // Mouse is idempotent, so it only writes the off sequence if it was on: enable it first, which
    // is also what the screen loop does when the panel opens.
    enableMouse(output);

    const suspension = createPanelSuspension({
      session,
      output,
      hook: { setEnabled: (on: boolean) => toggles.push(on) },
      onRepaint() {},
      onReset() {},
    });

    suspension.suspend();
    expect(toggles).toEqual([false]);
    expect(all()).toContain(MOUSE_OFF);

    suspension.resume();
    expect(toggles).toEqual([false, true]);
    expect(all()).toContain(MOUSE_ON);
  });

  it("re-enters, restores the sink and repaints exactly once on resume", () => {
    const { output, all } = fakeOutput();
    const sink = { write() {} };
    const session: any = { streamSink: sink };
    let repaints = 0;
    let resets = 0;
    enterScreen(output);

    const suspension = createPanelSuspension({
      session,
      output,
      onRepaint: () => { repaints += 1; },
      onReset: () => { resets += 1; },
    });

    suspension.suspend();
    suspension.resume();

    expect(session.streamSink).toBe(sink);
    expect(repaints).toBe(1);
    expect(resets).toBe(1);
    expect(all().split(ENTER_SEQUENCE).length - 1).toBe(2);
  });

  it("is idempotent in both directions, because a prompt can be nested in a retry", () => {
    const { output, all } = fakeOutput();
    const session: any = { streamSink: { write() {} } };
    let repaints = 0;
    enterScreen(output);

    const suspension = createPanelSuspension({
      session,
      output,
      onRepaint: () => { repaints += 1; },
      onReset() {},
    });

    suspension.suspend();
    suspension.suspend();
    expect(all().split(LEAVE_SEQUENCE).length - 1).toBe(1);

    suspension.resume();
    suspension.resume();
    expect(repaints).toBe(1);
    expect(suspension.isSuspended()).toBe(false);
  });

  it("resume without a suspend does nothing at all", () => {
    const { output, chunks } = fakeOutput();
    const session: any = { streamSink: { write() {} } };
    let repaints = 0;

    const suspension = createPanelSuspension({
      session,
      output,
      onRepaint: () => { repaints += 1; },
      onReset() {},
    });

    suspension.resume();
    expect(chunks).toEqual([]);
    expect(repaints).toBe(0);
  });

  it("survives a session with no sink and no hook, because both are optional in tests", () => {
    const { output, all } = fakeOutput();
    enterScreen(output);
    const suspension = createPanelSuspension({ session: {}, output, onRepaint() {}, onReset() {} });

    expect(() => { suspension.suspend(); suspension.resume(); }).not.toThrow();
    expect(all()).toContain(LEAVE_SEQUENCE);
    expect(all()).toContain(ENTER_SEQUENCE);
  });
});
