import { describe, expect, it } from "vitest";
import { atItems, atTrigger, applyCompletion, pluginToolFilter, resolveMentions } from "./mso-agent-at.mjs";
import { promptCompletion } from "./mso-agent-prompt-completion.mjs";

const agents = [
  { name: "worker", status: "active", consumerConnected: true },
  { name: "retired", status: "offline" },
];
const mcpServers = [
  { name: "github", toolCount: 12 },
  { name: "linear", tools: ["issue_search", "issue_create"] },
];

describe("@ trigger", () => {
  it("opens at the start of a line and after whitespace, and not mid word", () => {
    expect(atTrigger("@wo")).toEqual({ start: 0, query: "wo" });
    expect(atTrigger("hello @wo")).toEqual({ start: 6, query: "wo" });
    expect(atTrigger("mail@example.com")).toBeNull();
  });

  it("ends the query at the first space, so trailing prose does not break matching", () => {
    expect(atTrigger("ask @worker about it", 11)).toEqual({ start: 4, query: "worker" });
  });

  it("stays closed inside a slash command, because the command owns the line", () => {
    expect(atTrigger("/find @foo")).toBeNull();
    expect(atTrigger("  /export @x")).toBeNull();
  });

  it("returns nothing when there is no @ before the cursor", () => {
    expect(atTrigger("plain text")).toBeNull();
    expect(atTrigger("")).toBeNull();
  });
});

describe("@ menu items", () => {
  it("lists agents and plugins together, each labelled with its kind", () => {
    const items = atItems({ agents, mcpServers });
    expect(items.map((i) => i.kind)).toEqual(["agent", "agent", "plugin", "plugin"]);
    expect(items.every((i) => i.text.startsWith("@"))).toBe(true);
  });

  it("marks an offline agent instead of hiding it, because absent and unreachable differ", () => {
    const offline = atItems({ agents, mcpServers }).find((i) => i.text === "@retired");
    expect(offline?.meta).toContain("offline");
    expect(offline?.meta).toContain("queue");
  });

  it("counts tools for a plugin from either a number or a list", () => {
    const items = atItems({ agents: [], mcpServers });
    expect(items.find((i) => i.text === "@github")?.meta).toContain("12 tools");
    expect(items.find((i) => i.text === "@linear")?.meta).toContain("2 tools");
  });

  it("filters by the typed query, case insensitively", () => {
    expect(atItems({ agents, mcpServers }, "GITH").map((i) => i.text)).toEqual(["@github"]);
    expect(atItems({ agents, mcpServers }, "zzz")).toEqual([]);
  });

  it("lets an agent win a name collision, because addressing a person has a side effect", () => {
    const items = atItems({ agents: [{ name: "github" }], mcpServers: [{ name: "github" }] });
    expect(items.filter((i) => i.text === "@github")).toHaveLength(1);
    expect(items[0].kind).toBe("agent");
  });

  it("survives empty or malformed sources without throwing", () => {
    expect(atItems()).toEqual([]);
    expect(atItems({ agents: null as any, mcpServers: undefined })).toEqual([]);
    expect(atItems({ agents: [{}, { name: "" }], mcpServers: [{}] })).toEqual([]);
  });
});

describe("mention resolution", () => {
  it("separates plugin addresses from agent addresses", () => {
    const out = resolveMentions("@worker look at @github issues", { agents, mcpServers });
    expect(out.plugins.map((p) => p.name)).toEqual(["github"]);
    expect(out.agents.map((a) => a.name)).toEqual(["worker"]);
  });

  it("keeps an unknown @ in the prompt and reports it, rather than deleting words", () => {
    const out = resolveMentions("ping @ghost now", { agents, mcpServers });
    expect(out.unknown).toEqual(["ghost"]);
    expect(out.text).toBe("ping @ghost now");
  });

  it("leaves a plain prompt untouched", () => {
    const out = resolveMentions("no mentions here", { agents, mcpServers });
    expect(out).toEqual({ agents: [], plugins: [], unknown: [], text: "no mentions here" });
  });
});

describe("plugin scoping", () => {
  const tools = [
    { name: "github__issue_search" },
    { name: "github__issue_create" },
    { name: "linear__issue_search" },
    { name: "fs_read" },
  ];

  it("narrows a turn to the named server and nothing else", () => {
    const filter = pluginToolFilter([{ name: "github" }], tools)!;
    expect(tools.filter(filter).map((t) => t.name)).toEqual(["github__issue_search", "github__issue_create"]);
  });

  it("returns no filter when no plugin was named, which reads as unrestricted", () => {
    expect(pluginToolFilter([], tools)).toBeNull();
  });

  it("refuses to scope to a name no tool carries, instead of disabling every tool silently", () => {
    expect(pluginToolFilter([{ name: "unknown" }], tools)).toBeNull();
  });

  it("allows several plugins in one turn", () => {
    const filter = pluginToolFilter([{ name: "github" }, { name: "linear" }], tools)!;
    expect(tools.filter(filter)).toHaveLength(3);
  });
});

describe("completion routing", () => {
  const slash = (line: string) => (line.startsWith("/") ? [{ text: "/help", label: "/help" }] : []);

  it("routes a slash line to commands", () => {
    const complete = promptCompletion({ slash, sources: () => ({ agents, mcpServers }) });
    expect(complete("/he")).toEqual([{ text: "/help", label: "/help" }]);
  });

  it("routes an @ line to the mixed menu, marking where the token begins", () => {
    const complete = promptCompletion({ slash, sources: () => ({ agents, mcpServers }) });
    const items = complete("tell @wo");
    expect(items[0].text).toBe("@worker");
    expect(items[0].replaceFrom).toBe(5);
  });

  it("gives no @ items inside a slash command", () => {
    const complete = promptCompletion({ slash, sources: () => ({ agents, mcpServers }) });
    // The line is a command, so the slash menu owns it and no @ token is offered.
    expect(complete("/find @foo").map((i: any) => i.text)).not.toContain("@foo");
  });
});

describe("applying a completion", () => {
  it("treats a slash item as the whole line", () => {
    expect(applyCompletion("/he", 3, { text: "/help" })).toEqual({ value: "/help", cursor: 5 });
  });

  it("replaces only the @ token and keeps the surrounding words", () => {
    expect(applyCompletion("tell @wo about it", 8, { text: "@worker", replaceFrom: 5 })).toEqual({
      value: "tell @worker about it",
      cursor: 12,
    });
  });

  it("works with an @ token at the start and nothing after it", () => {
    expect(applyCompletion("@gi", 3, { text: "@github", replaceFrom: 0 })).toEqual({ value: "@github", cursor: 7 });
  });
});
