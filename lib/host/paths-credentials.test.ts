import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
assertNoCredentialDescendants,
assertNoSensitiveDescendants,
isCredentialPath,
isSensitivePath,
looseCredentialExcludes,
sensitiveExcludes
} from "./paths";

// The per-path credential gate is exact-or-under, so a PARENT of a denied entry
// matches nothing — and the two recursive callers (`zip -r`, `fs.cp {recursive}`)
// walk right past the gate into the children. zip NARROWS (excludes), copy/move
// REFUSE: a filtered move would cp-then-rm the skipped file, and a completed one
// relocates credentials somewhere the read API no longer denies.
//
// HOME is stubbed to a temp tree so the assertions don't depend on which dotfiles
// happen to exist on the box running the suite.
let base = "";
let fakeHome = "";
let parent = ""; // ~/.local/share — denied by neither itself nor its parent

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "mso-cred-")));
  fakeHome = path.join(base, "home");
  parent = path.join(fakeHome, ".local", "share");
  mkdirSync(path.join(parent, "keyrings"), { recursive: true });
  mkdirSync(path.join(fakeHome, ".ssh"), { recursive: true });
  mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
  mkdirSync(path.join(fakeHome, "safe"), { recursive: true });
});

afterAll(() => rmSync(base, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

describe("recursive credential guard", () => {
  it("blocks the agent credential stores added to the denylist", () => {
    vi.stubEnv("HOME", fakeHome);
    expect(isSensitivePath(path.join(fakeHome, ".codex"))).toBe(true);
    expect(isSensitivePath(path.join(fakeHome, ".codex", "auth.json"))).toBe(true);
  });

  it("blocks the shell rc + profile files, because that is where CLI tokens live", () => {
    // Found by audit, not by theory: the box this was written on had eight
    // `export …_TOKEN=` lines in ~/.bashrc, put there by tooling that says "add
    // this to your shell profile". Shell HISTORY was already denied; the file that
    // defines the environment is the richer target.
    vi.stubEnv("HOME", fakeHome);
    for (const name of [".bashrc", ".zshrc", ".profile", ".bash_profile", ".zshenv"]) {
      expect(isSensitivePath(path.join(fakeHome, name)), name).toBe(true);
    }
    expect(isSensitivePath(path.join(fakeHome, ".config", "fish", "config.fish"))).toBe(true);
    // Still a denylist, not a ban on dotfiles: an rc file for something that holds
    // no credentials stays readable.
    expect(isSensitivePath(path.join(fakeHome, ".vimrc"))).toBe(false);
    expect(isSensitivePath(path.join(fakeHome, ".gitconfig"))).toBe(false);
  });

  it("blocks loose private-key basenames anywhere under a legal root", () => {
    vi.stubEnv("HOME", fakeHome);
    for (const name of ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa", "deploy.pem", "DEPLOY.PEM"]) {
      expect(isCredentialPath(path.join(fakeHome, "safe", "nested", name)), name).toBe(true);
    }
    expect(isCredentialPath(path.join(fakeHome, "safe", "nested", "id_rsa.pub"))).toBe(false);
    expect(looseCredentialExcludes()).toEqual(expect.arrayContaining(["*.pem", "id_rsa", "*/id_rsa"]));
  });

  it("excludes a credential dir nested under the zip base", () => {
    vi.stubEnv("HOME", fakeHome);
    expect(isSensitivePath(parent)).toBe(false); // the exact gap this guard closes
    expect(sensitiveExcludes(parent)).toEqual(expect.arrayContaining(["keyrings", "keyrings/*"]));
    expect(sensitiveExcludes(fakeHome)).toEqual(expect.arrayContaining([".ssh", ".ssh/*"]));
    expect(sensitiveExcludes(path.join(fakeHome, "safe"))).toEqual([]);
  });

  it("refuses to copy/move a parent of a credential dir, allows an unrelated one", () => {
    vi.stubEnv("HOME", fakeHome);
    expect(() => assertNoSensitiveDescendants(parent)).toThrow(/credential/i);
    expect(() => assertNoSensitiveDescendants(path.join(fakeHome, "safe"))).not.toThrow();
  });

  it("recursively rejects loose private keys and PEM files at arbitrary depth", async () => {
    vi.stubEnv("HOME", fakeHome);
    const tree = path.join(fakeHome, "safe", "recursive-credentials");
    const nested = path.join(tree, "a", "b");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, "id_ed25519"), "synthetic");
    await expect(assertNoCredentialDescendants(tree)).rejects.toThrow(/id_ed25519/);
    rmSync(path.join(nested, "id_ed25519"));
    writeFileSync(path.join(nested, "deploy.PEM"), "synthetic");
    await expect(assertNoCredentialDescendants(tree)).rejects.toThrow(/deploy\.PEM/i);
    rmSync(tree, { recursive: true, force: true });
  });

  it("does not follow descendant symlinks while inspecting a recursive source", async () => {
    vi.stubEnv("HOME", fakeHome);
    const tree = path.join(fakeHome, "safe", "symlink-tree");
    const outside = path.join(base, "outside-credential-dir");
    mkdirSync(tree, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, "id_rsa"), "synthetic");
    symlinkSync(outside, path.join(tree, "external"));
    await expect(assertNoCredentialDescendants(tree)).resolves.toBeUndefined();
    rmSync(tree, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("honours the OS_FS_ALLOW_SENSITIVE escape hatch", () => {
    vi.stubEnv("HOME", fakeHome);
    vi.stubEnv("OS_FS_ALLOW_SENSITIVE", "1");
    expect(sensitiveExcludes(fakeHome)).toEqual([]);
    expect(looseCredentialExcludes()).toEqual(["*.pem"]);
    expect(isCredentialPath(path.join(fakeHome, "safe", "id_rsa"))).toBe(false);
    expect(isCredentialPath(path.join(fakeHome, "safe", "deploy.pem"))).toBe(true);
    expect(() => assertNoSensitiveDescendants(parent)).not.toThrow();
  });
});
