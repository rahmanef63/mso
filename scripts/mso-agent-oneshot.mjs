const SCOPE_RANK = { read: 0, write: 1, exec: 2 };

export function parseOneShot(argv = []) {
  let index = argv.indexOf("--oneshot"); if (index < 0) index = argv.indexOf("-z");
  if (index < 0) return null;
  const prompt = argv[index + 1];
  if (!prompt || prompt.startsWith("-")) throw new Error("--oneshot requires a prompt argument");
  let approvalScope = "read";
  const scopeIndex = argv.indexOf("--approve-scope");
  if (scopeIndex >= 0) {
    approvalScope = argv[scopeIndex + 1];
    if (!["read", "write", "exec"].includes(approvalScope)) throw new Error("--approve-scope must be read, write, or exec");
  }
  return { prompt, json: argv.includes("--json"), approvalScope };
}

export function oneShotApproves(approvalScope, toolScope) {
  return Number.isInteger(SCOPE_RANK[approvalScope]) && Number.isInteger(SCOPE_RANK[toolScope]) && SCOPE_RANK[approvalScope] >= SCOPE_RANK[toolScope];
}

export function oneShotHelp() {
  return [
    "Usage: mso agent [--continue|--resume <query>]",
    "       mso agent --oneshot <prompt> [--json] [--approve-scope read|write|exec]",
    "",
    "One-shot runs the same autonomous MSO Agent tool loop without a TTY.",
    "Default approval scope is read; write/exec require an explicit --approve-scope.",
  ].join("\n");
}
