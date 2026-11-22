import { describe, expect, it } from "vitest";
import {
  createQueue,
  dequeue,
  enqueue,
  queueClear,
  queueList,
} from "./mso-agent-queue.mjs";

describe("MSO Agent queue", () => {
  it("enqueue trims whitespace and ignores empty input", () => {
    const queue = createQueue();
    const emptyResult = enqueue(queue, "   ");
    expect(emptyResult.ok).toBe(false);
    expect(queueList(queue)).toEqual([]);

    const trimmedResult = enqueue(queue, "  follow up question  ");
    expect(trimmedResult.ok).toBe(true);
    expect(trimmedResult.count).toBe(1);
    expect(queueList(queue)).toEqual(["follow up question"]);
  });

  it("caps at 20 items and reports refusal", () => {
    const queue = createQueue();
    for (let i = 1; i <= 20; i++) {
      const res = enqueue(queue, `prompt ${i}`);
      expect(res.ok).toBe(true);
    }
    expect(queueList(queue)).toHaveLength(20);

    const overflow = enqueue(queue, "prompt 21");
    expect(overflow.ok).toBe(false);
    expect(overflow.capped).toBe(true);
    expect(overflow.cap).toBe(20);
    expect(queueList(queue)).toHaveLength(20);
  });

  it("dequeue is FIFO", () => {
    const queue = createQueue();
    enqueue(queue, "first");
    enqueue(queue, "second");
    enqueue(queue, "third");

    expect(dequeue(queue)).toBe("first");
    expect(dequeue(queue)).toBe("second");
    expect(dequeue(queue)).toBe("third");
    expect(dequeue(queue)).toBeNull();
  });

  it("list returns stable order", () => {
    const queue = createQueue();
    enqueue(queue, "alpha");
    enqueue(queue, "beta");
    enqueue(queue, "gamma");

    expect(queueList(queue)).toEqual(["alpha", "beta", "gamma"]);
    expect(queueList(queue)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("clear returns the dropped count", () => {
    const queue = createQueue();
    expect(queueClear(queue)).toBe(0);

    enqueue(queue, "one");
    enqueue(queue, "two");
    enqueue(queue, "three");

    const dropped = queueClear(queue);
    expect(dropped).toBe(3);
    expect(queueList(queue)).toEqual([]);
    expect(dequeue(queue)).toBeNull();
  });
});
