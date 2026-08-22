import { afterEach, describe, expect, it, vi } from "vitest";
import { projectIngressDecision, projectIngressRoutes } from "./project-ingress";

const route = JSON.stringify([{
  app: "hermes",
  method: "POST",
  path: "/webhooks/project-example",
  target: "http://127.0.0.1:8644/webhooks/project-example",
  auth: "hmac-v2-json",
  maxBodyBytes: 262144,
}]);

function request(path: string, headers: Record<string, string> = {}) {
  return new Request(`https://hermes.mso.example${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-webhook-signature-v2": "a".repeat(64),
      ...headers,
    },
    body: "{}",
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("opt-in project ingress", () => {
  it("does nothing by default", () => {
    vi.stubEnv("OS_PROJECT_INGRESS_ROUTES", "");
    expect(projectIngressRoutes()).toEqual([]);
    expect(projectIngressDecision(request("/webhooks/project-example"), "hermes", "/webhooks/project-example")).toEqual({ matched: false });
  });

  it("matches only an explicitly configured exact app/method/path", () => {
    const decision = projectIngressDecision(request("/webhooks/project-example"), "hermes", "/webhooks/project-example", route);
    expect(decision).toEqual({ matched: true, target: "http://127.0.0.1:8644/webhooks/project-example" });
    expect(projectIngressDecision(request("/webhooks/other"), "hermes", "/webhooks/other", route)).toEqual({ matched: false });
    expect(projectIngressDecision(request("/webhooks/project-example"), "openclaw", "/webhooks/project-example", route)).toEqual({ matched: false });
  });

  it("rejects stale/malformed auth-shaped traffic before loopback", () => {
    expect(projectIngressDecision(request("/webhooks/project-example", { "x-webhook-signature-v2": "bad" }), "hermes", "/webhooks/project-example", route)).toEqual({ matched: true });
    expect(projectIngressDecision(request("/webhooks/project-example", { "x-webhook-timestamp": String(Math.floor(Date.now() / 1000) - 301) }), "hermes", "/webhooks/project-example", route)).toEqual({ matched: true });
  });

  it("fails closed on off-box, wildcard, duplicate or malformed config", () => {
    for (const raw of [
      JSON.stringify([{ app: "hermes", method: "POST", path: "/x", target: "https://evil.example/x", auth: "hmac-v2-json" }]),
      JSON.stringify([{ app: "hermes", method: "POST", path: "/webhooks/*", target: "http://127.0.0.1:8644/x", auth: "hmac-v2-json" }]),
      JSON.stringify([
        { app: "hermes", method: "POST", path: "/x", target: "http://127.0.0.1:8644/x", auth: "hmac-v2-json" },
        { app: "hermes", method: "POST", path: "/x", target: "http://127.0.0.1:8645/x", auth: "hmac-v2-json" },
      ]),
      "not-json",
    ]) expect(projectIngressRoutes(raw)).toEqual([]);
  });
});
