import { describe, expect, it } from "vitest";
import { requiredRoleForRequest } from "./server";

const req = (method: string, path: string) => new Request(`https://mso.example${path}`, { method });

describe("host API role policy", () => {
  it("allows only explicit viewer reads and fails every unknown route up to owner", () => {
    for (const path of [
      "/api/v1/fs/list",
      "/api/v1/apps",
      "/api/v1/stock/search",
      "/api/v1/sys/stats",
      "/api/v1/sys/processes",
      "/api/v1/temp-share/abc",
    ]) expect(requiredRoleForRequest(req("GET", path)), path).toBe("viewer");
    expect(requiredRoleForRequest(req("GET", "/api/v1/future-feature"))).toBe("owner");
    expect(requiredRoleForRequest(req("GET", "/api/v1/sys/stats-private"))).toBe("owner");
    expect(requiredRoleForRequest(req("GET", "/api/v1/sys/services-private"))).toBe("owner");
    expect(requiredRoleForRequest(req("POST", "/api/v1/future-feature"))).toBe("owner");
    expect(requiredRoleForRequest(req("DELETE", "/api/v1/fs/delete"))).toBe("owner");
  });

  it("keeps shells, audit, cleanup and self-update owner-only on every verb", () => {
    for (const path of [
      "/api/v1/exec/run",
      "/api/v1/editor/exec",
      "/api/v1/term/stream",
      "/api/v1/sys/audit",
      "/api/v1/sys/cleanup",
      "/api/v1/sys/update",
    ]) expect(requiredRoleForRequest(req("GET", path))).toBe("owner");
  });

  it("gives operators only the bounded operational surfaces", () => {
    expect(requiredRoleForRequest(req("GET", "/api/v1/camoufox/service"))).toBe("operator");
    expect(requiredRoleForRequest(req("POST", "/api/v1/managed-apps/openclaw"))).toBe("operator");
    expect(requiredRoleForRequest(req("GET", "/api/v1/managed-apps/openclaw/logs"))).toBe("operator");
    expect(requiredRoleForRequest(req("GET", `/api/v1/managed-apps/openclaw/jobs/${"a".repeat(24)}`))).toBe("operator");
    expect(requiredRoleForRequest(req("DELETE", `/api/v1/managed-apps/openclaw/jobs/${"a".repeat(24)}`))).toBe("owner");
    expect(requiredRoleForRequest(req("DELETE", "/api/v1/managed-apps/openclaw/jobs/not-a-job-id"))).toBe("operator");
    expect(requiredRoleForRequest(req("POST", "/api/v1/managed-apps/openclaw/update"))).toBe("owner");
    expect(requiredRoleForRequest(req("POST", "/api/v1/managed-apps/openclaw/install"))).toBe("owner");
  });

  it("treats service inventory and package visibility as reads, actions/logs as operator", () => {
    expect(requiredRoleForRequest(req("GET", "/api/v1/sys/services"))).toBe("viewer");
    expect(requiredRoleForRequest(req("POST", "/api/v1/sys/services"))).toBe("operator");
    expect(requiredRoleForRequest(req("GET", "/api/v1/sys/services/logs"))).toBe("operator");
    expect(requiredRoleForRequest(req("GET", "/api/v1/sys/packages"))).toBe("viewer");
  });
});
