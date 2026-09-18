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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { requireDastTarget(process.env.MSO_DAST_URL); console.log("DAST target validated; the passive scan must still complete."); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
