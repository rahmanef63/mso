import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import os from "node:os";
import path from "node:path";
import { defaultOrcaManagedRoot, resolveOrcaManagedRoot } from "./orca-private-fs";

const INVALID = { ok: false, reason: "managed_root_invalid" } as const;

describe("orca root tracing and personal profile denial", () => {
  const customHome = "/home/operator";

  it("resolves default managed root under home without referencing personal profile", () => {
    const def = defaultOrcaManagedRoot(customHome);
    expect(def).toBe(path.join(customHome, ".local", "share", "mso", "orca"));
    expect(resolveOrcaManagedRoot({}, customHome)).toEqual({
      ok: true,
      root: path.join(customHome, ".local", "share", "mso", "orca"),
    });
  });

  it("accepts a normal canonical absolute ORCA_HOME", () => {
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "/opt/mso/orca" }, customHome)).toEqual({
      ok: true,
      root: "/opt/mso/orca",
    });
  });

  it("denies personal .orca and .orca-remote exactly and all descendant paths", () => {
    const personalOrca = path.join(customHome, ".orca");
    const personalRemote = path.join(customHome, ".orca-remote");

    expect(resolveOrcaManagedRoot({ ORCA_HOME: personalOrca }, customHome)).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: path.join(personalOrca, "profiles") }, customHome)).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: path.join(personalOrca, "deep", "nested", "state") }, customHome)).toEqual(INVALID);

    expect(resolveOrcaManagedRoot({ ORCA_HOME: personalRemote }, customHome)).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: path.join(personalRemote, "config") }, customHome)).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: path.join(personalRemote, "deep", "nested", "state") }, customHome)).toEqual(INVALID);
  });

  it("denies home itself and filesystem root", () => {
    expect(resolveOrcaManagedRoot({ ORCA_HOME: customHome }, customHome)).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "/" }, customHome)).toEqual(INVALID);
  });

  it("denies dirty, relative, traversal, and NUL/control character inputs", () => {
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "/opt/mso/orca/" }, customHome)).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "/opt//mso/orca" }, customHome)).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "/opt/mso/../orca" }, customHome)).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "relative/path" }, customHome)).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "" }, customHome)).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "   " }, customHome)).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "/opt/mso\0orca" }, customHome)).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "/opt/mso\norca" }, customHome)).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "/opt/mso\rorca" }, customHome)).toEqual(INVALID);
  });

  it("preserves identical denial behavior with default os.homedir()", () => {
    const defHome = os.homedir();
    expect(resolveOrcaManagedRoot({ ORCA_HOME: path.join(defHome, ".orca") })).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: path.join(defHome, ".orca", "child") })).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: path.join(defHome, ".orca-remote") })).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: path.join(defHome, ".orca-remote", "child") })).toEqual(INVALID);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: defHome })).toEqual(INVALID);
  });
});
