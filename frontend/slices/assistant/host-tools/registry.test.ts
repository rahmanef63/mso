import { describe, expect, it } from "vitest";
// Still the os-terminal BARREL, spelled the long way: vitest.config.mts lists the
// `@` alias before `@/features`, so `@/features/os-terminal` resolves to
// <root>/features and fails to load under vitest only. Same workaround as
// lib/mcp/parity.test.ts.
import { claudeCodeApp, osTerminalApp } from "@/frontend/slices/os-terminal";
import { HOST_TOOLS, SHELL_APPS } from "./catalog";
import { findHostTool, HOST_AI_TOOLS, HOST_SYSTEM } from "./registry";

// Runs in the node env: the catalog + registry pull only the schema helpers and
// type-only imports. The one exception is that barrel, imported for the two
// AppDescriptors below — it is `lazy()` + icons and touches no DOM, which is the
// only reason it is safe here. Do not reach for the shell barrel to get
// BUILTIN_APPS instead; that drags the whole window runtime into a data test.
describe("host-tools registry", () => {
  it("classifies reads as read; fs mutations + exec as mutate", () => {
    const eff = (n: string) => findHostTool(n)?.effect;
    for (const n of ["fs.list", "fs.read", "fs.search", "fs.usage", "sys.stats", "sys.processes", "apps.list", "apps.logs", "browser.status", "skills.list", "skills.read"]) expect(eff(n)).toBe("read");
    for (const n of ["fs.write", "fs.mkdir", "fs.move", "fs.copy", "fs.delete", "exec.run", "memory.remember", "memory.forget", "apps.power", "browser.power"]) expect(eff(n)).toBe("mutate");
  });

  it("requires approval for every durable memory change", () => {
    // Remembered text crosses session and provider boundaries later, so even an add
    // must show the exact text to the owner before it is persisted.
    expect(findHostTool("memory.forget")?.effect).toBe("mutate");
    expect(findHostTool("memory.remember")?.effect).toBe("mutate");
  });

  it("does NOT expose upload or PTY — a decision, not a backlog", () => {
    // These stay off the model's list for reasons that still hold, and both are
    // written down: multipart bytes are not a thing a model can produce
    // (catalog.ts), and PTY keystrokes are neither audited nor reachable by the
    // destructive-command filter. `fs.remove` is the old name of fs.delete.
    for (const n of ["fs.remove", "fs.upload", "pty.open"]) expect(findHostTool(n)).toBeUndefined();
  });

  it("app.open advertises no app that opens a host shell", () => {
    // Keeping pty.open away from the model buys nothing if a window that mounts a
    // PTY is one app.open away: claude-code runs `claude --dangerously-skip-permissions`
    // on mount, os-terminal is a login shell, and neither passes an approval card.
    // The name comes from the model, so prompt injection reaches this. run() refuses
    // both by id; this pins the description so they are not advertised either.
    const open = findHostTool("app.open");
    expect(open?.effect).toBe("read");
    for (const shell of ["terminal", "claude-code", "claude code", "shell"])
      expect(open?.description.toLowerCase()).not.toContain(shell + ",");
    expect(open?.description).toMatch(/Terminals are not on this list/);
  });

  it("SHELL_APPS still names the two apps that actually mount a PTY", () => {
    // The guard in catalog.ts compares app.open's argument to STRING ids. Nothing
    // else connects those strings to the descriptors they refer to, so renaming
    // `claude-code` or `os-terminal` in the os-terminal barrel would leave the set
    // matching nothing — app.open would open a window that auto-runs
    // `claude --dangerously-skip-permissions`, from a READ-tier tool that parks no
    // approval card, and this whole file would still be green. The set equality is
    // the guard; the two literals are the pin, so even a correctly-synced rename
    // has to come through here on purpose.
    expect(osTerminalApp.id).toBe("os-terminal");
    expect(claudeCodeApp.id).toBe("claude-code");
    expect([...SHELL_APPS].sort()).toEqual([claudeCodeApp.id, osTerminalApp.id].sort());
  });

  it("derives one AiTool per catalog tool with an object input_schema", () => {
    expect(HOST_AI_TOOLS).toHaveLength(HOST_TOOLS.length);
    for (const t of HOST_AI_TOOLS) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.input_schema).toMatchObject({ type: "object" });
    }
  });
});

// THE GLOBAL-CAPABILITY INVARIANT for Alfa. CONTRACT.md decided it on 2026-07-30:
// every agent gets every tool, and the lock is the per-call approval card plus
// lib/host's path jail — not a shortened list. This block exists because the
// previous scoping attempt shipped a UI that COUNTED tools per agent while all of
// them were sent, so the owner believed in containment that did not exist.
describe("every agent gets every tool, always", () => {
  it("HOST_AI_TOOLS is the whole catalog, in catalog order", () => {
    expect(HOST_AI_TOOLS.map((t) => t.name)).toEqual(HOST_TOOLS.map((t) => t.name));
  });

  it("exposes no per-agent, per-playbook or per-project filter to call it through", async () => {
    const registry = await import("./registry");
    // A filter would have to be a function taking an agent/playbook/project. If one
    // appears here, the contract changed and CONTRACT.md has to change with it.
    const exported = Object.keys(registry).sort();
    expect(exported).toEqual(["HOST_AI_TOOLS", "HOST_SYSTEM", "findHostTool"]);
    expect(typeof registry.HOST_AI_TOOLS).toBe("object");
  });

  it("sends the same array on every turn — no per-turn narrowing", async () => {
    const { HOST_AI_TOOLS: again } = await import("./registry");
    expect(again).toBe(HOST_AI_TOOLS);
  });

  it("tells the model its skills span ALL projects, not the current one", () => {
    expect(HOST_SYSTEM).toMatch(/skills across all of the owner's projects/i);
  });

  it("never points the model at a native or provider image-generation tool", () => {
    expect(HOST_SYSTEM).not.toMatch(/image/i);
    expect(HOST_TOOLS.filter((t) => /image/i.test(t.name))).toEqual([]);
  });
});
