import { describe, expect, it } from "vitest";
import { fixture, runGateway } from "./mso-gateway-test-fixture";

describe("mso web routing", () => {
  it("falls back to loopback when a public origin is configured but no gateway is active", () => {
    const f = fixture();
    const out = runGateway(["web", "--print"], {
      ...f.baseEnv,
      OS_PUBLIC_ORIGIN: "https://mso.example.test",
    });
    expect(out.trim()).toBe("http://127.0.0.1:4005");
  });
});
