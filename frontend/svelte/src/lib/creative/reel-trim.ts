export type TrimEdge = "in" | "out";

// Converts a horizontal drag on a clip edge into candidate trim seconds.
// `widthPx` is the rendered clip block width and `durationSec` the effective
// duration it represents, so the drag stays 1:1 with what the user sees.
// Clamping stays in patchClipTrim: this only maps pixels to seconds.
export function trimFromDrag(input: {
  edge: TrimEdge;
  deltaPx: number;
  widthPx: number;
  durationSec: number;
  trimInSec: number;
  trimOutSec: number;
}): { trimInSec: number; trimOutSec: number } {
  const unchanged = { trimInSec: input.trimInSec, trimOutSec: input.trimOutSec };
  if (!(input.widthPx > 0) || !Number.isFinite(input.deltaPx) || !(input.durationSec > 0)) return unchanged;
  const deltaSec = (input.deltaPx * input.durationSec) / input.widthPx;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  if (input.edge === "in") {
    return { trimInSec: round1(Math.max(0, input.trimInSec + deltaSec)), trimOutSec: input.trimOutSec };
  }
  return { trimInSec: input.trimInSec, trimOutSec: round1(Math.max(0, input.trimOutSec - deltaSec)) };
}
