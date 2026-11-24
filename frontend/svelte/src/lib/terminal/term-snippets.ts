// Quick command snippets for the terminal toolbar. Plain shell text typed into
// the live PTY, so nothing here can execute without the user pressing Send.
export type Snippet = { id: string; label: string; command: string; hint: string };

export const SNIPPETS: Snippet[] = [
  {
    id: "status",
    label: "System status",
    command: "uptime && free -h",
    hint: "Load average, memory use and uptime",
  },
  {
    id: "disk",
    label: "Disk space",
    command: "df -h",
    hint: "Filesystem usage per mount",
  },
  {
    id: "docker",
    label: "Docker check",
    command: "docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Image}}'",
    hint: "Running containers on this host",
  },
  {
    id: "systemd",
    label: "systemd check",
    command: "systemctl --no-pager --failed",
    hint: "Failed systemd units",
  },
  {
    id: "agent",
    label: "Launch agent CLI",
    command: "claude",
    hint: "Open the Claude Code agent shell",
  },
  {
    id: "opencode",
    label: "Launch opencode",
    command: "opencode",
    hint: "Open the opencode agent shell",
  },
];

export function findSnippet(id: string): Snippet | undefined {
  return SNIPPETS.find((snippet) => snippet.id === id);
}

/** Command text for a snippet; unknown ids yield an empty string, never throw. */
export function snippetCommand(id: string): string {
  return findSnippet(id)?.command ?? "";
}
