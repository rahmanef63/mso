import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetLoginPasswordAttempts, rotateLoginPassword } from "./login-password";

const CURRENT = "current-pass";
const NEXT = "next-pass-1";
let dir: string;
let file: string;
let previous: string | undefined;

async function put(contents: string, mode = 0o600) {
  await fs.writeFile(file, contents, { mode: 0o600 });
  await fs.chmod(file, mode);
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-login-pw-"));
  file = path.join(dir, ".env.local");
  previous = process.env.OS_LOGIN_PASSWORD;
  process.env.OS_LOGIN_PASSWORD = CURRENT;
  resetLoginPasswordAttempts();
  await put(`OS_SESSION_SECRET=fixture-session-secret-long-enough\nOS_LOGIN_PASSWORD=${CURRENT}\n`);
});

afterEach(async () => {
  if (previous === undefined) delete process.env.OS_LOGIN_PASSWORD;
  else process.env.OS_LOGIN_PASSWORD = previous;
  resetLoginPasswordAttempts();
  await fs.rm(dir, { recursive: true, force: true });
});

const rotate = (patch: Partial<{ current: string; next: string; confirm: string; file: string }> = {}) =>
  rotateLoginPassword({
    current: patch.current ?? CURRENT,
    next: patch.next ?? NEXT,
    confirm: patch.confirm ?? NEXT,
    actor: "device-1",
    file: patch.file ?? file,
  });

describe("login password rotation", () => {
  it("rewrites only the login secret and keeps the running process in sync", async () => {
    await rotate();
    const text = await fs.readFile(file, "utf8");
    expect(text).toContain(`OS_LOGIN_PASSWORD=${NEXT}`);
    expect(text).toContain("OS_SESSION_SECRET=fixture-session-secret-long-enough");
    expect(text).not.toContain(CURRENT);
    expect(process.env.OS_LOGIN_PASSWORD).toBe(NEXT);
  });

  it("rejects a wrong, mismatched, weak, or unchanged password without writing", async () => {
    const before = await fs.readFile(file, "utf8");
    await expect(rotate({ current: "nope-pass" })).rejects.toMatchObject({ code: "bad_current" });
    await expect(rotate({ confirm: "other-pass" })).rejects.toMatchObject({ code: "mismatch" });
    await expect(rotate({ next: "bad pass", confirm: "bad pass" })).rejects.toMatchObject({ code: "weak_password" });
    await expect(rotate({ next: CURRENT, confirm: CURRENT })).rejects.toMatchObject({ code: "unchanged" });
    expect(await fs.readFile(file, "utf8")).toBe(before);
    expect(process.env.OS_LOGIN_PASSWORD).toBe(CURRENT);
  });

  it("does not follow a symlink or a group-readable env file", async () => {
    const link = path.join(dir, "linked.env");
    await fs.symlink(file, link);
    await expect(rotate({ file: link })).rejects.toMatchObject({ code: "password_file_unsafe" });
    await put(`OS_LOGIN_PASSWORD=${CURRENT}\n`, 0o640);
    await expect(rotate()).rejects.toMatchObject({ code: "password_file_unsafe" });
    expect(process.env.OS_LOGIN_PASSWORD).toBe(CURRENT);
  });

  it("refuses to rotate when the file is not the live password source", async () => {
    await put("OS_LOGIN_PASSWORD=someone-else\n");
    await expect(rotate()).rejects.toMatchObject({ code: "password_source_mismatch" });
    expect(await fs.readFile(file, "utf8")).toBe("OS_LOGIN_PASSWORD=someone-else\n");
  });

  it("stops guessing after five wrong passwords and never echoes the secret", async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(rotate({ current: "nope-pass" })).rejects.toMatchObject({ code: "bad_current" });
    }
    try {
      await rotate({ current: NEXT });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: "rate_limited" });
      expect(String(error)).not.toContain(NEXT);
      expect(String(error)).not.toContain(CURRENT);
    }
  });
});
