// The startup banner belongs to the transcript, not to the screen it happens to be printed on. In
// panel mode a banner written before the first frame is erased by that frame, so the entrypoint
// captures it and the loop prepends it to every render instead.
export function withPreamble(preamble, lines) {
  const head = Array.isArray(preamble) ? preamble : [];
  if (!head.length) return lines;
  return [...head, "", ...lines];
}

// Collects banner output through printAgentBanner's injectable print, so nothing is written to the
// terminal before the panel owns it. `keep` trims the result to its last few non-empty lines: the
// full banner is 31 lines on a 100 column terminal, which would occupy most of a 30 row viewport and
// push the conversation out. The tail is the part that carries information (tools, skills, how to get
// help), so the artwork is what goes.
export function captureBanner(printBanner, s, agentSession, { keep = 0 } = {}) {
  const lines = [];
  printBanner(s, agentSession, { print: (line = "") => lines.push(String(line)) });
  if (!keep) return lines;
  return lines.filter((line) => String(line).trim().length > 0).slice(-keep);
}
