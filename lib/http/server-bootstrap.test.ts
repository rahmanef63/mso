import { beforeEach, describe, expect, it, vi } from "vitest";

const auditMock = vi.fn<(entry: unknown) => Promise<void>>(async () => {});
vi.mock("../host/audit", () => ({ audit: (e: unknown) => auditMock(e) }));

import { onRequestError } from "./server-bootstrap";

beforeEach(() => {
  auditMock.mockReset();
  auditMock.mockResolvedValue(undefined);
});

describe("onRequestError", () => {
  it("routes a server error into the audit channel", async () => {
    const err = new Error("boom");
    await onRequestError(
      err,
      { path: "/x", method: "GET", headers: {} },
      { routerKind: "MSO HTTP Router", routeType: "route", routePath: "/x" },
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
      onRequestError(
        new Error("x"),
        { path: "/y", method: "GET", headers: {} },
        { routerKind: "MSO HTTP Router", routeType: "route", routePath: "/y" },
      ),
    ).resolves.toBeUndefined();
  });
});
