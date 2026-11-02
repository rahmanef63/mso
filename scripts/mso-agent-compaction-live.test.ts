import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { mountScreenLoop } from "./mso-agent-screen-loop.mjs";

// Tracks screen rows by interpreting minimal cursor movements and line updates emitted by writeFrame.
function createTerminal(columns = 80, rows = 24) {
  const chunks: string[] = [];
  const screen: string[] = [];
  let currentRow = 0;

  const output = new EventEmitter();
  Object.assign(output, {
    columns,
    rows,
    isTTY: true,
    write(value: string) {
      const str = String(value);
      chunks.push(str);
      // \x1b[H resets cursor to home row (0,0) before redrawing frame.
      if (str === "\x1b[H") {
        currentRow = 0;
      } else if (str.startsWith("\x1b[") && str.endsWith("B")) {
        // \x1b[<n>B moves cursor down n rows.
        currentRow += parseInt(str.slice(2, -1), 10);
      } else if (str.startsWith("\r\x1b[2K")) {
        // \r\x1b[2K clears line and writes next content.
        screen[currentRow] = str.slice(5);
      }
      return true;
    },
  });

  return {
    output,
    input: new EventEmitter(),
    chunks,
    screen,
    // Extracts visible lines matching a substring to assert transcript line occurrences.
    linesMatching: (pattern: string | RegExp) =>
      screen.filter((line) => (typeof pattern === "string" ? line?.includes(pattern) : pattern.test(line))),
  };
}

const makeSession = (compactionCount = 0) => ({
  agentSession: {
    id: "session-live-test",
    name: "agent",
    title: "live test",
    compactionCount,
    compactThresholdTokens: 50000,
    estimatedTokens: 10000,
  },
  state: { config: { provider: "anthropic", model: "claude-3-opus" } },
  history: [{ role: "user", text: "initial user message" }],
  usage: { totalTokens: 100 },
  statusBar: true,
  permission: "ask",
});

describe("MSO Agent live compaction in TUI screen loop", () => {
  // Test 1: a simulated compactionCount increment between two syncs produces exactly one line.
  it("a simulated compactionCount increment between two syncs produces exactly one line", () => {
    const { output, input, linesMatching } = createTerminal();
    const session = makeSession(0);
    const loop = mountScreenLoop({ enabled: true, session, output, input });

    // Initial mount with count 0 captures baseline; no compaction notice is emitted yet.
    expect(linesMatching("[session compacted")).toHaveLength(0);

    // Simulating turn completion where session compactor incremented compactionCount to 1.
    session.agentSession.compactionCount = 1;
    loop.sync();

    // Exactly one notice line announcing compaction must now appear in the transcript rows.
    const notices = linesMatching("[session compacted");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("#1");
    expect(notices[0]).toContain("50k");

    loop.dispose();
  });

  // Test 2: a second sync with no change produces none.
  it("a second sync with no change produces none", () => {
    const { output, input, linesMatching } = createTerminal();
    const session = makeSession(0);
    const loop = mountScreenLoop({ enabled: true, session, output, input });

    // Increment compactionCount once and sync.
    session.agentSession.compactionCount = 1;
    loop.sync();
    expect(linesMatching("[session compacted")).toHaveLength(1);

    // Repainting or syncing again without count change must NOT produce a second line.
    loop.sync();
    loop.sync();
    expect(linesMatching("[session compacted")).toHaveLength(1);

    loop.dispose();
  });

  // Test 3: the notice survives the setLines recompute that follows it.
  it("the notice survives the setLines recompute that follows it", () => {
    const { output, input, linesMatching } = createTerminal();
    const session = makeSession(0);
    const loop = mountScreenLoop({ enabled: true, session, output, input });

    // Trigger initial live compaction notice.
    session.agentSession.compactionCount = 1;
    loop.sync();
    expect(linesMatching("[session compacted")).toHaveLength(1);

    // Next interaction adds new messages to history; sync calls setLines which recomputes transcript.
    // Notice must remain because sync composes [...transcriptLines, ...compaction.lines(colors)].
    session.history.push({ role: "assistant", text: "turn 2 response" });
    session.history.push({ role: "user", text: "turn 3 query" });
    loop.sync();

    // Notice line is still present in the viewport and was not wiped by setLines recompute.
    expect(linesMatching("[session compacted")).toHaveLength(1);
    expect(linesMatching("turn 2 response").length).toBeGreaterThan(0);

    loop.dispose();
  });

  // Test 4: a session with no compaction fields produces nothing and does not throw.
  it("a session with no compaction fields produces nothing and does not throw", () => {
    const { output, input, linesMatching } = createTerminal();
    const sessionWithoutCompaction = {
      agentSession: { id: "legacy-session-no-compaction", name: "agent" },
      history: [{ role: "user", text: "legacy message" }],
      state: {},
      usage: {},
    };

    // Mount must not throw when compaction fields are missing.
    let loop: any;
    expect(() => {
      loop = mountScreenLoop({ enabled: true, session: sessionWithoutCompaction, output, input });
    }).not.toThrow();

    // Multiple syncs must succeed gracefully without throwing or creating bogus notices.
    expect(() => {
      loop.sync();
      loop.sync();
    }).not.toThrow();

    expect(linesMatching("[session compacted")).toHaveLength(0);

    loop.dispose();
  });
});
