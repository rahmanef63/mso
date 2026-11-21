// Tool table for the Orca MCP bridge. Declarative: each entry names the orca
// subcommand and how arguments map onto flags, so there is one generic argv
// builder instead of a dozen hand-written ones.

const WORKTREE = { type: "string", description: "Worktree selector: active, current, name:<n>, branch:<b>, path:<p>, id:<repo>::<path>, issue:<n>" };
const TERMINAL = { type: "string", description: "Runtime terminal handle from orca_terminal_list (e.g. term_123). Omit to target the current terminal." };
const LIMIT = { type: "number", description: "Max rows to return" };
// Which Orca host to act on. Omitted = this laptop. A paired runtime name targets a remote VPS.
// Worktrees/terminals belong to the runtime that owns them: a handle from the VPS
// is invalid locally, so every call must carry the same host as its target.
const HOST = { type: "string", description: "Orca host selector. Omit for this laptop. Use a paired runtime name (e.g. \"remote-vps\") or --host ssh:... for remote. Required when acting on a handle issued by another host." };
const obj = (properties, required) => ({ type: "object", properties, ...(required ? { required } : {}) });

// values: string/number flags. switches: present-when-true booleans.
export const TOOLS = {
  orca_status: {
    description: "Check whether the Orca runtime (and its desktop window) is reachable. Run first: every other orca_* tool fails while runtime.state is not_running.",
    inputSchema: obj({ host: HOST }),
    argv: ["status"],
  },
  orca_host_list: {
    description: "List every Orca host this laptop can target: local, SSH targets, and paired runtimes (e.g. \"remote-vps\"). Use it to learn the host label before acting on a remote board.",
    inputSchema: obj({}),
    argv: ["host", "list"],
  },
  orca_worktree_list: {
    description: "List Orca-managed worktrees — the units on the Orca board. Find a worktree selector here before creating terminals or launching agents. Pass host=\"<remote-host>\" for a remote VPS board; omitting host shows only this laptop.",
    inputSchema: obj({ host: HOST, repo: { type: "string", description: "Repo selector: id:<id>, name:<name>, path:<path>" }, limit: LIMIT }),
    argv: ["worktree", "list"],
    values: { repo: "--repo", limit: "--limit" },
  },
  orca_worktree_ps: {
    description: "Compact orchestration summary across worktrees: what each agent/terminal is doing now. Cheapest read of board state. Pass host=\"<remote-host>\" to read a remote VPS board.",
    inputSchema: obj({ host: HOST, limit: LIMIT }),
    argv: ["worktree", "ps"],
    values: { limit: "--limit" },
  },
  orca_worktree_create: {
    description: "Create an Orca-managed worktree (new git checkout shown on the board). Optionally launch an agent inside it with a prompt.",
    inputSchema: obj({
      host: HOST,
      name: { type: "string", description: "Required worktree display name" },
      repo: { type: "string", description: "Repo selector: id:<id>, name:<name>, path:<path>. Required unless run from inside a managed worktree." },
      agent: { type: "string", description: "Agent id to launch, e.g. codex, claude, opencode. Omit to create the checkout only." },
      prompt: { type: "string", description: "Initial prompt for the launched agent" },
      model: { type: "string", description: "Model id for the agent launch" },
      effort: { type: "string", description: "Reasoning effort level for the agent launch" },
      base_branch: { type: "string", description: "Base ref for the new branch" },
      setup: { type: "string", enum: ["run", "skip", "inherit"], description: "Whether to run project setup hooks" },
    }, ["name"]),
    argv: ["worktree", "create"],
    values: { name: "--name", repo: "--repo", agent: "--agent", prompt: "--prompt", model: "--model", effort: "--effort", base_branch: "--base-branch", setup: "--setup" },
    switches: { activate: "--activate" },
  },
  orca_worktree_set: {
    description: "Update board metadata for one worktree: comment, workspace status column, display name. Keeps the board honest about what an agent is doing.",
    inputSchema: obj({
      host: HOST,
      worktree: WORKTREE,
      comment: { type: "string", description: "Free-text note shown on the board" },
      workspace_status: { type: "string", description: "Board status/column id" },
      display_name: { type: "string", description: "New display name" },
    }, ["worktree"]),
    argv: ["worktree", "set"],
    values: { worktree: "--worktree", comment: "--comment", workspace_status: "--workspace-status", display_name: "--display-name" },
  },
  orca_terminal_list: {
    description: "List live Orca-managed terminals with runtime handles. Handles are required by orca_terminal_send/read/wait/close.",
    inputSchema: obj({ host: HOST, worktree: WORKTREE, limit: LIMIT, include_visual_layouts: { type: "boolean", description: "Include tab and pane topology" } }),
    argv: ["terminal", "list"],
    values: { worktree: "--worktree", limit: "--limit" },
    switches: { include_visual_layouts: "--include-visual-layouts" },
  },
  orca_terminal_create: {
    description: "Spawn a terminal session in a worktree. How you start a long-running interactive process (agent CLI, dev server) that appears on the Orca board.",
    inputSchema: obj({
      host: HOST,
      worktree: WORKTREE,
      title: { type: "string", description: "Terminal tab title" },
      command: { type: "string", description: "Command to run, e.g. \"codex\" or \"bun run dev\"" },
      shell: { type: "string", description: "Shell to use" },
      focus: { type: "boolean", description: "Bring the terminal to the foreground" },
    }),
    argv: ["terminal", "create"],
    values: { worktree: "--worktree", title: "--title", command: "--command", shell: "--shell" },
    switches: { focus: "--focus" },
  },
  orca_terminal_send: {
    description: "Send text to a live terminal; enter=true submits it. Interactive agent TUI input, not a shell one-shot.",
    inputSchema: obj({
      host: HOST,
      terminal: TERMINAL,
      text: { type: "string", description: "Text to send" },
      enter: { type: "boolean", description: "Append Enter to submit" },
      interrupt: { type: "boolean", description: "Send as interrupt-style input" },
      wait_submit: { type: "number", description: "Seconds to observe the accepted prompt without resending" },
    }, ["text"]),
    argv: ["terminal", "send"],
    values: { terminal: "--terminal", text: "--text", wait_submit: "--wait-submit" },
    switches: { enter: "--enter", interrupt: "--interrupt" },
  },
  orca_terminal_read: {
    description: "Read bounded terminal output. Pass cursor from a previous read to continue incrementally.",
    inputSchema: obj({ host: HOST, terminal: TERMINAL, cursor: { type: "number", description: "Resume cursor from a previous read" }, limit: LIMIT }),
    argv: ["terminal", "read"],
    values: { terminal: "--terminal", cursor: "--cursor", limit: "--limit" },
  },
  orca_terminal_wait: {
    description: "Block until a terminal exits or its TUI goes idle. Use after sending a prompt instead of polling.",
    inputSchema: obj({
      host: HOST,
      terminal: TERMINAL,
      for: { type: "string", enum: ["exit", "tui-idle"], description: "Condition to wait for" },
      timeout_ms: { type: "number", description: "Max wait in milliseconds" },
    }, ["for"]),
    argv: ["terminal", "wait"],
    values: { terminal: "--terminal", for: "--for", timeout_ms: "--timeout-ms" },
  },
  orca_terminal_close: {
    description: "Close one terminal, its whole tab (tab=true), or every terminal in a worktree (all=true with worktree).",
    inputSchema: obj({
      host: HOST,
      terminal: TERMINAL,
      tab: { type: "boolean", description: "Close the whole tab containing the terminal" },
      worktree: WORKTREE,
      all: { type: "boolean", description: "Close every terminal in the worktree" },
    }),
    argv: ["terminal", "close"],
    values: { terminal: "--terminal", worktree: "--worktree" },
    switches: { tab: "--tab", all: "--all" },
    requireOneOf: [["terminal", "all"]],
  },
  orca_agent_launch: {
    description: "Launch a coding agent (chat or terminal, per Orca settings) in an existing worktree. Prefer over orca_terminal_create when you want a tracked agent rather than a raw shell.",
    inputSchema: obj({
      host: HOST,
      agent: { type: "string", description: "Agent id, e.g. codex, claude, opencode" },
      worktree: WORKTREE,
      prompt: { type: "string", description: "Initial prompt" },
      model: { type: "string", description: "Model id" },
      effort: { type: "string", description: "Reasoning effort level" },
      focus: { type: "boolean", description: "Bring the agent to the foreground" },
    }, ["agent"]),
    argv: ["agent", "launch"],
    values: { agent: "--agent", worktree: "--worktree", prompt: "--prompt", model: "--model", effort: "--effort" },
    switches: { focus: "--focus" },
  },
};

const READ_ONLY = new Set(["orca_status", "orca_host_list", "orca_worktree_list", "orca_worktree_ps", "orca_terminal_list", "orca_terminal_read"]);

// `orca` spells remote targeting two ways: --environment <name|id> for every
// routed command, and --host runtime:<env-id> for worktree create only. Normalise
// one `host` argument onto whichever the subcommand accepts.
function hostFlags(name, args) {
  const host = typeof args.host === "string" ? args.host.trim() : "";
  if (!host || host === "local") return [];
  if (name === "orca_host_list") return []; // rejects --environment by design
  if (name === "orca_worktree_create" && (host.startsWith("runtime:") || host.startsWith("ssh:"))) return ["--host", host];
  // A bare name is a paired-runtime name; --environment takes a name or an id.
  return ["--environment", host.replace(/^runtime:/, "")];
}

/** True when a bare paired-runtime name must be resolved to its id before `--host runtime:<id>` works. */
export function needsEnvironmentId(name, args) {
  const host = typeof args.host === "string" ? args.host.trim() : "";
  return name === "orca_worktree_create" && host !== "" && host !== "local" && !host.includes(":");
}

export function toolDescriptors() {
  return Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: READ_ONLY.has(name),
      destructiveHint: name === "orca_terminal_close",
      openWorldHint: false,
    },
  }));
}

/** Map snake_case args onto orca flags. Returns argv, or null when a required arg is missing. */
export function buildArgv(name, args) {
  const tool = TOOLS[name];
  if (!tool) return null;
  const argv = [...tool.argv, ...hostFlags(name, args)];
  for (const [arg, flag] of Object.entries(tool.values ?? {})) {
    const value = args[arg];
    if (value === undefined || value === null || value === "") continue;
    argv.push(flag, String(value));
  }
  for (const [arg, flag] of Object.entries(tool.switches ?? {})) {
    if (args[arg] === true) argv.push(flag);
  }
  for (const group of tool.requireOneOf ?? []) {
    const present = (arg) => args[arg] !== undefined && args[arg] !== null && args[arg] !== "" && args[arg] !== false;
    // Each entry is an alternative: at least one argument must be supplied.
    if (!group.some(present)) return null;
  }
  const required = tool.inputSchema.required ?? [];
  if (required.some((arg) => args[arg] === undefined || args[arg] === null || args[arg] === "")) return null;
  // --all needs a worktree scope; default to the active one.
  if (name === "orca_terminal_close" && args.all === true && !args.worktree) argv.push("--worktree", "active");
  return argv;
}
