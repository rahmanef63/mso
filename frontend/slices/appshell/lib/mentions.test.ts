import { describe, expect, it } from "vitest";
import { mentionAt, applyMention, rankMentions, type MentionItem } from "./mentions";

// The caret is always at the end of the typed text in these cases unless stated,
// so a helper keeps the intent readable.
const at = (text: string, caret = text.length) => mentionAt(text, caret);

describe("/ never fires on a filesystem path", () => {
  // This is the whole reason / is start-only. MSO is a VPS cockpit: absolute paths
  // are typed constantly, and a menu opening mid-sentence would make the composer
  // unusable. Every one of these must stay closed.
  it.each([
    "ls /home/rahman",
    "read /etc/hosts",
    "copy /var/log/syslog to /tmp",
    "what is in /home/rahman/projects/mso",
    "cd ~/projects && ls /usr/share",
    "the ratio is 3/4",
  ])("stays closed for %j", (text) => {
    expect(at(text)).toBeNull();
  });

  it("opens only as the first character of the composer", () => {
    expect(at("/")).toMatchObject({ kind: "command", query: "" });
    expect(at("/camou")).toMatchObject({ kind: "command", query: "camou" });
    // Same characters, one space earlier — closed.
    expect(at(" /camou")).toBeNull();
  });

  it("closes once the command token ends", () => {
    expect(at("/camoufox-browse ")).toBeNull();
    expect(at("/camoufox-browse open linkedin")).toBeNull();
  });
});

describe("@ opens for agents but not inside a word", () => {
  it("opens at the start and after whitespace", () => {
    expect(at("@")).toMatchObject({ kind: "agent", query: "" });
    expect(at("@res")).toMatchObject({ kind: "agent", query: "res" });
    expect(at("ask @res")).toMatchObject({ kind: "agent", query: "res" });
    expect(at("line one\n@res")).toMatchObject({ kind: "agent", query: "res" });
  });

  it("stays closed inside a word — an email types cleanly", () => {
    expect(at("mail rahman@gmail")).toBeNull();
    expect(at("example33@gmail.com")).toBeNull();
  });

  it("lowercases the query so matching is case-insensitive", () => {
    expect(at("@ReSe")?.query).toBe("rese");
  });
});

describe("completing mid-message", () => {
  it("reads the token the caret is in, not the end of the text", () => {
    const text = "ask @res about the disk";
    // caret just after "@res"
    const q = mentionAt(text, 8);
    expect(q).toMatchObject({ kind: "agent", query: "res", start: 4, end: 8 });
  });
});

describe("applyMention", () => {
  it("replaces the trigger and query without doubling an existing space", () => {
    const text = "ask @res about the disk";
    const q = mentionAt(text, 8)!;
    const out = applyMention(text, q, "@researcher");
    // Single space, not two: the message already continued with whitespace.
    expect(out.text).toBe("ask @researcher about the disk");
    expect(out.caret).toBe("ask @researcher".length);
  });

  it("the result no longer opens a popup — the trailing space closed it", () => {
    const q = mentionAt("/camou", 6)!;
    const out = applyMention("/camou", q, "/camoufox-browse");
    expect(out.text).toBe("/camoufox-browse ");
    expect(mentionAt(out.text, out.caret)).toBeNull();
  });
});

describe("rankMentions", () => {
  const items: MentionItem[] = [
    { id: "a", label: "camoufox-browse", insert: "/camoufox-browse", kind: "command" },
    { id: "b", label: "browser-check", insert: "/browser-check", kind: "command" },
    { id: "c", label: "fs.read", insert: "/fs.read", kind: "command" },
  ];

  it("puts prefix matches ahead of substring matches", () => {
    const out = rankMentions(items, "brow").map((i) => i.label);
    expect(out[0]).toBe("browser-check"); // prefix
    expect(out).toContain("camoufox-browse"); // substring, but after
    expect(out.indexOf("browser-check")).toBeLessThan(out.indexOf("camoufox-browse"));
  });

  it("returns everything (capped) for an empty query", () => {
    expect(rankMentions(items, "")).toHaveLength(3);
    expect(rankMentions(items, "", 2)).toHaveLength(2);
  });

  it("returns nothing when nothing matches", () => {
    expect(rankMentions(items, "zzz")).toHaveLength(0);
  });
});
