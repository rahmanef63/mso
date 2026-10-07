import { describe, expect, it } from "vitest";
import { readRequestJson, readRequestText } from "./request-body";
function streamRequest(chunks: string[], headers: Record<string, string> = {}, cancelled = () => {}) {
  let index = 0;
  return new Request("https://fixture.invalid", {method: "POST", headers, duplex: "half", body: new ReadableStream({
    pull(controller) { if (index < chunks.length) controller.enqueue(new TextEncoder().encode(chunks[index++])); else controller.close(); }, cancel: cancelled,
  })} as RequestInit);
}
describe("bounded public request bodies", () => {
  it("counts actual bytes when length is absent or falsely small", async () => {
    for (const headers of [{}, {"content-length":"1"}]) await expect(readRequestText(streamRequest(["12", "345"], headers), 4)).rejects.toMatchObject({status: 413});
  });
  it("rejects declared oversized bodies before reading", async () => {
    await expect(readRequestText(streamRequest([], {"content-length":"9999"}), 16)).rejects.toMatchObject({status: 413});
  });
  it("bounds bytes rather than UTF-16 character count", async () => {
    await expect(readRequestText(streamRequest(["ééé"]), 4)).rejects.toMatchObject({status: 413});
  });
  it("preserves raw text and accepts bounded JSON objects", async () => {
    expect(await readRequestText(streamRequest(["hello", " world"]), 64)).toBe("hello world");
    expect(await readRequestJson(streamRequest(['{"ok":', 'true}']), 64)).toEqual({ok:true});
    await expect(readRequestJson(streamRequest(["null"]), 64)).rejects.toMatchObject({status: 400});
  });
  it("uses a total deadline and never hangs on stream cancellation", async () => {
    const req = new Request("https://fixture.invalid", {method:"POST", duplex:"half", body:new ReadableStream({pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); }})} as RequestInit);
    await expect(readRequestText(req, 32, 20)).rejects.toMatchObject({status:408});
  });
});
