import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { request } from "node:http";
import { releaseFixture } from "./release-fixture.mjs";

const fixture = await releaseFixture();
const rss = async () => Number(/VmRSS:\s+(\d+)/.exec(await readFile(`/proc/${fixture.pid}/status`, "utf8"))[1]) * 1024;
try {
  const baseline = await rss(); let peak = baseline;
  const sample = setInterval(() => { void rss().then(value => { peak = Math.max(peak, value); }).catch(() => {}); }, 20);
  try {
    // The public gate rejects Content-Length before consuming bytes; do not race its connection close with a fetch writer.
    const oversized = await new Promise((resolve, reject) => {
      const req = request(fixture.base + "/api/auth/login", { method: "POST", headers: { "content-length": String(2 * 1024 * 1024) } }, response => { response.resume(); resolve(response.statusCode); });
      req.once("error", reject); req.setTimeout(15_000, () => req.destroy(new Error("oversized admission timed out")));
      req.flushHeaders();
    });
    assert.equal(oversized, 413);
    const login = await fetch(fixture.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: fixture.base }, body: JSON.stringify({ password: fixture.password, deviceId: fixture.device }) });
    assert.equal(login.status, 200); const cookie = login.headers.get("set-cookie").split(";")[0];
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => fetch(fixture.base + "/api/auth/login", { method: "POST", headers: { origin: fixture.base }, body: Buffer.alloc(900 * 1024) })));
    assert.ok(concurrent.every(result => [413, 429].includes(result.status)) && concurrent.some(result => result.status === 413));
    const boundary = "mso-synthetic-stream";
    const dest = `--${boundary}\r\nContent-Disposition: form-data; name="dest"\r\n\r\n${fixture.dir}\r\n`;
    const head = name => `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const end = `\r\n--${boundary}--\r\n`;
    const overhead = Buffer.byteLength(dest + head("a.bin") + "\r\n" + head("b.bin") + end);
    const sizes = [100 * 1024 * 1024 - overhead, 100 * 1024 * 1024];
    const chunk = Buffer.alloc(64 * 1024);
    async function* body() {
      yield Buffer.from(dest);
      for (const [index, size] of sizes.entries()) {
        yield Buffer.from(head(index ? "b.bin" : "a.bin"));
        for (let written = 0; written < size; written += chunk.length) yield chunk.subarray(0, Math.min(chunk.length, size - written));
        if (!index) yield Buffer.from("\r\n");
      }
      yield Buffer.from(end);
    }
    const upload = await fetch(fixture.base + "/api/v1/fs/upload", { method: "POST", headers: { cookie, origin: fixture.base, "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(200 * 1024 * 1024) }, body: Readable.from(body()), duplex: "half" });
    assert.equal(upload.status, 200); assert.deepEqual(await upload.json(), { written: 2, failed: [] });
    assert.equal((await stat(fixture.dir + "/a.bin")).size, sizes[0]); assert.equal((await stat(fixture.dir + "/b.bin")).size, sizes[1]);
    assert.ok(peak - baseline < 128 * 1024 * 1024, `streaming memory grew ${peak - baseline} bytes`);
    console.log("PASS production request bounds: oversized public body, eight near-limit requests, exact 200 MiB authenticated streaming upload, bounded RSS");
  } finally { clearInterval(sample); }
} finally { await fixture.close(); }
