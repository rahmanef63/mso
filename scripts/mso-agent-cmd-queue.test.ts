import { describe, expect, it } from "vitest";
import {
  formatQueueItem,
  handleQueueCommand,
} from "./mso-agent-cmd-queue.mjs";
import { createQueue, dequeue, enqueue } from "./mso-agent-queue.mjs";

function makeContext(initialItems: unknown[] = []) {
  const queue = createQueue();
  for (const item of initialItems) {
    if (typeof item === "string") {
      enqueue(queue, item);
    } else {
      // Direct push simulates objects queued with attached skills or images.
      (queue as { items: unknown[] }).items.push(item);
    }
  }
  const lines: string[] = [];
  const session = { queue };
  const printer = {
    print: (line: string) => lines.push(String(line)),
    printBlock: (block: string) => {
      for (const line of String(block).split("\n")) lines.push(line);
    },
    printLines: (arr: string[]) => lines.push(...arr),
    colors: {},
  };
  return {
    ctx: { session, printer, C: {} },
    queue,
    session,
    lines,
  };
}

describe("MSO Agent queue slash command", () => {
  it("1. listing preserves FIFO order and numbers them", async () => {
    const { ctx, lines } = makeContext(["first turn", "second turn", "third turn"]);
    await handleQueueCommand(ctx, []);

    expect(lines[0]).toContain("3 pending");
    expect(lines[1]).toMatch(/^\s*1\.\s+first turn/);
    expect(lines[2]).toMatch(/^\s*2\.\s+second turn/);
    expect(lines[3]).toMatch(/^\s*3\.\s+third turn/);
  });

  it("2. /queue drop 2 removes exactly the second and leaves the rest in order", async () => {
    const { ctx, queue, lines } = makeContext(["alpha", "beta", "gamma"]);
    await handleQueueCommand(ctx, ["drop", "2"]);

    expect(lines.some((l) => l.includes("dropped item 2") && l.includes("beta"))).toBe(true);
    // Assert FIFO drain order is intact for the remaining items in session.queue.
    expect(dequeue(queue)).toBe("alpha");
    expect(dequeue(queue)).toBe("gamma");
    expect(dequeue(queue)).toBeNull();
  });

  it("3. an out of range index is refused with a message", async () => {
    const { ctx, queue, lines } = makeContext(["one", "two"]);

    await handleQueueCommand(ctx, ["drop", "0"]);
    expect(lines[lines.length - 1]).toMatch(/cannot drop item 0.*valid: 1\.\.2/i);

    await handleQueueCommand(ctx, ["drop", "5"]);
    expect(lines[lines.length - 1]).toMatch(/cannot drop item 5.*valid: 1\.\.2/i);

    // Queue items remain untouched when drop is refused.
    expect(queue.items).toEqual(["one", "two"]);
  });

  it("4. /queue clear with 3 items clears without confirmation", async () => {
    const { ctx, queue, lines } = makeContext(["a", "b", "c"]);
    await handleQueueCommand(ctx, ["clear"]);

    expect(lines[0]).toBe("cleared 3 queued items.");
    expect(queue.items).toHaveLength(0);
  });

  it("5. /queue clear with 5 items refuses without --yes and states the count", async () => {
    const items = ["p1", "p2", "p3", "p4", "p5"];
    const { ctx, queue, lines } = makeContext(items);

    await handleQueueCommand(ctx, ["clear"]);
    expect(lines[0]).toContain("5 items");
    expect(lines[0]).toContain("/queue clear --yes");
    expect(queue.items).toHaveLength(5);

    // With explicit confirmation argument, queue is emptied.
    await handleQueueCommand(ctx, ["clear", "--yes"]);
    expect(lines[1]).toBe("cleared 5 queued items.");
    expect(queue.items).toHaveLength(0);
  });

  it("6. an empty queue lists a clear message rather than an empty table", async () => {
    const { ctx, lines } = makeContext([]);
    await handleQueueCommand(ctx, []);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("queue empty (no pending prompts)");
    expect(lines[0]).not.toContain("┌");
    expect(lines[0]).not.toContain("pending):");
  });

  it("7. honesty rule: structured objects reveal actual contents instead of [object Object]", () => {
    const skillItem = { skill: { name: "design" }, text: "redesign hero section" };
    const imageItem = { images: ["preview.png"], prompt: "analyze this layout" };
    const rawObject = { foo: "bar" };

    expect(formatQueueItem(skillItem)).toContain("[skill: design] redesign hero section");
    expect(formatQueueItem(imageItem)).toContain("[1 image] analyze this layout");
    expect(formatQueueItem(rawObject)).toBe('{"foo":"bar"}');
  });
});
