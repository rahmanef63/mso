import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCaption,
  createTimelineClip,
  defaultReelProject,
  effectiveClipDuration,
  filterCssForPreset,
  formatTimecodePrecise,
  getAspectPreset,
  totalTimelineDuration,
} from "../src/lib/creative/reel-model.ts";
import {
  buildStoryboardExport,
  clipStartTime,
  createHistory,
  duplicateClip,
  patchClipTrim,
  pushHistory,
  redoHistory,
  resolveActiveCaptions,
  resolveTimelineClipAtTime,
  splitClipAtTime,
  undoHistory,
} from "../src/lib/creative/reel-ops.ts";
import { slugifyFilename } from "../src/lib/creative/reel-snapshot.ts";
import {
  addTagToAsset,
  buildStudioManifest,
  computeQueueOffsets,
  createProjectAsset,
  duplicateStudioAsset,
  filterStudioAssets,
  formatBytesCompact,
  isImportableMediaFile,
  joinHostPath,
  removeTagFromAsset,
  summarizeStudioBatch,
} from "../src/lib/creative/studio-model.ts";

const CREATIVE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/creative");

test("formatTimecodePrecise formats MM:SS.d and guards invalid values", () => {
  assert.equal(formatTimecodePrecise(0), "00:00.0");
  assert.equal(formatTimecodePrecise(5.4), "00:05.4");
  assert.equal(formatTimecodePrecise(65.9), "01:05.9");
  assert.equal(formatTimecodePrecise(-2), "00:00.0");
  assert.equal(formatTimecodePrecise(Number.NaN), "00:00.0");
});

test("reel clip trim, effective duration, total duration, and active clip resolution", () => {
  const c1 = patchClipTrim(createTimelineClip({ title: "Intro", durationSec: 6 }), 1, 1);
  assert.equal(effectiveClipDuration(c1), 4);
  const c2 = createTimelineClip({ title: "Body", durationSec: 5, transition: "fade" });
  const clips = [c1, c2];

  assert.equal(totalTimelineDuration(clips), 9);
  assert.equal(clipStartTime(clips, 0), 0);
  assert.equal(clipStartTime(clips, 1), 4);

  const atTransition = resolveTimelineClipAtTime(clips, 4.2);
  assert.equal(atTransition?.clip.id, c2.id);
  assert.equal(atTransition?.inTransition, true);
  assert.ok((atTransition?.transitionProgress ?? 0) > 0 && (atTransition?.transitionProgress ?? 1) < 1);

  const pastTransition = resolveTimelineClipAtTime(clips, 6.5);
  assert.equal(pastTransition?.clip.id, c2.id);
  assert.equal(pastTransition?.inTransition, false);
  assert.equal(pastTransition?.offsetSec, 2.5);
});

test("splitClipAtTime splits at playhead when inside clip and midpoint otherwise", () => {
  const c1 = createTimelineClip({ title: "Shot A", durationSec: 6 });
  const c2 = createTimelineClip({ title: "Shot B", durationSec: 4 });

  const splitIn = splitClipAtTime([c1, c2], c1.id, 2.5);
  assert.equal(splitIn.clips.length, 3);
  assert.ok(splitIn.createdId);
  assert.equal(splitIn.clips[0]!.durationSec, 2.5);
  assert.equal(splitIn.clips[1]!.durationSec, 3.5);
  assert.equal(splitIn.clips[1]!.title, "Shot A (Part 2)");

  const splitMid = splitClipAtTime([c1, c2], c2.id, 0);
  assert.equal(splitMid.clips.length, 3);
  assert.equal(splitMid.clips[1]!.durationSec, 2);
  assert.equal(splitMid.clips[2]!.durationSec, 2);

  const tiny = patchClipTrim(createTimelineClip({ title: "Tiny", durationSec: 1 }), 0.2, 0.2);
  const cannotSplit = splitClipAtTime([tiny], tiny.id, 0.3);
  assert.equal(cannotSplit.createdId, null);
  assert.equal(cannotSplit.clips.length, 1);
});

test("duplicateClip inserts copy directly after source clip", () => {
  const c1 = createTimelineClip({ title: "Hook", durationSec: 4, filter: "vivid" });
  const res = duplicateClip([c1], c1.id);
  assert.equal(res.clips.length, 2);
  assert.equal(res.clips[1]!.title, "Hook Copy");
  assert.equal(res.clips[1]!.filter, "vivid");
  assert.notEqual(res.clips[0]!.id, res.clips[1]!.id);
});

test("caption resolution, history undo/redo, and storyboard JSON export", () => {
  const capA = createCaption({ text: "Hello", startSec: 0, endSec: 3, position: "top", style: "bold", fontSizePx: 22 });
  const capB = createCaption({ text: "World", startSec: 3, endSec: 7, position: "bottom", bgPill: false });
  assert.deepEqual(resolveActiveCaptions([capA, capB], 1.5).map((c) => c.id), [capA.id]);
  assert.deepEqual(resolveActiveCaptions([capA, capB], 3.0).map((c) => c.id), [capB.id]);

  let stack = createHistory(1);
  stack = pushHistory(stack, 2);
  stack = pushHistory(stack, 3);
  assert.equal(stack.present, 3);
  stack = undoHistory(stack);
  assert.equal(stack.present, 2);
  stack = redoHistory(stack);
  assert.equal(stack.present, 3);

  const project = defaultReelProject();
  const exported = buildStoryboardExport(project);
  assert.equal(exported.schema, "mso.reel.storyboard.v1");
  assert.equal(exported.project.aspect, "9:16");
  assert.equal(exported.project.width, getAspectPreset("9:16").width);
  assert.equal(exported.tracks.video.length, project.clips.length);
  assert.equal(filterCssForPreset("mono").includes("grayscale"), true);
  assert.equal(slugifyFilename("Launch Reel 2026!", "reel"), "launch-reel-2026");
});

test("studio-model handles assets, filtering, batch summaries, offsets, tags, and manifest", () => {
  const img = createProjectAsset("/media/cover.png", 5, 2048);
  const vid = createProjectAsset("/media/demo.mp4", 12, 3_145_728);
  const aud = createProjectAsset("/media/bgm.mp3", 30);

  const taggedImg = addTagToAsset(addTagToAsset(img, "Hero Shot"), "hero-shot");
  assert.deepEqual(taggedImg.tags, ["hero-shot"]);
  assert.deepEqual(removeTagFromAsset(taggedImg, "hero-shot").tags, []);

  const list = [taggedImg, vid, aud];
  assert.equal(filterStudioAssets(list, "video", "").length, 1);
  assert.equal(filterStudioAssets(list, "all", "hero-shot").length, 1);

  const summary = summarizeStudioBatch(list);
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.totalDurationSec, 47);
  assert.deepEqual(summary.counts, { image: 1, video: 1, audio: 1, other: 0 });

  const offsets = computeQueueOffsets(list);
  assert.deepEqual(offsets.get(vid.id), { id: vid.id, startSec: 5, endSec: 17 });
  assert.deepEqual(offsets.get(aud.id), { id: aud.id, startSec: 17, endSec: 47 });

  const copy = duplicateStudioAsset(taggedImg);
  assert.notEqual(copy.id, taggedImg.id);
  assert.equal(copy.label, "cover.png (Copy)");

  assert.equal(isImportableMediaFile("photo.webp"), "image");
  assert.equal(isImportableMediaFile("clip.bin", "video/mp4"), "video");
  assert.equal(isImportableMediaFile("readme.md"), null);
  assert.equal(joinHostPath("~/media", "shot.mp4"), "~/media/shot.mp4");
  assert.equal(joinHostPath("/var/media/", "a.png"), "/var/media/a.png");
  assert.equal(formatBytesCompact(2048), "2.0 KB");

  const manifest = buildStudioManifest("Sprint Demo", list);
  assert.equal(manifest.schema, "mso.media-studio.manifest.v1");
  assert.equal(manifest.queue.length, 3);
  assert.equal(manifest.queue[1]!.startSec, 5);
});

test("all Reel Editor and Media Studio files comply with repo hard gates", () => {
  const ownedFiles = [
    "reel-model.ts",
    "reel-ops.ts",
    "reel-snapshot.ts",
    "ReelProjectBar.svelte",
    "ReelStagePreview.svelte",
    "ReelTimeline.svelte",
    "ReelAudioLane.svelte",
    "ReelInspectorBin.svelte",
    "ReelAssetBinTab.svelte",
    "ReelEditorApp.svelte",
    "studio-model.ts",
    "StudioAssetBin.svelte",
    "StudioVpsBrowser.svelte",
    "StudioInspector.svelte",
    "MediaStudioApp.svelte",
  ];
  for (const name of ownedFiles) {
    const content = readFileSync(path.join(CREATIVE_DIR, name), "utf8");
    const lines = content.split("\n");
    assert.ok(lines.length <= 250, `${name} exceeds 250 lines (${lines.length})`);
    assert.equal(/{@html\b/.test(content), false, `${name} must not use {@html}`);
    assert.equal(/\bwindow\.(confirm|alert|prompt)\s*\(/.test(content), false, `${name} must not use window dialogs`);
    assert.equal(/\b(localStorage|sessionStorage)\./.test(content), false, `${name} must not use web storage`);
    assert.equal(content.includes("\u2014"), false, `${name} must not contain em dash`);
    for (let i = 0; i < lines.length; i += 1) {
      assert.ok(lines[i]!.length <= 400, `${name}:${i + 1} exceeds 400 chars`);
    }
  }
});
