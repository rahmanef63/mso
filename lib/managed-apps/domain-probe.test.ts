import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagedDomainConfig } from "@/lib/contracts/managed-domains";
import { probeLocalManagedDomain, probePublicManagedDomain } from "./domain-probe";

const hostname = "9router.mso.example.com";
const config = { localOrigin: "http://127.0.0.1:4005" } as ManagedDomainConfig;
const bootstrap = (marker = "9router", type = "application/javascript; charset=utf-8", status = 200) => new Response("bootstrap", {
  status, headers: { "x-mso-managed-app": marker, "content-type": type },
});
const anonymous = (status = 401, marker = "9router") => new Response("unauthorized", {
  status, headers: { "x-mso-managed-app": marker },
});
afterEach(() => vi.unstubAllGlobals());

describe("managed-domain route verification", () => {
  it("probes both local routes with the desired app Host and without session credentials", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(bootstrap()).mockResolvedValueOnce(anonymous());
    vi.stubGlobal("fetch", fetcher);
    await probeLocalManagedDomain(config, hostname, "9router");
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:4005/__mso_app_bootstrap.js", "http://127.0.0.1:4005/dashboard",
    ]);
    for (const [, options] of fetcher.mock.calls) {
      expect(options).toMatchObject({ headers: { host: hostname }, redirect: "error", cache: "no-store" });
      expect(Object.keys(options.headers)).toEqual(["host"]);
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("verifies public HTTPS using the actual hostname without overriding Host", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(bootstrap()).mockResolvedValueOnce(anonymous());
    vi.stubGlobal("fetch", fetcher);
    await probePublicManagedDomain(hostname, "9router");
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      `https://${hostname}/__mso_app_bootstrap.js`, `https://${hostname}/dashboard`,
    ]);
    expect(fetcher.mock.calls.every(([, options]) => options.headers === undefined && options.redirect === "error")).toBe(true);
  });

  it.each([
    ["hermes", "application/javascript", 200],
    ["", "application/javascript", 200],
    ["9router", "text/html", 200],
    ["9router", "application/javascript", 404],
  ] as const)("rejects a bootstrap response for the wrong route (%s, %s, %s)", async (marker, type, status) => {
    const fetcher = vi.fn().mockResolvedValueOnce(bootstrap(marker, type, status));
    vi.stubGlobal("fetch", fetcher);
    await expect(probeLocalManagedDomain(config, hostname, "9router")).rejects.toThrow(/routing is not active/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([[200, "9router"], [403, "9router"], [401, "hermes"], [401, ""]] as const)(
    "refuses readiness without the selected app's anonymous 401 (%s, %s)", async (status, marker) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(bootstrap()).mockResolvedValueOnce(anonymous(status, marker)));
      await expect(probePublicManagedDomain(hostname, "9router")).rejects.toThrow(/anonymous application access is not rejected/);
    },
  );

  it("reports an exact-host HTTPS failure as pending with a retry instruction", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("certificate hostname mismatch")));
    await expect(probePublicManagedDomain(hostname, "9router")).rejects.toThrow(`HTTPS/auth verification pending for ${hostname}`);
    await expect(probePublicManagedDomain(hostname, "9router")).rejects.toThrow(/certificate covering this exact hostname; retry mso domain ensure 9router --apply/);
  });

  it("rejects unsafe targets before issuing any request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(probeLocalManagedDomain({ ...config, localOrigin: "http://192.168.1.20:4005" }, hostname, "9router")).rejects.toThrow();
    await expect(probePublicManagedDomain("9router.example.com@localhost", "9router")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
