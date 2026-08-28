import { clip, obj, str } from "./schema";
import type { HostTool } from "./types";

// The MUTATE half of the host catalog. Split from catalog.ts on the boundary that
// already governs everything else about these tools: every entry here parks an
// approval card and waits for a human before it touches the VPS, and none of the
// read tools do. Kept as one array so the approval policy has one place to look.
export const MUTATE_TOOLS: HostTool[] = [
  {
    name: "fs.write",
    group: "files",
    label: "Write",
    effect: "mutate",
    description: "Create or OVERWRITE a text file with the given contents. Overwrite is silent — read first if unsure.",
    parameters: obj({ "path!": str("Absolute file path"), "content!": str("Full new file contents") }),
    run: async (api, a) => {
      const content = String(a.content ?? "");
      await api.fs.write(String(a.path), content);
      return `wrote ${content.length} bytes to ${a.path}`;
    },
  },
  {
    name: "fs.mkdir",
    group: "files",
    label: "New folder",
    effect: "mutate",
    description: "Create a directory (parents included).",
    parameters: obj({ "path!": str("Absolute directory path to create") }),
    run: async (api, a) => {
      await api.fs.mkdir(String(a.path));
      return `created ${a.path}`;
    },
  },
  {
    name: "fs.move",
    group: "files",
    label: "Move",
    effect: "mutate",
    description: "Move or rename a file/dir to a full destination path.",
    parameters: obj({ "from!": str("Source path"), "to!": str("Destination path (full path, not just a dir)") }),
    run: async (api, a) => {
      await api.fs.move(String(a.from), String(a.to));
      return `moved ${a.from} → ${a.to}`;
    },
  },
  {
    name: "fs.copy",
    group: "files",
    label: "Copy",
    effect: "mutate",
    description: "Copy a file/dir to a full destination path. Read first if unsure.",
    parameters: obj({ "from!": str("Source path"), "to!": str("Destination path (full path, not just a dir)") }),
    run: async (api, a) => {
      await api.fs.copy(String(a.from), String(a.to));
      return `copied ${a.from} → ${a.to}`;
    },
  },
  {
    name: "fs.delete",
    group: "files",
    label: "Delete",
    effect: "mutate",
    description: "Delete a file/dir recursively within writable roots. High risk: inspect first.",
    parameters: obj({ "path!": str("Absolute file or directory path") }),
    run: async (api, a) => {
      await api.fs.remove(String(a.path));
      return `deleted ${a.path}`;
    },
  },
  {
    name: "memory.remember",
    group: "agent",
    label: "Remember",
    effect: "mutate",
    description:
      "Save the exact displayed text as durable cross-session memory. It may be recalled into future chats and sent to whichever AI provider the owner selects later, so every new memory requires explicit approval.",
    parameters: obj({ "text!": str("The exact durable fact to remember — one concise sentence") }),
    run: async (_api, a) => {
      const text = String(a.text ?? "").trim();
      if (!text) return "nothing to remember (empty text)";
      const r = await fetch("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      return r.ok ? `remembered: ${text}` : "couldn't save the memory";
    },
  },
  {
    name: "memory.forget",
    group: "agent",
    label: "Forget",
    effect: "mutate",
    description:
      "Remove saved fact(s) from long-term memory. Give a short phrase; EVERY remembered fact containing it is deleted and there is no undo, so prefer the narrowest phrase that identifies what the user meant. Use only when the user explicitly asks to forget or correct something.",
    parameters: obj({ "query!": str("A phrase identifying the fact(s) to forget") }),
    run: async (_api, a) => {
      const query = String(a.query ?? "").trim().toLowerCase();
      if (!query) return "nothing to forget (empty query)";
      const data = (await fetch("/api/memory", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { memories: [] }))
        .catch(() => ({ memories: [] }))) as { memories?: { id: string; text: string }[] };
      const hits = (data.memories ?? []).filter((m) => m.text.toLowerCase().includes(query));
      if (!hits.length) return `no saved memory matches "${a.query}"`;
      for (const m of hits) await fetch(`/api/memory?id=${encodeURIComponent(m.id)}`, { method: "DELETE" }).catch(() => {});
      return `forgot ${hits.length}: ${hits.map((m) => m.text).join("; ")}`;
    },
  },
  {
    name: "apps.power",
    group: "apps",
    label: "Start/stop app",
    effect: "mutate",
    description:
      "Start, stop, restart or back up a managed application (hermes, openclaw). Bounded to those apps and those four verbs — this exists so restarting a daemon does not require exec.run, which the destructive-command filter refuses for systemctl anyway. Check apps.list or apps.logs first.",
    parameters: obj({
      "id!": str("Managed app id from apps.list, e.g. hermes"),
      "action!": str("start | stop | restart | backup"),
    }),
    run: async (api, a) => {
      const action = String(a.action);
      if (!["start", "stop", "restart", "backup"].includes(action))
        return `unknown action "${action}" — use start, stop, restart or backup`;
      const r = await api.apps.power(String(a.id), action as "start" | "stop" | "restart" | "backup");
      return `${r.name}: ${r.running ? "running" : "stopped"} (after ${action})`;
    },
  },
  {
    name: "browser.power",
    group: "apps",
    label: "Browser on/off",
    effect: "mutate",
    description:
      "Start or stop the Camoufox browser session. Starting boots a real Firefox on a headless display holding the user's live logins; it self-terminates after 2h. Stop it when the user is done.",
    parameters: obj({ "on!": str("true to start, false to stop") }),
    run: async (api, a) => {
      const on = String(a.on).toLowerCase() === "true";
      const s = await api.browser.power(on);
      return `camoufox is now ${s.running ? "running" : "stopped"}`;
    },
  },
  {
    name: "exec.run",
    group: "terminal",
    label: "Run command",
    effect: "mutate",
    description: "Run a one-shot shell command on the VPS (30s cap, captured stdout/stderr, no PTY). Box-wrecking commands are refused by the server.",
    parameters: obj({ "cmd!": str("Shell command to run"), cwd: str("Working directory (optional; defaults to home)") }),
    run: async (api, a) => {
      const r = await api.exec.run(String(a.cmd), a.cwd ? String(a.cwd) : undefined);
      return clip(`exit ${r.code}\n${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ""}`);
    },
  },
];
