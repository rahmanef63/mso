import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NextRequest, NextResponse, parseRelativeURL } from "./next-server-shim";
import { compileRoutePattern, dispatchMsoRequest } from "./router";

describe("zero-Next Web HTTP shim & router", () => {
  it("normalizes loopback hosts on NextRequest.nextUrl and parses cookies", () => {
    const req = new NextRequest("https://127.0.0.1:4005/api/health?x=1", {
      headers: { cookie: "session=tok123; theme=dark" },
    });
    expect(req.nextUrl.origin).toBe("https://localhost:4005");
    expect(req.nextUrl.pathname).toBe("/api/health");
    expect(req.nextUrl.searchParams.get("x")).toBe("1");
    expect(req.cookies.get("session")?.value).toBe("tok123");
    expect(req.cookies.getAll("theme")).toEqual([{ name: "theme", value: "dark" }]);
  });

  it("serializes Set-Cookie headers on NextResponse.cookies", () => {
    const res = NextResponse.json({ ok: true });
    res.cookies.set("session", "abc.def", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 3600,
    });
    const header = res.headers.getSetCookie()[0];
    expect(header).toContain("session=abc.def");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=strict");
    expect(header).toContain("Max-Age=3600");
  });

  it("supports parseRelativeURL for same-origin and cross-origin URLs", () => {
    expect(parseRelativeURL("https://localhost:4005/a?b=1", "https://localhost:4005/x")).toEqual({
      url: "/a?b=1",
      isRelative: true,
    });
    expect(parseRelativeURL("http://127.0.0.1:9000/a", "https://localhost:4005/x")).toEqual({
      url: "http://127.0.0.1:9000/a",
      isRelative: false,
    });
  });

  it("compiles static, dynamic, catch-all, and optional catch-all route patterns", () => {
    const stat = compileRoutePattern("/app", "/app/api/health/route.ts");
    const dyn = compileRoutePattern("/app", "/app/api/v1/managed-apps/[id]/route.ts");
    const opt = compileRoutePattern("/app", "/app/api/v1/managed-apps/[id]/proxy/[[...path]]/route.ts");
    const catchAll = compileRoutePattern("/app", "/app/api/v1/workflows/webhook/[...hook]/route.ts");

    expect(stat.regex.exec("/api/health")).not.toBeNull();
    const dynMatch = dyn.regex.exec("/api/v1/managed-apps/n8n");
    expect(dynMatch).not.toBeNull();
    expect(dyn.extract(dynMatch!)).toEqual({ id: "n8n" });

    const optRoot = opt.regex.exec("/api/v1/managed-apps/n8n/proxy");
    expect(optRoot).not.toBeNull();
    expect(opt.extract(optRoot!)).toEqual({ id: "n8n", path: undefined });

    const optDeep = opt.regex.exec("/api/v1/managed-apps/n8n/proxy/a/b");
    expect(optDeep).not.toBeNull();
    expect(opt.extract(optDeep!)).toEqual({ id: "n8n", path: ["a", "b"] });

    const hookMatch = catchAll.regex.exec("/api/v1/workflows/webhook/run/123");
    expect(hookMatch).not.toBeNull();
    expect(catchAll.extract(hookMatch!)).toEqual({ hook: ["run", "123"] });
  });

  it("imports compiled route modules through a file: URL so Windows absolute paths work", () => {
    const nativePath = path.join(process.cwd(), "app", "api", "health", "route.ts");
    const url = new URL(pathToFileURL(nativePath).href);
    expect(url.protocol).toBe("file:");
    expect(url.href).not.toMatch(/^[a-z]:/i);
  });

  it("dispatches /api/health directly through proxy.ts and app/api/health/route.ts", async () => {
    const res = await dispatchMsoRequest(new Request("http://127.0.0.1:4005/api/health", {
      headers: { host: "127.0.0.1:4005" },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok" });
  });

  it("serves a static file in one read so there is no check-then-read race", () => {
    // js/file-system-race lock: tryServeStatic must attempt one read per candidate and skip on
    // error, not check-then-read. Existence/stat probing before the read is the vulnerability.
    const source = fs.readFileSync(new URL("./router.ts", import.meta.url), "utf8");
    expect(source).not.toContain("existsSync(");
    expect(source).not.toContain("statSync(");
  });

  it("exposes no stack-bearing String(error) in the workflow fail helpers", () => {
    // js/stack-trace-exposure lock: these routes answer with lib/host/error-message.ts barriers.
    for (const rel of [
      "../../app/api/v1/workflows/route-mutation.ts",
      "../../app/api/v1/workflows/route-read.ts",
      "../../app/api/v1/a2a/route-messages.ts",
    ]) {
      const source = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
      expect(source).not.toContain("String(error)");
    }
  });
});
