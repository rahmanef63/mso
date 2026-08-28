import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseSystemctlServices, serviceControlAllowlist, validServiceUnit } from "./services";

afterEach(() => vi.unstubAllEnvs());

describe("systemd service inventory", () => {
  it("parses stable systemctl columns and marks only exact allowlist matches controllable", () => {
    const allow = new Set(["user:mso.service"]);
    const rows = parseSystemctlServices([
      "mso.service loaded active running Manef Shell OS",
      "worker@1.service loaded failed failed Queue worker one",
      "not-a-unit.socket loaded active listening Socket",
    ].join("\n"), "user", allow);
    expect(rows).toEqual([
      {
        unit: "mso.service", scope: "user", load: "loaded", active: "active", sub: "running",
        description: "Manef Shell OS", controllable: true,
      },
      {
        unit: "worker@1.service", scope: "user", load: "loaded", active: "failed", sub: "failed",
        description: "Queue worker one", controllable: false,
      },
    ]);
  });

  it("fails malformed allowlist entries closed instead of broadening control", () => {
    vi.stubEnv("OS_SERVICE_CONTROL_UNITS", "user:mso.service,system:nginx.service,*.service,user:../bad.service");
    const parsed = serviceControlAllowlist();
    expect([...parsed.units]).toEqual(["user:mso.service", "system:nginx.service"]);
    expect(parsed.diagnostics).toHaveLength(2);
  });

  it("accepts ordinary and template units but no spaces, slash, or flags", () => {
    expect(validServiceUnit("nginx.service")).toBe(true);
    expect(validServiceUnit("worker@1.service")).toBe(true);
    for (const bad of ["../nginx.service", "nginx service", "nginx\\evil.service", "--help.service", "nginx.socket", ""]) {
      expect(validServiceUnit(bad)).toBe(false);
    }
  });
});
