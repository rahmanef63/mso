import { describe, expect, it, vi } from "vitest";
import { createSessionTransition } from "./session-transition";
import type { SessionSnapshot } from "./session-probe";

const owner: SessionSnapshot = { status: "in", role: "owner" };
const viewer: SessionSnapshot = { status: "in", role: "viewer" };

describe("session transition ordering", () => {
  it("clears secrets before publishing a downgrade and ignores an older owner response", () => {
    const order: string[] = [];
    const transition = createSessionTransition(next => order.push(String(next.role)), () => order.push("clear"));
    const oldProbe = transition.beginProbe();
    const newProbe = transition.beginProbe();
    expect(transition.acceptProbe(newProbe, viewer)).toBe(true);
    expect(transition.acceptProbe(oldProbe, owner)).toBe(false);
    expect(order).toEqual(["clear", "viewer"]);
  });

  it("invalidates probes before and during logout, including late replies", () => {
    const publish = vi.fn(), clear = vi.fn();
    const transition = createSessionTransition(publish, clear);
    const before = transition.beginProbe();
    const logout = transition.beginSignOut();
    const during = transition.beginProbe();
    expect(transition.acceptProbe(before, owner)).toBe(false);
    expect(transition.acceptProbe(during, owner)).toBe(false);
    transition.finishSignOut(logout);
    expect(transition.acceptProbe(during, owner)).toBe(false);
    expect(clear).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledExactlyOnceWith({ status: "out", role: null });
    const after = transition.beginProbe();
    expect(transition.acceptProbe(after, owner)).toBe(true);
  });

  it("keeps logout pending until the latest logout finishes", () => {
    const publish = vi.fn();
    const transition = createSessionTransition(publish, () => {});
    const first = transition.beginSignOut(), second = transition.beginSignOut();
    transition.finishSignOut(first);
    expect(transition.acceptProbe(transition.beginProbe(), owner)).toBe(false);
    transition.finishSignOut(second);
    expect(publish).toHaveBeenCalledExactlyOnceWith({ status: "out", role: null });
  });

  it("keeps current state when a probe is unavailable and accepts a later fresh probe", () => {
    const publish = vi.fn(), clear = vi.fn();
    const transition = createSessionTransition(publish, clear);
    expect(transition.acceptProbe(transition.beginProbe(), null)).toBe(false);
    expect(transition.acceptProbe(transition.beginProbe(), owner)).toBe(true);
    expect(publish).toHaveBeenCalledExactlyOnceWith(owner);
    expect(clear).not.toHaveBeenCalled();
  });
});
