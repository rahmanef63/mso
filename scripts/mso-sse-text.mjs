#!/usr/bin/env node
// Print the assistant's reply from the /api/assistant Server-Sent Events stream.
//
// `mso ai` is a one-turn assistant verb, so an owner wants the answer — not the
// wire frames. Only `delta` text reaches stdout. An `error` frame is a failed turn
// and exits non-zero, so a caller's `$?`/`set -o pipefail` sees the same failure the
// HTTP layer reported instead of a silent half-answer. Unknown events (tool_use,
// usage-only done, future additions) are ignored rather than printed as garbage.
const MAX_BYTES = 8 * 1024 * 1024;

function decode(payload) {
  try {
    const value = JSON.parse(payload);
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return payload;
  }
}

let buffer = "";
let written = "";
let sawFrame = false;
let sawInput = false;
let failed = false;

function handleBlock(block) {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).replace(/^ /, "");
  }
  if (!data) return;
  sawFrame = true;
  if (event === "delta") {
    const chunk = decode(data);
    written += chunk;
    process.stdout.write(chunk);
  } else if (event === "error") {
    process.stderr.write(`mso: ${decode(data)}\n`);
    failed = true;
  }
}

function drain(final) {
  const blocks = buffer.split(/\r?\n\r?\n/);
  buffer = final ? "" : blocks.pop() || "";
  for (const block of blocks) {
    if (failed) return;
    handleBlock(block.replace(/\r/g, ""));
  }
}

async function main() {
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) {
      process.stderr.write("mso: assistant reply exceeded the size limit\n");
      process.exitCode = 1;
      return;
    }
    buffer += chunk.toString("utf8");
    if (/\S/.test(buffer)) sawInput = true;
    drain(false);
    if (failed) break;
  }
  if (!failed) drain(true);

  if (failed) {
    process.exitCode = 1;
    return;
  }
  if (written && !written.endsWith("\n")) process.stdout.write("\n");
  if (!sawFrame) {
    // A 2xx body that is not SSE must not look like a successful empty answer.
    // Stay quiet on an empty stream: the HTTP layer already reported that failure.
    process.exitCode = 1;
    if (sawInput) process.stderr.write("mso: unexpected assistant response\n");
  }
}

main().catch((error) => {
  process.stderr.write(`mso: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
