// Ephemeral prompt queue commands: list, drop, clear, and enqueue follow-up turns.
import { C } from "./mso-agent-runtime.mjs";
import { createPrinter } from "./mso-agent-print.mjs";
import {
  createQueue,
  enqueue,
  queueClear,
} from "./mso-agent-queue.mjs";

// Queues with 5 or more items require explicit confirmation before clearing
// to prevent accidental loss of extensive queued work while keeping small queues friction-free.
export const CLEAR_THRESHOLD = 5;

// Mirror the queue accessor from mso-agent-queue so mutations stay synchronized
// directly on the shared in-memory queue referenced by the main drain loop.
function getQueueItems(queue) {
  if (Array.isArray(queue)) return queue;
  if (queue && Array.isArray(queue.items)) return queue.items;
  return null;
}

export function formatQueueItem(item, maxWidth = 70) {
  let display = "";
  if (typeof item === "string") {
    display = item;
  } else if (item && typeof item === "object") {
    // Reveal underlying structure honestly when queue items contain attached skills or images
    // instead of calling String(item) which produces an unhelpful [object Object].
    const tags = [];
    if (item.skill) {
      const name = typeof item.skill === "string" ? item.skill : item.skill.name || "unknown";
      tags.push(`skill: ${name}`);
    }
    if (Array.isArray(item.images) && item.images.length) {
      tags.push(`${item.images.length} ${item.images.length === 1 ? "image" : "images"}`);
    }
    const text = typeof item.text === "string" ? item.text : (typeof item.prompt === "string" ? item.prompt : "");
    if (tags.length && text) {
      display = `[${tags.join(", ")}] ${text}`;
    } else if (tags.length) {
      display = `[${tags.join(", ")}]`;
    } else if (text) {
      display = `[object] ${text}`;
    } else {
      try {
        display = JSON.stringify(item);
      } catch {
        display = "[unserializable object]";
      }
    }
  } else {
    display = String(item ?? "");
  }

  const flattened = display.replace(/[\r\n]+/g, " ").trim();
  if (flattened.length <= maxWidth) return flattened;
  return `${flattened.slice(0, Math.max(0, maxWidth - 1))}…`;
}

export function formatQueueBlock(items, { maxWidth = 72, colors = {} } = {}) {
  const list = Array.isArray(items) ? items : (items && Array.isArray(items.items) ? items.items : []);
  if (!list.length) {
    return "queue empty (no pending prompts)";
  }
  const { dim = "", reset = "", bold = "" } = colors;
  const count = list.length;
  const header = `Queued prompts (${count} pending):`;
  const lines = [bold ? `${bold}${header}${reset}` : header];
  for (let i = 0; i < list.length; i++) {
    const num = `${i + 1}.`;
    const formatted = formatQueueItem(list[i], maxWidth);
    lines.push(`  ${dim ? `${dim}${num}${reset}` : num} ${formatted}`);
  }
  return lines.join("\n");
}

export async function handleQueueCommand(ctx, args = []) {
  const session = ctx?.session ?? ctx;
  const colors = ctx?.C ?? ctx?.colors ?? C ?? {};
  const { print, printBlock } = ctx?.printer ?? createPrinter(ctx);
  const queue = session?.queue || (session.queue = createQueue());
  const items = getQueueItems(queue) || [];
  const sub = args[0]?.toLowerCase();

  // Listing pending prompts: '/queue' or '/queue list'
  if (!args.length || (args.length === 1 && sub === "list")) {
    if (!items.length) {
      print("queue empty (no pending prompts)");
      return "handled";
    }
    const block = formatQueueBlock(items, { colors });
    printBlock(block);
    return "handled";
  }

  // Dropping an item: '/queue drop <position>'
  if (sub === "drop") {
    if (args.length < 2) {
      print("usage: /queue drop <position>");
      return "handled";
    }
    const pos = Number.parseInt(args[1], 10);
    if (!Number.isInteger(pos)) {
      print(`invalid position "${args[1]}": must be a positive integer`);
      return "handled";
    }
    if (pos < 1 || pos > items.length) {
      const count = items.length;
      if (count === 0) {
        print("cannot drop item: queue is empty");
      } else {
        print(`cannot drop item ${pos}: queue has ${count} ${count === 1 ? "item" : "items"} (valid: 1..${count})`);
      }
      return "handled";
    }
    // Splice in-place so drainQueue dequeues remaining items in untouched FIFO order without index gaps.
    const [removed] = items.splice(pos - 1, 1);
    const summary = formatQueueItem(removed, 60);
    print(`dropped item ${pos}: "${summary}" (${items.length} pending)`);
    return "handled";
  }

  // Clearing the queue: '/queue clear [--yes]'
  if (sub === "clear") {
    const count = items.length;
    if (count === 0) {
      print("queue empty (0 items cleared)");
      return "handled";
    }
    const hasYes = args.slice(1).some((arg) => {
      const lower = arg.toLowerCase();
      return lower === "--yes" || lower === "-y";
    });
    if (count >= CLEAR_THRESHOLD && !hasYes) {
      print(`queue holds ${count} items; run '/queue clear --yes' to confirm clearing.`);
      return "handled";
    }
    const dropped = queueClear(queue);
    print(`cleared ${dropped} queued ${dropped === 1 ? "item" : "items"}.`);
    return "handled";
  }

  // Running the queue manually: '/queue run' triggers the turn loop to drain immediately.
  if (args.length === 1 && sub === "run") {
    return "drain";
  }

  // Enqueue follow-up prompt: '/queue <text>' or '/queue add <text>'
  const text = (sub === "add" ? args.slice(1) : args).join(" ").trim();
  if (!text && sub === "add") {
    print("usage: /queue add <prompt>");
    return "handled";
  }
  const res = enqueue(queue, text);
  if (!res.ok) {
    if (res.capped) print(`queue full (cap is ${res.cap} items)`);
    return "handled";
  }
  print(`queued (${res.count} pending)`);
  return "handled";
}
