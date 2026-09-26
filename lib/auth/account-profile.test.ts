import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACCOUNT_PRESETS, DEFAULT_ACCOUNT_PROFILE } from "./account-profile-model";
import { AccountProfileError, readAccountProfile, writeAccountProfile } from "./account-profile";

let dir: string;
let file: string;

function dataUrl(kind: string, bytes: number[]): string {
  return `data:image/${kind};base64,${Buffer.from(bytes).toString("base64")}`;
}

const png = dataUrl("png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-account-"));
  file = path.join(dir, "account.json");
  process.env.OS_ACCOUNT_STORE = file;
});

afterEach(async () => {
  delete process.env.OS_ACCOUNT_STORE;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("account profile", () => {
  it("returns the default owner identity when no profile has been saved", async () => {
    expect(await readAccountProfile()).toEqual(DEFAULT_ACCOUNT_PROFILE);
  });

  it("saves a display name and a preset or raster icon without a password field", async () => {
    await writeAccountProfile({ name: "  Rahman  " });
    expect(await readAccountProfile()).toEqual({ name: "Rahman", icon: { type: "preset", id: "user" } });
    await writeAccountProfile({ icon: { type: "preset", id: "star" } });
    await writeAccountProfile({ icon: { type: "image", src: png } });
    const saved = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    expect(saved).toEqual({ name: "Rahman", icon: { type: "image", src: png } });
    expect(saved).not.toHaveProperty("password");
    const loose = png.replace(/=+$/, "");
    await writeAccountProfile({ icon: { type: "image", src: loose } });
    const recoded = JSON.parse(await fs.readFile(file, "utf8")) as { icon: { src: string } };
    expect(recoded.icon.src).toBe(png);
    expect(recoded.icon.src).not.toBe(loose);
    await writeAccountProfile({ name: "  José 李  " });
    expect(await readAccountProfile()).toMatchObject({ name: "José 李" });
    for (const id of ACCOUNT_PRESETS) {
      await writeAccountProfile({ icon: { type: "preset", id } });
      expect(await readAccountProfile()).toMatchObject({ icon: { type: "preset", id } });
    }
    const stat = await fs.stat(file);
    expect(stat.mode & 0o077).toBe(0);
  });

  it("rejects control characters, oversized names, and non-raster icons", async () => {
    await expect(writeAccountProfile({ name: "bad\nname" })).rejects.toMatchObject({ code: "invalid" });
    await expect(writeAccountProfile({ name: "x".repeat(41) })).rejects.toBeInstanceOf(AccountProfileError);
    await expect(writeAccountProfile({ icon: { type: "preset", id: "root" } })).rejects.toMatchObject({ code: "invalid" });
    await expect(writeAccountProfile({ icon: { type: "image", src: "data:image/svg+xml;base64,PHN2Zy8+" } })).rejects.toMatchObject({ code: "invalid" });
    expect(await readAccountProfile()).toEqual(DEFAULT_ACCOUNT_PROFILE);
  });

  it("fails closed on a corrupt profile instead of replacing it", async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, "{", "utf8");
    await expect(readAccountProfile()).rejects.toMatchObject({ code: "corrupt" });
    await expect(writeAccountProfile({ name: "Rahman" })).rejects.toMatchObject({ code: "corrupt" });
    expect(await fs.readFile(file, "utf8")).toBe("{");
  });
});
