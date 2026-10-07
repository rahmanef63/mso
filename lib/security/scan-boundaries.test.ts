import { afterEach, describe, expect, it, vi } from "vitest";
import { isCredentialPath, looseCredentialExcludes } from "@/lib/host/path-credentials";
import { assertA2AUrl } from "@/lib/a2a/network";
import { projectIngressDecision } from "@/lib/managed-apps/project-ingress";

afterEach(() => vi.unstubAllEnvs());
describe("security scan boundary regressions", () => {
  it.each([".env", ".env.local", ".env.production", ".env.backup"])("denies project %s independently of the running checkout", (name) => {
    expect(isCredentialPath(`/srv/projects/fixture/${name}`)).toBe(true);
  });
  it("keeps the public environment example readable", () => {
    expect(isCredentialPath("/srv/projects/fixture/.env.example")).toBe(false);
  });
  it("enforces the dotenv boundary in recursive archives too", () => {
    expect(looseCredentialExcludes()).toEqual(expect.arrayContaining([".env*", "*/.env*"]));
  });
  it("requires explicit owner opt-in for loopback A2A discovery", () => {
    vi.stubEnv("OS_A2A_ALLOW_LOOPBACK", "");
    expect(() => assertA2AUrl("http://127.0.0.1:4555/card")).toThrow(/disabled/);
  });
  it.each([{}, { "transfer-encoding": "chunked", "content-length": "2" }])("does not forward unbounded project ingress", (extra) => {
    const routes = JSON.stringify([{app: "hermes", method: "POST", path: "/webhook", target: "http://127.0.0.1:8644/webhook", auth: "hmac-v2-json"}]);
    const req = new Request("https://hermes.example/webhook", {method: "POST", body: "{}", headers: {
      "content-type": "application/json", "x-webhook-timestamp": String(Math.floor(Date.now()/1000)),
      "x-webhook-signature-v2": "a".repeat(64), ...extra,
    }});
    expect(projectIngressDecision(req, "hermes", "/webhook", routes)).toEqual({matched: true});
  });
});
