import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { homeDir, parseRootEnv, readRootList } from "./path-roots";
afterEach(() => vi.unstubAllEnvs());

describe("native filesystem root configuration", () => {
  it("defaults reads to the checkout and projects instead of the entire home", () => {
    vi.stubEnv("OS_FS_READ_ROOTS", undefined);
    expect(readRootList()).toEqual([process.cwd(), path.join(homeDir(), "projects")]);
    expect(readRootList()).not.toContain(homeDir());
  });
  it("does not split Windows drive letters when parsing semicolon-separated roots", () => {
    expect(parseRootEnv(String.raw`C:\Users\Alice;D:\Work`, path.win32.delimiter)).toEqual([
      String.raw`C:\Users\Alice`, String.raw`D:\Work`,
    ]);
  });

  it("keeps the Linux/macOS colon-separated contract", () => {
    expect(parseRootEnv("/home/a:/srv/project", path.posix.delimiter)).toEqual(["/home/a", "/srv/project"]);
  });
});
