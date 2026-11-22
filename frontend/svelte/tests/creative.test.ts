import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCssFilter,
  buildCssTransform,
  clampClipDuration,
  clampPercent,
  createReelClip,
  createStudioAsset,
  defaultAdjustments,
  formatTimecode,
  moveItem,
  resolveClipAtTime,
  rotateRight,
  totalDurationSec,
} from "../src/lib/creative/creative-state.ts";

test("defaultAdjustments returns neutral image adjustment values and fresh objects", () => {
  const first = defaultAdjustments();
  const second = defaultAdjustments();
  assert.deepEqual(first, {
    brightness: 100,
    contrast: 100,
    saturate: 100,
    rotateDeg: 0,
    flipH: false,
    flipV: false,
  });
  assert.notEqual(first, second);
});

test("clampPercent bounds numbers, rounds decimals, and guards non-finite input", () => {
  assert.equal(clampPercent(100, 50, 150), 100);
  assert.equal(clampPercent(20, 50, 150), 50);
  assert.equal(clampPercent(240, 50, 150), 150);
  assert.equal(clampPercent(125.6, 50, 150), 126);
  assert.equal(clampPercent(Number.NaN, 50, 150), 50);
  assert.equal(clampPercent(Number.POSITIVE_INFINITY, 0, 200), 0);
  assert.equal(clampPercent(80, 150, 50), 80);
});

test("rotateRight steps by 90 degrees clockwise and wraps at 360", () => {
  assert.equal(rotateRight(0), 90);
  assert.equal(rotateRight(90), 180);
  assert.equal(rotateRight(180), 270);
  assert.equal(rotateRight(270), 0);
  assert.equal(rotateRight(360), 90);
  assert.equal(rotateRight(-90), 0);
  assert.equal(rotateRight(Number.NaN), 90);
});

test("buildCssFilter builds clamped CSS filter string for brightness, contrast, and saturate", () => {
  const neutral = defaultAdjustments();
  assert.equal(buildCssFilter(neutral), "brightness(100%) contrast(100%) saturate(100%)");
  assert.equal(
    buildCssFilter({ ...neutral, brightness: 20, contrast: 999, saturate: -10 }),
    "brightness(50%) contrast(150%) saturate(0%)",
  );
  assert.equal(
    buildCssFilter({ ...neutral, brightness: 120, contrast: 85, saturate: 175 }),
    "brightness(120%) contrast(85%) saturate(175%)",
  );
});

test("buildCssTransform handles neutral, rotation, horizontal/vertical flips, and combined transforms", () => {
  const base = defaultAdjustments();
  assert.equal(buildCssTransform(base), "none");
  assert.equal(buildCssTransform({ ...base, rotateDeg: 90 }), "rotate(90deg)");
  assert.equal(buildCssTransform({ ...base, rotateDeg: 360 }), "none");
  assert.equal(buildCssTransform({ ...base, flipH: true }), "scale(-1, 1)");
  assert.equal(buildCssTransform({ ...base, flipV: true }), "scale(1, -1)");
  assert.equal(
    buildCssTransform({ ...base, rotateDeg: 180, flipH: true, flipV: true }),
    "rotate(180deg) scale(-1, -1)",
  );
});

test("createStudioAsset classifies media kinds, derives labels, normalizes duration, and validates path", () => {
  const img = createStudioAsset("/assets/cover.png");
  assert.equal(img.label, "cover.png");
  assert.equal(img.kind, "image");
  assert.equal(img.durationSec, 5);

  const vid = createStudioAsset("~/clips/intro.mp4?v=2", 18.4);
  assert.equal(vid.label, "intro.mp4");
  assert.equal(vid.kind, "video");
  assert.equal(vid.durationSec, 18);

  const audio = createStudioAsset("/music/theme.mp3");
  assert.equal(audio.kind, "audio");
  assert.equal(audio.durationSec, 10);

  const doc = createStudioAsset("/docs/notes.md", -5);
  assert.equal(doc.kind, "text");
  assert.equal(doc.durationSec, 0);

  assert.notEqual(img.id, vid.id);
  assert.throws(() => createStudioAsset("   "), /required/);
});

test("moveItem reorders immutably and ignores out-of-bounds or no-op moves", () => {
  const original = ["a", "b", "c"];
  assert.deepEqual(moveItem(original, 1, -1), ["b", "a", "c"]);
  assert.deepEqual(moveItem(original, 1, 1), ["a", "c", "b"]);
  assert.deepEqual(moveItem(original, 0, -1), ["a", "b", "c"]);
  assert.deepEqual(moveItem(original, 2, 1), ["a", "b", "c"]);
  assert.deepEqual(moveItem(original, 1, 0), ["a", "b", "c"]);
  assert.deepEqual(moveItem(original, -1, 1), ["a", "b", "c"]);
  assert.deepEqual(original, ["a", "b", "c"]);
});

test("totalDurationSec sums positive finite durations only", () => {
  assert.equal(totalDurationSec([]), 0);
  assert.equal(
    totalDurationSec([{ durationSec: 5 }, { durationSec: 12 }, { durationSec: 0 }]),
    17,
  );
  assert.equal(
    totalDurationSec([{ durationSec: -3 }, { durationSec: Number.NaN }, { durationSec: 8 }]),
    8,
  );
});

test("clampClipDuration enforces 1..60 second bounds", () => {
  assert.equal(clampClipDuration(0), 1);
  assert.equal(clampClipDuration(-10), 1);
  assert.equal(clampClipDuration(1), 1);
  assert.equal(clampClipDuration(25.4), 25);
  assert.equal(clampClipDuration(60), 60);
  assert.equal(clampClipDuration(180), 60);
  assert.equal(clampClipDuration(Number.NaN), 1);
});

test("createReelClip trims fields, clamps duration, and falls back to path basename or Untitled clip", () => {
  const clipA = createReelClip("  Hook  ", " /shots/a.mp4 ", 90, "  Watch this  ");
  assert.equal(clipA.title, "Hook");
  assert.equal(clipA.path, "/shots/a.mp4");
  assert.equal(clipA.durationSec, 60);
  assert.equal(clipA.caption, "Watch this");

  const clipB = createReelClip("", "/shots/cover.png", 0);
  assert.equal(clipB.title, "cover.png");
  assert.equal(clipB.durationSec, 1);
  assert.equal(clipB.caption, "");

  const clipC = createReelClip("  ", "", 5);
  assert.equal(clipC.title, "Untitled clip");
  assert.notEqual(clipA.id, clipB.id);
});

test("formatTimecode formats seconds into MM:SS and guards negative or non-finite values", () => {
  assert.equal(formatTimecode(0), "00:00");
  assert.equal(formatTimecode(7), "00:07");
  assert.equal(formatTimecode(65), "01:05");
  assert.equal(formatTimecode(600), "10:00");
  assert.equal(formatTimecode(125.9), "02:05");
  assert.equal(formatTimecode(-4), "00:00");
  assert.equal(formatTimecode(Number.NaN), "00:00");
});

test("resolveClipAtTime maps scrub seconds to the active clip and local offset", () => {
  assert.equal(resolveClipAtTime([], 5), null);
  const clips = [
    createReelClip("One", "", 5, "First"),
    createReelClip("Two", "", 10, "Second"),
  ];
  const atStart = resolveClipAtTime(clips, 0);
  assert.equal(atStart?.clip.title, "One");
  assert.equal(atStart?.index, 0);
  assert.equal(atStart?.offsetSec, 0);

  const atSecond = resolveClipAtTime(clips, 7);
  assert.equal(atSecond?.clip.title, "Two");
  assert.equal(atSecond?.index, 1);
  assert.equal(atSecond?.offsetSec, 2);

  const atEnd = resolveClipAtTime(clips, 25);
  assert.equal(atEnd?.clip.title, "Two");
  assert.equal(atEnd?.offsetSec, 10);
});
