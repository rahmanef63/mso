#!/usr/bin/env node
// A configured passive scan must execute; an absent target is not security evidence.
import { pathToFileURL } from "node:url";

export function requireDastTarget(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("MSO_DAST_URL is required. Configure the approved HTTPS instance before running the passive baseline.");
  }
  if (value.length > 2048 || value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) {
    throw new Error("MSO_DAST_URL must be a bounded URL without whitespace or control characters.");
  }
  let url;
  try { url = new URL(value); } catch { throw new Error("MSO_DAST_URL must be an absolute HTTPS URL."); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("MSO_DAST_URL must use HTTPS without credentials, query parameters or a fragment.");
  }
  return url.href;
}

// Read at most `limit` bytes so a huge landing page cannot be buffered just to
// look for an edge error marker.
async function readPrefix(response, limit) {
  if (typeof response.body?.getReader !== "function") {
    return String((await response.text()) ?? "").slice(0, limit);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const merged = new Uint8Array(Math.min(size, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, merged.byteLength - offset);
    merged.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= merged.byteLength) break;
  }
  return new TextDecoder().decode(merged);
}

// A reachable tunnel endpoint (Cloudflare 530, "error code: 1033") answers with a
// static edge page, so a ZAP run against it produces findings about the error page
// instead of about MSO. Reject anything that is not the application itself.
export async function probeDastTarget(target, fetchImpl = fetch, timeoutMs = 15000) {
  const url = requireDastTarget(target);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`MSO_DAST_URL does not serve the application: ${error?.message ?? String(error)}`);
  }
  if (response.status !== 200 && response.status !== 204) {
    throw new Error(`MSO_DAST_URL does not serve the application: HTTP ${response.status}. The passive scan needs the live application, not an edge or tunnel error.`);
  }
  const prefix = await readPrefix(response, 4096);
  if (/error code: 1033/i.test(prefix) || prefix.includes("<title>Error 1033")) {
    throw new Error(`MSO_DAST_URL does not serve the application: HTTP ${response.status} served a Cloudflare error page (1033).`);
  }
  return { status: response.status };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const target = requireDastTarget(process.env.MSO_DAST_URL);
    const { status } = await probeDastTarget(target);
    console.log(`DAST target reachable: HTTP ${status}`);
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
