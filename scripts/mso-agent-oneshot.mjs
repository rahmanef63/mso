import fs from "node:fs";

const SCOPE_RANK = { read: 0, write: 1, exec: 2 };
const MAX_FILES = 20;
const MAX_FILE_BYTES = 200_000;

export function parseOneShot(argv = [], io = {}) {
  let index = argv.indexOf("--oneshot"); if (index < 0) index = argv.indexOf("-z");
  if (index < 0) return null;
  const promptArg = argv[index + 1];
  if (!promptArg || promptArg.startsWith("-")) throw new Error("--oneshot requires a prompt argument");
  let approvalScope = "read";
  const scopeIndex = argv.indexOf("--approve-scope");
  if (scopeIndex >= 0) {
    approvalScope = argv[scopeIndex + 1];
    if (!["read", "write", "exec"].includes(approvalScope)) throw new Error("--approve-scope must be read, write, or exec");
  }

  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") {
      const val = argv[i + 1];
      if (!val || (val.startsWith("-") && val !== "-")) throw new Error("--file requires a path argument");
      files.push(val);
      i++;
    }
  }
  if (files.length > MAX_FILES) throw new Error(`maximum of ${MAX_FILES} files can be attached`);

  let seenStdin = false;
  const fileBlocks = [];
  const readFn = io.readFileSync || fs.readFileSync;
  for (const filePath of files) {
    let content;
    if (filePath === "-") {
      if (seenStdin) throw new Error("stdin (-) can only be read once");
      seenStdin = true;
      content = io.stdin !== undefined ? io.stdin : readFn(0, "utf8");
    } else {
      try {
        content = readFn(filePath, "utf8");
      } catch (err) {
        if (err && (err.code === "ENOENT" || err.message?.includes("ENOENT"))) {
          throw new Error(`${filePath}: no such file`);
        }
        throw err;
      }
    }
    content = typeof content === "string" ? content : String(content);
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_FILE_BYTES) throw new Error(`${filePath}: file exceeds ${MAX_FILE_BYTES} byte limit (${bytes} bytes)`);
    fileBlocks.push(`<file path="${filePath}">\n${content}\n</file>`);
  }

  const prompt = fileBlocks.length ? `${fileBlocks.join("\n\n")}\n\n${promptArg}` : promptArg;
  return {
    prompt,
    json: argv.includes("--json"),
    approvalScope,
    files,
    thinking: argv.includes("--thinking"),
  };
}

export function oneShotApproves(approvalScope, toolScope) {
  return Number.isInteger(SCOPE_RANK[approvalScope]) && Number.isInteger(SCOPE_RANK[toolScope]) && SCOPE_RANK[approvalScope] >= SCOPE_RANK[toolScope];
}

export function oneShotHelp() {
  return [
    "Usage: mso agent [--continue|--resume <query>]",
    "       mso agent --oneshot <prompt> [--json] [--approve-scope read|write|exec] [--file <path>] [--thinking]",
    "",
    "One-shot runs the same autonomous MSO Agent tool loop without a TTY.",
    "Default approval scope is read; write/exec require an explicit --approve-scope.",
    "Attach files to prompt: --file <path> (repeatable, up to 20 files; '-' reads stdin).",
    "Reasoning metrics: --thinking reports the reasoning TOKENS the provider returned;",
    "  reasoning text is not captured by the stream, so no reasoning block is invented.",
  ].join("\n");
}
