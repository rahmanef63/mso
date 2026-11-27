import { test } from "node:test";
import assert from "node:assert/strict";

import { createTimelineClip } from "../src/lib/creative/reel-model.ts";
import { patchClipTrim } from "../src/lib/creative/reel-ops.ts";
import { trimFromDrag } from "../src/lib/creative/reel-trim.ts";

test("trimFromDrag maps pixels to trim seconds on both edges and clamps to zero", () => {
  const base = { widthPx: 200, durationSec: 4, trimInSec: 0, trimOutSec: 0 };
  // 200px represents 4s, so 50px is 1s on either edge.
  assert.deepEqual(trimFromDrag({ ...base, edge: "in", deltaPx: 50 }), { trimInSec: 1, trimOutSec: 0 });
  assert.deepEqual(trimFromDrag({ ...base, edge: "in", deltaPx: -50 }), { trimInSec: 0, trimOutSec: 0 });
  assert.deepEqual(trimFromDrag({ ...base, edge: "out", deltaPx: -50 }), { trimInSec: 0, trimOutSec: 1 });
  assert.deepEqual(trimFromDrag({ ...base, edge: "out", deltaPx: 50 }), { trimInSec: 0, trimOutSec: 0 });
  // Dragging an already-trimmed edge accumulates instead of resetting.
  assert.deepEqual(
    trimFromDrag({ ...base, edge: "in", deltaPx: 50, trimInSec: 1 }),
    { trimInSec: 2, trimOutSec: 0 },
  );
  // Degenerate geometry must not invent a trim.
  assert.deepEqual(trimFromDrag({ ...base, edge: "in", deltaPx: 50, widthPx: 0 }), { trimInSec: 0, trimOutSec: 0 });
  assert.deepEqual(trimFromDrag({ ...base, edge: "in", deltaPx: Number.NaN }), { trimInSec: 0, trimOutSec: 0 });
  // The mapped values still pass through patchClipTrim's own clamp.
  const clip = patchClipTrim(createTimelineClip({ title: "Long", durationSec: 6 }), 99, 99);
  assert.deepEqual({ in: clip.trimInSec, out: clip.trimOutSec }, { in: 5.5, out: 0 });
});
