// The startup banner belongs to the transcript, not to the screen it happens to be printed on. In
// panel mode a banner written before the first frame is erased by that frame, so the entrypoint
// captures it and the loop prepends it to every render instead.
export function withPreamble(preamble, lines) {
  const head = Array.isArray(preamble) ? preamble : [];
  if (!head.length) return lines;
  return [...head, "", ...lines];
}

// Collects banner output through printAgentBanner's injectable print, so nothing is written to the
// terminal before the panel owns it.
//
// Do NOT trim this. An earlier version kept only the last four lines on the theory that a 31 line
// banner crowds a 30 row viewport. In practice the banner is transcript content and scrolls away
// like anything else, so trimming it removed the ASCII art, which is the first thing the banner
// prints and the thing that makes the app look like itself.
export function captureBanner(printBanner, s, agentSession, { keep = 0 } = {}) {
  const lines = [];
  printBanner(s, agentSession, { print: (line = "") => lines.push(String(line)) });
  if (!keep) return lines;
  return lines.filter((line) => String(line).trim().length > 0).slice(-keep);
}
