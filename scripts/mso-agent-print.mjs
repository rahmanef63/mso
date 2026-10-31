// Routes command and inspection output to session.printSink when installed
// (used by panel mode to append lines into the transcript viewport), or falls
// back to the standard terminal writer in inline mode.

export function createPrinter(options = {}) {
  // Support passing either an options bag ({ session, colors, write }) or a context directly.
  const session = options?.session ?? (options?.agentSession || options?.history ? options : null);
  const colors = options?.colors ?? options?.C ?? {};
  const write = options?.write ?? console.log;

  function print(line = "") {
    const sink = session?.printSink;
    if (sink) {
      try {
        if (typeof sink === "function") {
          sink(line);
          return;
        }
        if (typeof sink.write === "function") {
          sink.write(line);
          return;
        }
      } catch {
        // A failing sink must fall back to write: losing an error message is worse than an ugly one.
      }
    }
    write(line);
  }

  function printLines(lines) {
    if (!lines) return;
    for (const line of lines) {
      print(line);
    }
  }

  function printBlock(block) {
    if (block == null) return;
    const str = typeof block === "string" ? block : String(block);
    const lines = str.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    for (const line of lines) {
      print(line);
    }
  }

  print.lines = printLines;
  print.block = printBlock;

  return {
    print,
    printLines,
    printBlock,
    colors,
  };
}
