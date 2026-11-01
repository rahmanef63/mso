// Vertical tab rail layout, kept out of mso-agent-chrome.mjs so that file stays under the line
// ratchet. It is still the SAME layout source: the caller passes the same segment builder, so the
// painted rail and its hit test cannot drift.
import { candidateSplits, makeSegments } from "./mso-agent-chrome.mjs";

/**
 * Split items for a vertical rail of `maxRows` rows, dropping from the middle with a +N marker.
 * @param {Array<any>} items
 * @param {{ maxRows: number, maxWidth: number, activeIdx: number, dim: string, reset: string }} options
 */
export function verticalSegments(items, { maxRows, maxWidth, activeIdx, dim = "", reset = "" }) {
  if (maxRows === 0) return [];
  if (items.length <= maxRows) return makeSegments(items, "vertical", maxWidth);
  const kept = Math.max(0, maxRows - 1);
  if (kept === 0) {
    const fallback = activeIdx >= 0 ? items[activeIdx] : items[0];
    return makeSegments([fallback], "vertical", maxWidth);
  }
  const markerText = `+${items.length - kept}`;
  const marker = { type: "marker", text: markerText, styled: `${dim}${markerText}${reset}`, width: markerText.length };
  const left = candidateSplits(kept, items.length, activeIdx)[0] ?? 0;
  return makeSegments(
    [...items.slice(0, left), marker, ...items.slice(items.length - (kept - left))],
    "vertical",
    maxWidth,
  );
}
