// `mso ai` contract: the verb must post the OaMsg shape the route consumes and
// must render the reply text instead of the raw SSE frames. Both halves failed
// once already (a `content:` body returned a bare 500 and an unread stream showed
// wire frames), so the wiring is pinned here rather than only in the route test.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const state = readFileSync(path.join(root, "scripts/cli/commands-state.sh"), "utf8");
const entrypoint = readFileSync(path.join(root, "bin/mso"), "utf8");
const docs = readFileSync(path.join(root, "docs/CLI.md"), "utf8");

describe("mso ai CLI contract", () => {
  it("posts the prompt as `text`, never as OpenAI wire `content`", () => {
    expect(state).toContain('{messages:[{role:"user",text:$m}]}');
    expect(state).not.toMatch(/api\/assistant[^\n]*content:\$m/);
  });

  it("renders the reply through the SSE text reader that ships with the CLI", () => {
    const lines = state.split("\n");
    const start = lines.findIndex((line) => line.trimStart().startsWith("ai) "));
    const statement: string[] = [];
    for (let i = start; i >= 0 && i < lines.length; i++) {
      statement.push(lines[i]);
      if (!lines[i].trimEnd().endsWith("\\")) break;
    }
    expect(statement.join("\n")).toContain('node "$ROOT/scripts/mso-sse-text.mjs"');
    expect(existsSync(path.join(root, "scripts/mso-sse-text.mjs"))).toBe(true);
  });

  it("documents the reply-text output in help and generated CLI docs", () => {
    expect(entrypoint).toMatch(/^#\s+ai <prompt…>.*reply/m);
    expect(docs).toMatch(/^\s+ai <prompt…>.*reply/m);
  });
});
