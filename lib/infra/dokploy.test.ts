import { describe, expect, it } from "vitest";
import { upsertPublicEnvText } from "./dokploy";

describe("Dokploy public build environment editing", () => {
  it("updates one public key without disturbing neighboring environment entries", () => {
    const source = "API_SECRET=keep-private\nNEXT_PUBLIC_CONVEX_URL=https://old.example\nOTHER=value\n";
    const result = upsertPublicEnvText(source, "NEXT_PUBLIC_CONVEX_URL", "https://api.example.com");
    expect(result).toEqual({
      changed: true,
      env: "API_SECRET=keep-private\nNEXT_PUBLIC_CONVEX_URL=https://api.example.com\nOTHER=value\n",
    });
  });

  it("is idempotent and appends a missing public build variable", () => {
    expect(upsertPublicEnvText("A=1\n", "VITE_CONVEX_URL", "https://api.example.com")).toEqual({
      changed: true,
      env: "A=1\nVITE_CONVEX_URL=https://api.example.com\n",
    });
    expect(upsertPublicEnvText("VITE_CONVEX_URL=https://api.example.com\n", "VITE_CONVEX_URL", "https://api.example.com").changed).toBe(false);
  });

  it("refuses secret/server keys, multiline values, and ambiguous duplicate keys", () => {
    expect(() => upsertPublicEnvText("", "DATABASE_URL", "postgres://example")).toThrow(/only public browser/i);
    expect(() => upsertPublicEnvText("", "NEXT_PUBLIC_VALUE", "one\ntwo")).toThrow(/invalid public environment value/i);
    expect(() => upsertPublicEnvText("VITE_X=1\nVITE_X=2\n", "VITE_X", "3")).toThrow(/duplicate VITE_X/i);
  });
});
