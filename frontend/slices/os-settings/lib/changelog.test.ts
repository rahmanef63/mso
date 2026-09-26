// The generated changelog is what Settings → Account → About shows as "What's new", so what
// this parser drops, the owner never sees. These pin the two things that were
// actually wrong when it was rendered as markdown: the developer preamble reached
// the reader, and the `scope` chip was just more prose.
import { describe, expect, it } from "vitest";
import { parseChangelog } from "./changelog";

const FILE = `# Changelog

**Generated — do not edit.** \`node scripts/gen-changelog.mjs\`, run by \`bun run ship\`.
Newest first. \`docs/PROGRESS.md\` is the source of truth for *why* a change was made.

## 2026-08-17

**Added**

- \`update\` a Check again row, so a release that lands while the panel is open is visible
- \`files\` long-press opens the context menu

**Fixed**

- \`deps\` pin nanoid >=3.3.18

## 2026-08-11

**Docs**

- an entry with no scope at all
`;

describe("parseChangelog", () => {
  const days = parseChangelog(FILE);

  it("keeps the file's own preamble out of the reader's way", () => {
    expect(days.map((d) => d.date)).toEqual(["2026-08-17", "2026-08-11"]);
    const text = JSON.stringify(days);
    expect(text).not.toMatch(/do not edit/i);
    expect(text).not.toMatch(/gen-changelog/);
  });

  it("splits scope from subject, so the chip can be a chip", () => {
    const added = days[0].groups.find((g) => g.label === "Added");
    expect(added?.entries[0]).toEqual({
      scope: "update",
      text: "a Check again row, so a release that lands while the panel is open is visible",
    });
    expect(added?.entries).toHaveLength(2);
    expect(days[0].groups.find((g) => g.label === "Fixed")?.entries[0].scope).toBe("deps");
  });

  it("keeps an unscoped entry rather than dropping it", () => {
    expect(days[1].groups[0].entries[0]).toEqual({ scope: "", text: "an entry with no scope at all" });
  });

  it("returns nothing for a checkout that never generated one", () => {
    expect(parseChangelog("")).toEqual([]);
    // A file with the preamble and no days is not an error — it is a fresh repo.
    expect(parseChangelog("# Changelog\n\n**Generated — do not edit.**\n")).toEqual([]);
  });
});
