import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createT3PairingClientUrl, validateT3PairUrl } from "./t3-pairing";

const ORIGIN = "https://t3.mso.example.com";

describe("validateT3PairUrl", () => {
  it("accepts a canonical HTTPS /pair#token=... URL on the exact managed origin", () => {
    expect(validateT3PairUrl(`${ORIGIN}/pair#token=t3_pair_token_12345`, ORIGIN)).toBe(
      `${ORIGIN}/pair#token=t3_pair_token_12345`,
    );
  });

  it("rejects query secrets, wrong paths, wrong origins, insecure schemes, and invalid tokens", () => {
    expect(validateT3PairUrl(`${ORIGIN}/pair?token=secret#token=t3_pair_token_12345`, ORIGIN)).toBeNull();
    expect(validateT3PairUrl(`${ORIGIN}/other#token=t3_pair_token_12345`, ORIGIN)).toBeNull();
    expect(validateT3PairUrl("https://evil.example.com/pair#token=t3_pair_token_12345", ORIGIN)).toBeNull();
    expect(validateT3PairUrl("http://t3.mso.example.com/pair#token=t3_pair_token_12345", "http://t3.mso.example.com")).toBeNull();
    expect(validateT3PairUrl(`${ORIGIN}/pair#token=short`, ORIGIN)).toBeNull();
    expect(validateT3PairUrl(`${ORIGIN}/pair#token=t3_pair_token_12345&extra=1`, ORIGIN)).toBeNull();
    expect(validateT3PairUrl(`${ORIGIN}/pair`, ORIGIN)).toBeNull();
  });
});

describe("createT3PairingClientUrl", () => {
  it("mints and validates a short-lived T3 pairing URL via fixed CLI arguments", async () => {
    const run = vi.fn(async () => JSON.stringify({
      id: "pair_1",
      credential: "t3_pair_token_abcdef12",
      pairUrl: `${ORIGIN}/pair#token=t3_pair_token_abcdef12`,
    }));
    const url = await createT3PairingClientUrl(ORIGIN, {
      run,
      binary: "/opt/t3/t3",
      baseDir: "/home/owner/.t3",
    });
    expect(url).toBe(`${ORIGIN}/pair#token=t3_pair_token_abcdef12`);
    expect(run).toHaveBeenCalledWith("/opt/t3/t3", [
      "auth",
      "pairing",
      "create",
      "--base-dir",
      "/home/owner/.t3",
      "--ttl",
      "10m",
      "--label",
      "MSO Web",
      "--base-url",
      ORIGIN,
      "--json",
    ]);
  });

  it("returns null gracefully when the T3 binary fails or returns an invalid URL", async () => {
    await expect(createT3PairingClientUrl(ORIGIN, {
      run: async () => { throw new Error("ENOENT"); },
    })).resolves.toBeNull();
    await expect(createT3PairingClientUrl(ORIGIN, {
      run: async () => JSON.stringify({ pairUrl: "https://evil.example.com/pair#token=t3_pair_token_abcdef12" }),
    })).resolves.toBeNull();
  });
});
