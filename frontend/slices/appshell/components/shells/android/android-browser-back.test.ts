import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Android real-phone navigation contract", () => {
  it("uses browser Back on real phones and only renders fake system nav in PhoneFrame", () => {
    const src = readFileSync(new URL("./android-shell.tsx", import.meta.url), "utf8");
    expect(src).toContain("useAndroidBrowserBack(!showSystemNav, browserLayer)");
    expect(src).toContain("showSystemNav && <NavBar");
    expect(src).toContain('"--android-nav": showSystemNav ? "48px" : "0px"');
  });
});
