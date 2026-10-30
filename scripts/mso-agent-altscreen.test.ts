import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  ENTER_SEQUENCE,
  LEAVE_SEQUENCE,
  altScreenRequested,
  enterScreen,
  installTeardown,
  leaveScreen,
  startAltScreen,
} from "./mso-agent-altscreen.mjs";

class FakeOutput {
  columns = 80;
  chunks: string[] = [];
  isTTY?: boolean = true;
  write(value: string) {
    this.chunks.push(String(value));
    return true;
  }
}

describe("MSO Agent alternate screen manager", () => {
  it("no flag, no TTY, CI set, and one-shot mode each return false with a distinct reason", () => {
    const noFlag = altScreenRequested({ argv: [], env: {}, isTTY: true });
    expect(noFlag.ok).toBe(false);
    expect(noFlag.reason).toBe("not_requested");

    const noTty = altScreenRequested({ argv: ["--altscreen"], env: {}, isTTY: false });
    expect(noTty.ok).toBe(false);
    expect(noTty.reason).toBe("not_tty");

    const ciSet = altScreenRequested({ argv: ["--altscreen"], env: { CI: "true" }, isTTY: true });
    expect(ciSet.ok).toBe(false);
    expect(ciSet.reason).toBe("ci_environment");

    const oneShot = altScreenRequested({ argv: ["--altscreen", "--oneshot", "inspect"], env: {}, isTTY: true });
    expect(oneShot.ok).toBe(false);
    expect(oneShot.reason).toBe("oneshot_mode");

    const reasons = [noFlag.reason, noTty.reason, ciSet.reason, oneShot.reason];
    expect(new Set(reasons).size).toBe(4);
  });

  it("the flag plus a TTY returns true", () => {
    const result = altScreenRequested({ argv: ["--altscreen"], env: {}, isTTY: true });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe(null);
  });

  it("default is OFF and behaviour is byte-identical with no writes", () => {
    const output = new FakeOutput();
    const result = altScreenRequested({ argv: [], env: {}, isTTY: true });
    expect(result.ok).toBe(false);
    if (result.ok) enterScreen(output);
    expect(output.chunks.length).toBe(0);
  });

  it("enterScreen writes the enter sequence once and a second call writes nothing", () => {
    const output = new FakeOutput();
    const first = enterScreen(output);
    expect(first).toBe(true);
    expect(output.chunks).toEqual([ENTER_SEQUENCE]);

    const second = enterScreen(output);
    expect(second).toBe(false);
    expect(output.chunks).toEqual([ENTER_SEQUENCE]);

    leaveScreen(output);
  });

  it("leaveScreen after enter writes the leave sequence once; leaveScreen without enter writes nothing", () => {
    const unentered = new FakeOutput();
    const unenteredResult = leaveScreen(unentered);
    expect(unenteredResult).toBe(false);
    expect(unentered.chunks.length).toBe(0);

    const entered = new FakeOutput();
    enterScreen(entered);
    expect(entered.chunks).toEqual([ENTER_SEQUENCE]);

    const firstLeave = leaveScreen(entered);
    expect(firstLeave).toBe(true);
    expect(entered.chunks).toEqual([ENTER_SEQUENCE, LEAVE_SEQUENCE]);

    const secondLeave = leaveScreen(entered);
    expect(secondLeave).toBe(false);
    expect(entered.chunks).toEqual([ENTER_SEQUENCE, LEAVE_SEQUENCE]);
  });

  it("installTeardown then dispose restores the exact listener count for every signal it touched", () => {
    const fakeSource = new EventEmitter();
    const output = new FakeOutput();
    const signals = ["exit", "SIGINT", "SIGTERM", "SIGHUP"] as const;

    const initialCounts = Object.fromEntries(signals.map((sig) => [sig, fakeSource.listenerCount(sig)]));

    const teardown = installTeardown({ output, signalSource: fakeSource });

    for (const sig of signals) {
      expect(fakeSource.listenerCount(sig)).toBe(initialCounts[sig] + 1);
    }

    teardown.dispose();

    for (const sig of signals) {
      expect(fakeSource.listenerCount(sig)).toBe(initialCounts[sig]);
    }
  });

  it("emitting SIGTERM on the fake source after install writes the leave sequence", () => {
    const fakeSource = new EventEmitter();
    const output = new FakeOutput();

    enterScreen(output);
    expect(output.chunks).toEqual([ENTER_SEQUENCE]);

    const teardown = installTeardown({ output, signalSource: fakeSource });
    fakeSource.emit("SIGTERM");

    expect(output.chunks).toEqual([ENTER_SEQUENCE, LEAVE_SEQUENCE]);
    teardown.dispose();
  });

  it("a pre-existing SIGINT handler still runs after teardown is installed (the new handler must chain, not replace)", () => {
    const fakeSource = new EventEmitter();
    const output = new FakeOutput();
    let preExistingRan = false;

    fakeSource.on("SIGINT", () => {
      preExistingRan = true;
    });

    enterScreen(output);
    const teardown = installTeardown({ output, signalSource: fakeSource });

    fakeSource.emit("SIGINT");

    expect(preExistingRan).toBe(true);
    expect(output.chunks).toEqual([ENTER_SEQUENCE, LEAVE_SEQUENCE]);
    teardown.dispose();
  });

  it("an SIGINT that arrives before enterScreen writes nothing", () => {
    const fakeSource = new EventEmitter();
    const output = new FakeOutput();

    const teardown = installTeardown({ output, signalSource: fakeSource });
    fakeSource.emit("SIGINT");

    expect(output.chunks.length).toBe(0);
    teardown.dispose();
  });

  it("leaveScreen handles partial write errors gracefully", () => {
    const errorOutput = {
      isTTY: true,
      write() {
        throw new Error("broken pipe");
      },
    };
    enterScreen(errorOutput);
    // Safe teardown: errors during write do not bubble or prevent deactivating the screen.
    expect(() => leaveScreen(errorOutput)).not.toThrow();
    // Subsequent calls are safe no-ops because state was cleared before write.
    expect(leaveScreen(errorOutput)).toBe(false);
  });

  it("startAltScreen enters only when allowed and dispose releases before detaching", () => {
    const denied = new FakeOutput();
    const notRequested = new EventEmitter();
    const before = notRequested.listenerCount("SIGTERM");
    const skip = startAltScreen({ requested: { ok: false }, output: denied, processRef: notRequested });
    expect(skip.entered).toBe(false);
    expect(denied.chunks).toEqual([]);
    expect(notRequested.listenerCount("SIGTERM")).toBe(before);
    skip.dispose();

    const output = new FakeOutput();
    const signals = new EventEmitter();
    const screen = startAltScreen({ requested: { ok: true }, output, processRef: signals });
    expect(screen.entered).toBe(true);
    expect(output.chunks).toEqual([ENTER_SEQUENCE]);
    expect(signals.listenerCount("SIGTERM")).toBe(1);

    screen.dispose();
    expect(output.chunks).toEqual([ENTER_SEQUENCE, LEAVE_SEQUENCE]);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    expect(signals.listenerCount("exit")).toBe(0);
  });
});
