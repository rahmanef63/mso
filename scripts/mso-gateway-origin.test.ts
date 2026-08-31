import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { fixture, readFileSnapshot, runGateway } from "./mso-gateway-test-fixture";

describe("gateway public-origin canonicalization", () => {
  it("replaces every previous OS_PUBLIC_ORIGIN assignment with exactly one requested value", () => {
    const f = fixture();
    fs.writeFileSync(
      f.envFile,
      [
        "OS_SESSION_SECRET=fixture-only-not-a-real-secret",
        "OS_PUBLIC_ORIGIN=https://old-first.example.test",
        "KEEP_ME=1",
        "OS_PUBLIC_ORIGIN=https://old-last.example.test",
        "",
      ].join("\n"),
    );

    runGateway(["domain", "set", "https://new.example.test"], f.baseEnv);
    const snapshot = readFileSnapshot(f.envFile);
    const origins = snapshot.text.match(/^OS_PUBLIC_ORIGIN=.*$/gm) ?? [];
    expect(origins).toEqual(["OS_PUBLIC_ORIGIN=https://new.example.test"]);
    expect(snapshot.text).toContain("OS_SESSION_SECRET=fixture-only-not-a-real-secret");
    expect(snapshot.text).toContain("KEEP_ME=1");
    expect(snapshot.mode).toBe(0o600);
  });
});
