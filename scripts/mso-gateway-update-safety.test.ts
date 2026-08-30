import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { GATEWAY, cleanupGatewayFixtures, fixture } from "./mso-gateway-test-fixture";

afterEach(cleanupGatewayFixtures);

describe("gateway offline-update safety assertion", () => {
  it("rejects a healthy selected MSO responder that has no gateway ownership state", () => {
    const f = fixture();
    const out = spawnSync(GATEWAY, ["runtime-assert-update-safe"], { env: f.baseEnv, encoding: "utf8" });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("active but is not gateway-owned; stop it before an offline update");
  });
});
