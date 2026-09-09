import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the audit module BEFORE importing the SUT — instrumentation.ts dynamic-
// imports "./lib/host/audit", so we need the spec to match.
const auditMock = vi.fn<(entry: unknown) => Promise<void>>(async () => {});
vi.mock("./lib/host/audit", () => ({ audit: (e: unknown) => auditMock(e) }));

import { onRequestError } from "./instrumentation";

beforeEach(() => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  auditMock.mockReset();
  auditMock.mockResolvedValue(undefined);
});

describe("onRequestError", () => {
  it("does not load the filesystem audit channel in Edge", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await onRequestError!(new Error("edge"), { path: "/x" } as never, {} as never);
    expect(auditMock).not.toHaveBeenCalled();
  });
  it("routes a framework error into the audit channel", async () => {
    const err = new Error("boom");
    await onRequestError!(
      err,
      { path: "/x", method: "GET", headers: {} } as never,
      { routerKind: "App Router", routeType: "route", routePath: "/x" } as never,
    );
    expect(auditMock).toHaveBeenCalledTimes(1);
    const entry = auditMock.mock.calls[0]![0] as {
      action: string;
      ok: boolean;
      target: string;
      detail: string;
    };
    expect(entry.action).toBe("framework.error");
    expect(entry.ok).toBe(false);
    expect(entry.target).toContain("/x");
    expect(entry.detail).toContain("boom");
  });

  it("never throws when audit fails", async () => {
    auditMock.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      onRequestError!(
        new Error("x"),
        { path: "/y", method: "GET", headers: {} } as never,
        { routerKind: "App Router", routeType: "route", routePath: "/y" } as never,
      ),
    ).resolves.toBeUndefined();
  });
});
