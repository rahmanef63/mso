import { beforeEach, describe, expect, it } from "vitest";
import { alfaRunState, clearAlfaRunState, startAlfaRunState, setAlfaOperation, stopAlfaRunState, endAlfaRunState, recordAlfaRunActivity } from "./alfa-run-state";
import { registerAlfaRunner, registerAlfaStop, sendToAlfa, stopAlfa, unregisterAlfaRunner } from "./alfa";
beforeEach(() => { unregisterAlfaRunner(); clearAlfaRunState(); });
describe("Alfa actual run lifetime", () => {
  it("distinguishes approval waiting and freezes terminal states", () => {
    const id = startAlfaRunState();
    setAlfaOperation("fs.mkdir", true);
    expect(alfaRunState()?.status).toBe("waiting");
    setAlfaOperation("fs.mkdir");
    expect(alfaRunState()?.status).toBe("working");
    endAlfaRunState(id, "failed");
    endAlfaRunState(id, "done");
    expect(alfaRunState()?.status).toBe("failed");
  });
  it("keeps the single-flight lock until a stopped host call unwinds", async () => {
    let release!: () => void;
    registerAlfaRunner(async () => async () => new Promise<void>((resolve) => { release = resolve; }));
    registerAlfaStop(() => {});
    const pending = sendToAlfa("work");
    await Promise.resolve();
    stopAlfa();
    expect(alfaRunState()?.status).toBe("stopped");
    expect(await sendToAlfa("second")).toBe(false);
    release();
    await pending;
    expect(alfaRunState()?.status).toBe("stopped");
    registerAlfaRunner(async () => async () => {});
    await sendToAlfa("next");
    expect(alfaRunState()?.status).toBe("done");
  });
  it("does not launch a stopped lazy runner", async () => {
    let release!: (runner: () => Promise<void>) => void;
    let launched = false;
    registerAlfaRunner(() => new Promise((resolve) => { release = resolve; }));
    const pending = sendToAlfa("load");
    stopAlfa();
    release(async () => { launched = true; });
    expect(await pending).toBe(false);
    expect(launched).toBe(false);
  });
  it("records loader failure and never leaves Working after rejection", async () => {
    registerAlfaRunner(async () => { throw new Error("load"); });
    expect(await sendToAlfa("fail")).toBe(false);
    expect(alfaRunState()?.status).toBe("failed");
  });
  it("bounds activity and ignores old-run completions", () => {
    const old = startAlfaRunState();
    startAlfaRunState();
    endAlfaRunState(old, "done");
    expect(alfaRunState()?.status).toBe("working");
    for (let i = 0; i < 150; i++) recordAlfaRunActivity(String(i), "fs.read", "ok");
    expect(alfaRunState()?.activities).toHaveLength(120);
    stopAlfaRunState();
    setAlfaOperation("late tool");
    expect(alfaRunState()?.status).toBe("stopped");
  });
});
