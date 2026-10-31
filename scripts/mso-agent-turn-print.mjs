// Routes terminal output during interactive turns. When the retained panel
// is active, writes must go through the stream sink into the viewport buffer
// instead of escaping to the cursor. Line-oriented prompts and subagents that
// require full-terminal ownership suspend the panel temporarily.

export function turnPrinter(session, fallback = console.log) {
  return (...args) => {
    const sink = session?.streamSink;
    if (sink && typeof sink.write === "function") {
      const text = args.map((arg) => (typeof arg === "string" ? arg : String(arg ?? ""))).join(" ");
      sink.write(`${text}\n`);
    } else {
      fallback(...args);
    }
  };
}

export const getTurnPrinter = turnPrinter;

// The live activity row draws at the cursor, which in panel mode is inside the frame the panel owns,
// so the row has to become discrete lines routed through the printer instead. Returns the begun
// activity, or null when the caller supplied one already.
export function turnActivity({ session, options = {}, Activity, fallbackColors = {} }) {
  if (options.activity) return options.activity.begin();
  const panelActive = Boolean(session?.streamSink);
  return new Activity({
    output: options.output || process.stdout,
    colors: fallbackColors,
    now: options.now,
    animate: panelActive ? false : options.animate,
    print: turnPrinter(session),
  }).begin();
}

export async function withPanelSuspended(loop, fn) {
  if (!loop || !loop.active) {
    return fn();
  }
  const session = loop.session;
  const savedSink = session?.streamSink;
  let suspendedViaMethod = false;

  if (typeof loop.suspend === "function") {
    loop.suspend();
    suspendedViaMethod = true;
  } else if (session && savedSink) {
    // Fallback when a plain fake loop object without methods is supplied in tests.
    delete session.streamSink;
  }

  try {
    return await fn();
  } finally {
    if (suspendedViaMethod && typeof loop.resume === "function") {
      loop.resume();
    } else {
      if (!suspendedViaMethod && session && savedSink) {
        session.streamSink = savedSink;
      }
      if (typeof loop.paint === "function") {
        loop.paint();
      }
    }
  }
}
