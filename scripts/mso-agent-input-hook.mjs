import { parseMouseChunk } from "./mso-agent-mouse.mjs";

// readline emits keypress on stdin and the composer is one of its listeners, so consuming a scroll
// key or a mouse sequence before the composer acts on it needs interception, and adding an option
// to the composer would mean growing a file that sits at its line ceiling. This owns that patch and
// nothing else, so the screen loop stays under the line ratchet.
export function installInputHook({ input, onKey, onMouse }) {
  const originalEmit = input?.emit;
  if (typeof originalEmit !== "function") return { dispose() {}, setEnabled() {} };
  let enabled = true;
  // A mouse report can arrive split across two `data` chunks. Only complete sequences were stripped, so
  // the tail fell through to readline and was typed into the prompt as text ("64;10;5M"). The dangling
  // fragment is held here and prepended to the next chunk until it completes.
  let pendingMouse = "";

  const consumeMouse = (payload) => {
    const events = parseMouseChunk(payload);
    if (!events.length) return false;
    for (const event of events) onMouse(event);
    return true;
  };

  input.emit = function patchedEmit(event, ...args) {
    // A suspension hands the terminal to a line oriented prompt, so the panel must stop consuming
    // keys and mouse sequences until it comes back, or the prompt would silently lose them.
    if (!enabled) return Reflect.apply(originalEmit, this, [event, ...args]);
    if (event === "data" && args[0]) {
      const chunk = typeof args[0] === "string" ? args[0] : (args[0] instanceof Buffer ? args[0].toString("utf8") : "");
      const buffered = pendingMouse + chunk;
      if (buffered.includes("\x1b[<")) {
        const events = parseMouseChunk(buffered);
        if (events.length) for (const item of events) onMouse(item);
        const stripped = buffered.replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, "");
        // Everything after an unterminated report marker may still be completing: hold it.
        const tail = stripped.lastIndexOf("\x1b[<");
        pendingMouse = tail >= 0 ? stripped.slice(tail) : "";
        const rest = tail >= 0 ? stripped.slice(0, tail) : stripped;
        if (!rest) return true;
        // Preserve the original argument type: a Buffer caller must keep receiving a Buffer.
        args[0] = args[0] instanceof Buffer ? Buffer.from(rest, "utf8") : rest;
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
    setEnabled(next) { enabled = next; if (!next) pendingMouse = ""; },
    dispose() {
      input.emit = originalEmit;
    },
  };
}
