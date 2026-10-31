import { parseMouseChunk } from "./mso-agent-mouse.mjs";

// readline emits keypress on stdin and the composer is one of its listeners, so consuming a scroll
// key or a mouse sequence before the composer acts on it needs interception, and adding an option
// to the composer would mean growing a file that sits at its line ceiling. This owns that patch and
// nothing else, so the screen loop stays under the line ratchet.
export function installInputHook({ input, onKey, onMouse }) {
  const originalEmit = input.emit;
  if (typeof originalEmit !== "function") return { dispose() {} };

  const consumeMouse = (payload) => {
    const events = parseMouseChunk(payload);
    if (!events.length) return false;
    for (const event of events) onMouse(event);
    return true;
  };

  input.emit = function patchedEmit(event, ...args) {
    if (event === "data" && args[0]) {
      const chunk = typeof args[0] === "string" ? args[0] : (args[0] instanceof Buffer ? args[0].toString("utf8") : "");
      if (chunk.includes("\x1b[<")) {
        const events = parseMouseChunk(chunk);
        if (events.length) {
          for (const item of events) onMouse(item);
          const stripped = chunk.replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, "");
          if (!stripped) return true;
          args[0] = typeof args[0] === "string" ? stripped : Buffer.from(stripped, "utf8");
        }
      }
    }
    if (event === "keypress") {
      const sequence = args[1]?.sequence || (typeof args[0] === "string" ? args[0] : "");
      if (typeof sequence === "string" && sequence.startsWith("\x1b[<") && consumeMouse(sequence)) return true;
      if (args[1] && onKey(args[1])) return true;
    }
    return Reflect.apply(originalEmit, this, [event, ...args]);
  };

  return {
    dispose() {
      input.emit = originalEmit;
    },
  };
}
