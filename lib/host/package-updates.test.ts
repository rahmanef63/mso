import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseAptUpdates, parsePacmanUpdates, parseRpmUpdates, parseZypperUpdates } from "./package-updates";

describe("package update parsers", () => {
  it("parses apt cache output", () => {
    expect(parseAptUpdates("Listing... Done\nopenssl/jammy-updates 3.0.2-1ubuntu1.18 amd64 [upgradable from: 3.0.2-1ubuntu1]\n"))
      .toEqual([{ name: "openssl", candidate: "3.0.2-1ubuntu1.18", architecture: "amd64", current: "3.0.2-1ubuntu1" }]);
  });

  it("parses rpm, pacman, and zypper output without repository text becoming a package", () => {
    expect(parseRpmUpdates("Last metadata expiration check: 0:01 ago\nopenssl.x86_64 3.2.2 updates\n"))
      .toEqual([{ name: "openssl", architecture: "x86_64", candidate: "3.2.2" }]);
    expect(parsePacmanUpdates("curl 8.1.0-1 -> 8.2.0-1\n"))
      .toEqual([{ name: "curl", current: "8.1.0-1", candidate: "8.2.0-1" }]);
    expect(parseZypperUpdates("v | Name | Current Version | Available Version | Arch\n--+------+-----------------+-------------------+-----\nv | git | 2.40 | 2.41 | x86_64\n"))
      .toEqual([{ name: "git", current: "2.40", candidate: "2.41", architecture: "x86_64" }]);
  });
});
