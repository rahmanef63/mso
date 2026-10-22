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

  it("stores library icons from the picker and rejects anything outside the allowlist", async () => {
    const accepted = [
      "emoji:🦊",
      "emoji:👨‍👩‍👧",
      "lucide:Star",
      "lucide:FileText",
      "phosphor:ShieldCheck?c=0b6e99",
      "emoji:🎯?c=F59E0B",
    ];
    for (const value of accepted) {
      await writeAccountProfile({ icon: { type: "library", value } });
      expect(await readAccountProfile()).toMatchObject({ icon: { type: "library", value } });
    }
    // Old stores still load: preset and image icons keep working beside it.
    await writeAccountProfile({ icon: { type: "preset", id: "leaf" } });
    expect(await readAccountProfile()).toMatchObject({ icon: { type: "preset", id: "leaf" } });
    await writeAccountProfile({ icon: { type: "image", src: png } });
    expect(await readAccountProfile()).toMatchObject({ icon: { type: "image", src: png } });

    const rejected = [
      "lucide:__proto__",
      "lucide:Star?c=12345",
      "lucide:Star?c=0b6e99&x=1",
      "lucide:../etc/passwd",
      "phosphor:<script>",
      "emoji:",
      "emoji:two words",
      "javascript:alert(1)",
      "lucide:Star?c=0b6e99\n",
      "x".repeat(97),
    ];
    for (const value of rejected) {
      await expect(writeAccountProfile({ icon: { type: "library", value } })).rejects.toMatchObject({ code: "invalid" });
    }
    const before = await readAccountProfile();
    await expect(writeAccountProfile({ icon: { type: "library", value: { $ne: null } } })).rejects.toMatchObject({ code: "invalid" });
    expect(await readAccountProfile()).toEqual(before);
  });

  it("rebuilds the stored icon from validated primitives so client bytes never reach the file unchanged", async () => {
    // Same 16 decoded bytes, but the last base64 digit carries non-zero unused
    // bits: a legal encoding that is NOT the canonical one. The store must hold
    // the re-encoded value, never the request string.
    const canonicalB64 = png.split(",")[1]!;
    const nonCanonicalB64 = `${canonicalB64.slice(0, 21)}B==`;
    expect(nonCanonicalB64).not.toBe(canonicalB64);
    expect(Buffer.from(nonCanonicalB64, "base64").equals(Buffer.from(canonicalB64, "base64"))).toBe(true);
    const nonCanonicalUrl = `data:image/png;base64,${nonCanonicalB64}`;
    await writeAccountProfile({ icon: { type: "image", src: nonCanonicalUrl } });
    const raw = await fs.readFile(file, "utf8");
    expect(raw).not.toContain(nonCanonicalUrl);
    expect(JSON.parse(raw)).toEqual({ name: "Owner", icon: { type: "image", src: png } });
    // A declared kind that contradicts the validated magic is refused outright and
    // leaves the previously published store untouched.
    const mismatched = dataUrl("gif", [...Buffer.from(canonicalB64, "base64")]);
    await expect(writeAccountProfile({ icon: { type: "image", src: mismatched } })).rejects.toMatchObject({ code: "invalid" });
    expect(await fs.readFile(file, "utf8")).toBe(raw);
  });

  it("parses a store file written before the library icon type existed", async () => {
    // Byte-for-byte shape produced by the first release (preset icon only).
    await fs.mkdir(dir, { recursive: true });
    const legacy = JSON.stringify({ name: "Legacy Owner", icon: { type: "preset", id: "star" } });
    await fs.writeFile(file, legacy, { encoding: "utf8", mode: 0o600 });
    expect(await readAccountProfile()).toEqual({ name: "Legacy Owner", icon: { type: "preset", id: "star" } });
    // A pre-library image store also still loads.
    await fs.writeFile(file, JSON.stringify({ name: "Legacy Owner", icon: { type: "image", src: png } }), { encoding: "utf8", mode: 0o600 });
    expect(await readAccountProfile()).toEqual({ name: "Legacy Owner", icon: { type: "image", src: png } });
    expect(await fs.readFile(file, "utf8")).toContain('"type":"image"');
  });

  it("fails closed on a corrupt profile instead of replacing it", async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, "{", "utf8");
    await expect(readAccountProfile()).rejects.toMatchObject({ code: "corrupt" });
    await expect(writeAccountProfile({ name: "Rahman" })).rejects.toMatchObject({ code: "corrupt" });
    expect(await fs.readFile(file, "utf8")).toBe("{");
  });

  it("stages through an unpredictable exclusive temp file and publishes mode 0600", async () => {
    // Predictable staging path (the old `${file}.${pid}.tmp`) is pre-planted as a
    // canary: the write must never truncate it and must never follow it.
    const legacyTmp = `${file}.${process.pid}.tmp`;
    const canary = "planted-by-someone-else";
    await fs.writeFile(legacyTmp, canary, { encoding: "utf8", mode: 0o600 });
    await writeAccountProfile({ name: "Rahman" });
    expect(await fs.readFile(legacyTmp, "utf8")).toBe(canary);
    expect(await readAccountProfile()).toMatchObject({ name: "Rahman" });
    // One open handle carries both the mode assertion and the content read, so
    // the test never stats a path and then reads that path again.
    const handle = await fs.open(file, "r");
    let published: string;
    try {
      expect((await handle.stat()).mode & 0o777).toBe(0o600);
      published = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
    expect(published).not.toBe(canary);
    expect(JSON.parse(published)).toMatchObject({ name: "Rahman" });
    // No staging leftovers: the only sibling is the pre-planted canary.
    expect((await fs.readdir(dir)).sort()).toEqual(["account.json", `${path.basename(file)}.${process.pid}.tmp`]);
  });

  it("serializes concurrent writes so the store is never torn", async () => {
    await writeAccountProfile({ name: "First" });
    const results = await Promise.all([
      writeAccountProfile({ name: "Second", icon: { type: "preset", id: "star" } }),
      writeAccountProfile({ name: "Third", icon: { type: "preset", id: "leaf" } }),
    ]);
    expect(results).toHaveLength(2);
    const onDisk = JSON.parse(await fs.readFile(file, "utf8")) as { name: string; icon: unknown };
    const valid = [
      { name: "Second", icon: { type: "preset", id: "star" } },
      { name: "Third", icon: { type: "preset", id: "leaf" } },
    ];
    expect(valid).toContainEqual(onDisk);
    expect(await readAccountProfile()).toEqual(onDisk);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    // Every concurrent write published atomically: no temp siblings survive.
    expect((await fs.readdir(dir)).sort()).toEqual(["account.json"]);
  });
});
