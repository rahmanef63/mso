import { describe, expect, it } from "vitest";
import { eventSequenceBase, retainSessionEvents } from "./session-sequence";
import type { AgentSessionEvent } from "./session-types";

const events = (count: number): AgentSessionEvent[] => Array.from({ length: count }, (_, index) => ({ at: String(index), kind: "tool", tool: "fs_read" }));

describe("persisted event sequence", () => {
  it("normalizes legacy and malformed metadata without inventing lost history", () => {
    for (const value of [undefined, null, -1, 1.5, NaN, Infinity, "400"]) expect(eventSequenceBase(value)).toBe(0);
    expect(eventSequenceBase(400)).toBe(400);
  });
  it("advances at MAX_EVENTS rotation without shifting retained global event numbers", () => {
    const original = events(400);
    const next = retainSessionEvents([...original, { at: "400", kind: "note" }], 0, 400);
    expect(next.eventSeqBase).toBe(1);
    expect(next.events[0]).toBe(original[1]);
    expect(next.eventSeqBase + next.events.indexOf(original[399]!) + 1).toBe(400);
    expect(retainSessionEvents(next.events, next.eventSeqBase, 400)).toEqual(next);
  });
  it("preserves sequence through legacy oversize migration and compaction/archive appends", () => {
    let record = retainSessionEvents(events(450), undefined, 400);
    expect(record.eventSeqBase).toBe(50);
    for (const kind of ["compacted", "archived"] as const) {
      record = retainSessionEvents([...record.events, { at: kind, kind }], record.eventSeqBase, 400);
    }
    expect(record.eventSeqBase).toBe(52);
    expect(record.events.at(-2)?.kind).toBe("compacted");
    expect(record.events.at(-1)?.kind).toBe("archived");
  });
});
