import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRootEnv } from "./path-roots";

describe("native filesystem root configuration", () => {
  it("does not split Windows drive letters when parsing semicolon-separated roots", () => {
    expect(parseRootEnv(String.raw`C:\Users\Alice;D:\Work`, path.win32.delimiter)).toEqual([
      String.raw`C:\Users\Alice`, String.raw`D:\Work`,
    ]);
  });

  it("keeps the Linux/macOS colon-separated contract", () => {
    expect(parseRootEnv("/home/a:/srv/project", path.posix.delimiter)).toEqual(["/home/a", "/srv/project"]);
  });
});
