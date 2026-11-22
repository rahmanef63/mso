// MSO host password records: one connection per installation, expiry pinned to "0".
//
// These assert the RULES, not a restatement of them: the host must be a bare
// hostname so two rows cannot claim one install, and an expiry date is refused
// because nothing here rotates another host's password.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { normalizeInfraValues, getInfraProviderDefinition } = await import("./catalog");
const { INFRA_PROVIDER_IDS } = await import("./types");

describe("mso-password", () => {
  it("is a registered provider with a masked password and a visible expiry", () => {
    expect(INFRA_PROVIDER_IDS).toContain("mso-password");
    const fields = getInfraProviderDefinition("mso-password").fields;
    expect(fields.map((f) => f.key)).toEqual(["host", "password", "expiresAt"]);
    // The password is the only secret; host and expiry are readable facts.
    expect(fields.filter((f) => f.secret).map((f) => f.key)).toEqual(["password"]);
  });

  it("normalises the host to a bare lowercase hostname", () => {
    expect(normalizeInfraValues("mso-password", {
      host: "  MSO.Example.COM ", password: "x", expiresAt: "0",
    }).host).toBe("mso.example.com");
  });

  it.each([
    "https://mso.example.com",
    "mso.example.com/",
    "mso.example.com:4005",
    "mso example.com",
    "-leading.example.com",
  ])("refuses %s as a host, so one install cannot be claimed twice", (host) => {
    expect(() => normalizeInfraValues("mso-password", { host, password: "x", expiresAt: "0" }))
      .toThrow(/bare hostname/);
  });

  it("accepts 0 as never, and refuses any real expiry date", () => {
    expect(normalizeInfraValues("mso-password", {
      host: "mso.a.test", password: "x", expiresAt: "0",
    }).expiresAt).toBe("0");
    for (const bad of ["2027-01-01", "1", "never", "-1"]) {
      expect(() => normalizeInfraValues("mso-password", {
        host: "mso.a.test", password: "x", expiresAt: bad,
      })).toThrow(/must be "0"/);
    }
  });

  it("keeps the password out of the summary every read path returns", async () => {
    const { summarizeInfraProvider } = await import("./store");
    const secret = "correct-horse-battery-staple";
    const summary = summarizeInfraProvider("mso-password", {
      host: "mso.a.test", password: secret, expiresAt: "0",
    });
    expect(summary.configured).toBe(true);
    expect(summary.values.host).toBe("mso.a.test");
    expect(summary.values.password).not.toBe(secret);
    expect(JSON.stringify(summary)).not.toContain(secret);
  });

  it("does not call the other installation's login endpoint when verified", async () => {
    const { doctorAdditionalProvider } = await import("./additional-doctor");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    // null = "not configured for verification", the honest answer: MSO did not and
    // cannot check another host's password without burning its login rate limit.
    expect(await doctorAdditionalProvider("mso-password", {
      host: "mso.a.test", password: "x", expiresAt: "0",
    })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
