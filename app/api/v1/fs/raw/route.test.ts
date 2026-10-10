import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, open, rm, writeFile, type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
let actor = "viewer";
const handles: FileHandle[] = [], responses: Response[] = [];
vi.mock("@/lib/agent/server", () => ({ verifyAuth: async () => true }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: async () => actor }));
vi.mock("@/lib/host/fs-api", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/host/fs-api")>();
  return { ...original, statReadable: async (name: string) => {
    const info = await original.statReadable(name); handles.push(info.handle); return info;
  } };
});
import { GET } from "./route";
let root: string, small: string, large: string;
beforeEach(async () => {
  actor = "viewer"; handles.length = 0; responses.length = 0;
  root = await mkdtemp(path.join(os.tmpdir(), "mso-raw-bounds-"));
  vi.stubEnv("OS_FS_READ_ROOTS", root);
  small = path.join(root, "small.txt"); large = path.join(root, "large.mp4");
  await writeFile(small, "abcdef");
  const handle = await open(large, "w"); await handle.truncate(40 * 1024 * 1024); await handle.close();
});
afterEach(async () => {
  for (const response of responses) await response.body?.cancel().catch(() => undefined);
  vi.useRealTimers();
  await vi.waitFor(async () => { for (const handle of handles) await expect(handle.stat()).rejects.toThrow(); });
  vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true });
});
async function get(name = small, range?: string, signal?: AbortSignal) {
  const response = await GET(new Request(`http://localhost/api/v1/fs/raw?path=${encodeURIComponent(name)}`, { headers: range ? { range } : {}, signal }));
  responses.push(response); return response;
}
describe("bounded Viewer raw file responses", () => {
  it("closes empty-file descriptors before returning an empty body", async () => {
    await writeFile(small, "");
    const response = await get();
    expect(response.status).toBe(200); expect(response.headers.get("content-length")).toBe("0");
    await expect(handles[0].stat()).rejects.toThrow();
    await writeFile(small, "later");
    expect(await response.text()).toBe("");
  });
  it("preserves exact small-file bytes and suffix seeking", async () => {
    expect(await (await get()).text()).toBe("abcdef");
    const suffix = await get(small, "bytes=-2");
    expect(suffix.status).toBe(206); expect(suffix.headers.get("content-range")).toBe("bytes 4-5/6");
    expect(await suffix.text()).toBe("ef");
  });
  it("refuses large full responses and clips large ranges without buffering the file", async () => {
    expect((await get(large)).status).toBe(413);
    const response = await get(large, "bytes=0-");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-length")).toBe(String(32 * 1024 * 1024));
    expect(response.headers.get("content-range")).toBe(`bytes 0-${32 * 1024 * 1024 - 1}/${40 * 1024 * 1024}`);
  });
  it.each(["bytes=-0", "bytes=9-10", "bytes=2-1", "bytes=0-1,2-3", "garbage"])("closes invalid ranges: %s", async range => {
    expect((await get(small, range)).status).toBe(416);
    await expect(handles[0].stat()).rejects.toThrow();
  });
  it("rejects excess per-device streams before opening a descriptor and releases cancelled slots", async () => {
    for (let i = 0; i < 4; i++) expect((await get(large, "bytes=0-")).status).toBe(206);
    expect((await get(large, "bytes=0-")).status).toBe(429); expect(handles).toHaveLength(4);
    await responses[0].body!.cancel();
    await vi.waitFor(async () => { await expect(handles[0].stat()).rejects.toThrow(); });
    await vi.waitFor(async () => expect((await get(large, "bytes=0-")).status).toBe(206));
  });
  it("rejects process-wide saturation across devices before opening a descriptor", async () => {
    for (let i = 0; i < 16; i++) { actor = `viewer-${i}`; expect((await get(large, "bytes=0-")).status).toBe(206); }
    actor = "another"; expect((await get(large, "bytes=0-")).status).toBe(429); expect(handles).toHaveLength(16);
  });
  it("closes the descriptor on client abort", async () => {
    const controller = new AbortController(), response = await get(large, "bytes=0-", controller.signal);
    const reader = response.body!.getReader();
    controller.abort(); await expect(reader.read()).rejects.toThrow(/aborted/); reader.releaseLock();
  });
  it("closes idle streams and releases their descriptors", async () => {
    vi.useFakeTimers();
    const response = await get(large, "bytes=0-"), reader = response.body!.getReader();
    await reader.read();
    await vi.advanceTimersByTimeAsync(10_001);
    await expect(reader.read()).rejects.toThrow(/deadline/); reader.releaseLock();
  });
  it("closes a continuously read stream at the total lifetime", async () => {
    vi.useFakeTimers();
    const response = await get(large, "bytes=0-"), reader = response.body!.getReader();
    for (let i = 0; i < 6; i++) { await reader.read(); await vi.advanceTimersByTimeAsync(9_000); }
    await reader.read(); await vi.advanceTimersByTimeAsync(6_001);
    await expect(reader.read()).rejects.toThrow(/deadline/); reader.releaseLock();
  });
});
