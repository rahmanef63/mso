import { describe, expect, it } from "vitest";
import { paletteItems } from "./mso-agent-palette.mjs";
import { slashCompletionItems } from "./mso-agent-slash.mjs";

describe("TUI palette matching, ranking, and capping", () => {
  // Requirement 1: name matches must rank above description-only matches.
  it("ranks a query matching a command name above a description match", () => {
    const commands = [
      { text: "/context", meta: "Show context/token/session status", kind: "command" },
      { text: "/status", meta: "Show model, auth, context, tokens", kind: "command" },
    ];
    const items = paletteItems({ commands, query: "status" });
    expect(items).toHaveLength(2);
    // /status matches command name prefix (rank 1), /context matches description (rank 3).
    expect(items[0].text).toBe("/status");
    expect(items[1].text).toBe("/context");
  });

  // Requirement 2: matching on description alone must still surface the candidate.
  it("returns an item when a query matches only its description", () => {
    const commands = [
      { text: "/export", meta: "Export session transcript to stdout or a file", kind: "command" },
    ];
    const items = paletteItems({ commands, query: "transcript" });
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("/export");
    expect(items[0].kind).toBe("command");
  });

  // Requirement 3: an unmatched query must produce an empty list, not a fallback list.
  it("returns an empty array when nothing matches, avoiding fallback lists", () => {
    const commands = [{ text: "/help", meta: "Show commands and shortcuts", kind: "command" }];
    const settings = [{ key: "pane", description: "Side pane content to display" }];
    const sessions = [{ name: "alpha", title: "Project Alpha", status: "idle" }];

    const items = paletteItems({ commands, settings, sessions, query: "nonexistent_query" });
    expect(items).toEqual([]);
  });

  // Requirement 4: settings and sessions must be capped at 5 each to prevent overflowing the composer.
  it("caps sessions at 5 and settings at 5 while keeping all matching commands", () => {
    const commands = Array.from({ length: 12 }, (_, i) => ({
      text: `/cmd${i}`,
      meta: `Command description ${i}`,
      kind: "command",
    }));
    const settings = Array.from({ length: 8 }, (_, i) => ({
      key: `setting${i}`,
      description: `Setting description ${i}`,
    }));
    const sessions = Array.from({ length: 9 }, (_, i) => ({
      name: `agent${i}`,
      title: `Session title ${i}`,
      status: "idle",
    }));

    const items = paletteItems({ commands, settings, sessions, query: "" });
    const commandItems = items.filter((item) => item.kind === "command");
    const settingItems = items.filter((item) => item.kind === "setting");
    const sessionItems = items.filter((item) => item.kind === "session");

    expect(commandItems).toHaveLength(12);
    expect(settingItems).toHaveLength(5);
    expect(sessionItems).toHaveLength(5);
  });

  // Requirement 5: legacy callers without new sources receive identical unregressed results.
  it("returns exactly what it returned before against a fixture when no new sources are passed", () => {
    const skills = {
      skills: [
        { id: "global-design", name: "design", trust: "local", description: "global design helper" },
      ],
    };
    const legacyFixture = [
      { text: "/session", meta: "Open the recent-session picker", kind: "command" },
    ];
    const result = slashCompletionItems(skills, "/sess", "/home/operator");
    expect(result).toEqual(legacyFixture);
  });

  // Requirement 6: setting and session items must match the slash completion item shape key by key.
  it("returns items matching the slash item shape key by key", () => {
    const slashItem = slashCompletionItems({ skills: [] }, "/help", "/home/operator")[0];
    const slashKeys = Object.keys(slashItem).sort();

    const settings = [{ key: "pane", description: "Side pane content to display" }];
    const sessions = [{ name: "worker", title: "Build site", status: "idle" }];
    const commands = [{ text: "/help", meta: "Show commands", kind: "command" }];

    const items = paletteItems({ commands, settings, sessions, query: "" });
    expect(items.length).toBeGreaterThanOrEqual(3);

    for (const item of items) {
      const itemKeys = Object.keys(item).sort();
      expect(itemKeys).toEqual(slashKeys);
    }
  });

  // Ranked query demonstration for "pan".
  it("ranks setting pane prefix above description match for query pan", () => {
    const settings = [{ key: "pane", description: "Side pane content to display", keywords: ["sidebar"] }];
    const commands = [{ text: "/diff", meta: "Show unified diff in pane", kind: "command" }];
    const items = paletteItems({ commands, settings, query: "pan" });

    expect(items).toHaveLength(2);
    // Setting pane matches prefix on name (rank 1), command diff matches description (rank 3).
    expect(items[0]).toEqual({
      text: "/settings pane ",
      meta: "Side pane content to display",
      kind: "setting",
    });
    expect(items[1]).toEqual({
      text: "/diff",
      meta: "Show unified diff in pane",
      kind: "command",
    });
  });

  // Ranked query demonstration for "work".
  it("ranks session worker prefix above session working description for query work", () => {
    const sessions = [
      { name: "agent", title: "Refactor", status: "working" },
      { name: "worker", title: "Build site", status: "idle" },
    ];
    const items = paletteItems({ sessions, query: "work" });

    expect(items).toHaveLength(2);
    // Worker matches prefix on name (rank 1), agent matches state label "working" in description (rank 3).
    expect(items[0].text).toBe("/tabs 2");
    expect(items[0].kind).toBe("session");
    expect(items[0].meta).toContain("@worker");
    expect(items[1].text).toBe("/tabs 1");
    expect(items[1].kind).toBe("session");
    expect(items[1].meta).toContain("@agent");
  });
});
