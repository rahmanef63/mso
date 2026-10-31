import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { captureBanner, withPreamble } from "./mso-agent-banner-lines.mjs";
import { mountScreenLoop } from "./mso-agent-screen-loop.mjs";

function fakeTty(isTTY = true) {
  const chunks: string[] = [];
  const output = new EventEmitter();
  Object.assign(output, {
    columns: 80,
    rows: 20,
    isTTY,
    write(value: string) {
      chunks.push(String(value));
      return true;
    },
  });
  return { output, chunks, all: () => chunks.join("") };
}

const session = () => ({
  agentSession: { id: "s1", name: "agent", title: "banner" },
  state: { config: { provider: "p", model: "m" } },
  history: [{ role: "user", text: "hello" }],
  usage: { totalTokens: 1 },
  statusBar: true,
  permission: "ask",
});

describe("banner belongs to the transcript, not to the screen", () => {
  it("prepends the banner and a blank separator to the transcript lines", () => {
    expect(withPreamble(["A", "B"], ["x"])).toEqual(["A", "B", "", "x"]);
  });

  it("returns the lines untouched when there is no banner", () => {
    expect(withPreamble(null, ["x"])).toEqual(["x"]);
    expect(withPreamble([], ["x"])).toEqual(["x"]);
  });

  it("captures banner output instead of writing it", () => {
    const written: string[] = [];
    const lines = captureBanner(
      (_s: any, _a: any, options: any) => {
        options.print("line one");
        options.print("line two");
      },
      {},
      {},
    );
    expect(lines).toEqual(["line one", "line two"]);
    expect(written).toEqual([]);
  });

  it("keeps the banner visible after a repaint, which is the whole point", () => {
    const { output, all } = fakeTty();
    const banner = ["-- MSO Agent --", "Welcome to MSO Agent!"];

    const loop = mountScreenLoop({
      session: session(),
      enabled: true,
      output,
      input: new EventEmitter(),
      colors: {},
      getSessions: () => [],
      preamble: () => banner,
    });

    // A banner written once before the first frame would be gone by now.
    loop.sync();

    expect(all()).toContain("Welcome to MSO Agent!");
    expect(all()).toContain("-- MSO Agent --");
    loop.dispose();
  });

  it("writes nothing at all when the panel is disabled, banner or not", () => {
    const { output, chunks } = fakeTty(false);
    const loop = mountScreenLoop({
      session: session(),
      enabled: false,
      output,
      input: new EventEmitter(),
      colors: {},
      preamble: () => ["Welcome to MSO Agent!"],
    });

    loop.paint();
    loop.sync();
    loop.follow();
    loop.dispose();

    expect(chunks).toEqual([]);
  });
});
