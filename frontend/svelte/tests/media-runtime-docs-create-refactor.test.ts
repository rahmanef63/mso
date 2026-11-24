import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parentDirectory, joinPath, isPreviewable, readMediaSiblings, stepSibling, siblingIndex,
} from "../src/lib/media/media-siblings.ts";
import { clampZoom, formatBytes, formatSeconds, fileNameOf, ZOOM_MAX, ZOOM_MIN } from "../src/lib/media/media-format.ts";
import { iconPath, iconSvgMarkup, ICON_CATEGORIES } from "../src/lib/media/icon-catalog.ts";
import { ICON_CATALOG } from "../src/lib/media/media-api.ts";
import {
  viewerEmbedSrc, resolveDesktopScreenshotUrl, readCamoufoxStatus, setCamoufoxPower,
} from "../src/lib/runtime-apps/runtime-apps-api.ts";
import { filterGroups, countEntries, STATIC_SECTIONS } from "../src/lib/docs/docs-sections.ts";
import { parseChangelogSections } from "../src/lib/docs/docs-api.ts";
import {
  slugifyAppId, validateDraft, issueFor, categoryFor, tileGlyphPath, launchHint, TILE_CATEGORIES,
} from "../src/lib/create-app/create-app-draft.ts";

const signal = new AbortController().signal;
const bridge = { surface: "web" as const, apiBaseOrigin: null };
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("media viewer, pickers, runtime apps, docs, and create app render without raw HTML or native dialogs", () => {
  const sources: Record<string, string> = {
    MediaViewerApp: read("media/MediaViewerApp.svelte"),
    IconPickerPanel: read("media/IconPickerPanel.svelte"),
    ImagePickerPanel: read("media/ImagePickerPanel.svelte"),
    PickersApp: read("media/PickersApp.svelte"),
    CamoufoxApp: read("runtime-apps/CamoufoxApp.svelte"),
    BotDesktopsApp: read("runtime-apps/BotDesktopsApp.svelte"),
    N8nApp: read("runtime-apps/N8nApp.svelte"),
    DocsApp: read("docs/DocsApp.svelte"),
    CreateAppView: read("create-app/CreateAppView.svelte"),
  };
  for (const [name, source] of Object.entries(sources)) {
    assert.equal(source.includes("{@html"), false, `${name} must not use {@html}`);
    assert.equal(/\bwindow\.(?:confirm|alert|prompt)\(/.test(source), false, `${name} must not use native dialogs`);
    assert.equal(source.includes("localStorage"), false, `${name} must not touch localStorage`);
    assert.equal(source.includes("sessionStorage"), false, `${name} must not touch sessionStorage`);
    assert.equal(source.includes("\u2014"), false, `${name} must not contain U+2014`);
    const longLines = source.split("\n").filter((line) => line.length > 400);
    assert.deepEqual(longLines, [], `${name} must not contain lines over 400 chars`);
  }
});

test("sibling helpers page through previewable files and wrap at both ends", () => {
  assert.equal(parentDirectory("/home/rahman/Pictures/a.png"), "/home/rahman/Pictures");
  assert.equal(parentDirectory("/a.png"), "/");
  assert.equal(parentDirectory("a.png"), "~");
  assert.equal(joinPath("/srv/assets", "b.jpg"), "/srv/assets/b.jpg");
  assert.equal(joinPath("~", "b.jpg"), "~/b.jpg");
  assert.equal(joinPath("/", "b.jpg"), "/b.jpg");

  assert.equal(isPreviewable("image"), true);
  assert.equal(isPreviewable("audio"), true);
  assert.equal(isPreviewable("video"), true);
  assert.equal(isPreviewable("text"), true);
  assert.equal(isPreviewable("unsupported"), false);

  const items = [
    { path: "/p/a.png", name: "a.png", kind: "image" as const },
    { path: "/p/b.mp3", name: "b.mp3", kind: "audio" as const },
    { path: "/p/c.mp4", name: "c.mp4", kind: "video" as const },
  ];
  assert.equal(stepSibling(items, "/p/a.png", "a.png", 1)?.name, "b.mp3");
  assert.equal(stepSibling(items, "/p/a.png", "a.png", -1)?.name, "c.mp4");
  assert.equal(stepSibling([items[0]!], "/p/a.png", "a.png", 1), null);
  assert.equal(stepSibling(items, "/p/zz.png", "zz.png", 1), null);
  assert.equal(siblingIndex(items, "/p/b.mp3", "b.mp3"), 1);
});

test("readMediaSiblings lists only previewable files and normalizes paths", async () => {
  const fetcher: typeof fetch = async (input) => {
    assert.equal(String(input), "/api/v1/fs/list?path=%2Fpics");
    return Response.json({
      path: "/pics",
      entries: [
        { name: "shot.png", kind: "file", size: 10 },
        { name: "clip.mp4", kind: "file", size: 20 },
        { name: "notes.txt", kind: "file", size: 30 },
        { name: "bundle.zip", kind: "file", size: 40 },
        { name: "nested", kind: "dir", size: 0 },
      ],
    });
  };
  const items = await readMediaSiblings("/pics/shot.png", signal, fetcher, bridge);
  assert.deepEqual(items.map((item) => item.name), ["shot.png", "clip.mp4", "notes.txt"]);
  assert.equal(items[0]?.path, "/pics/shot.png");
});

test("zoom, byte, time, and name formatters clamp to safe ranges", () => {
  assert.equal(clampZoom(0.01), ZOOM_MIN);
  assert.equal(clampZoom(99), ZOOM_MAX);
  assert.equal(clampZoom(1.234), 1.23);
  assert.equal(clampZoom(Number.NaN), 1);
  assert.equal(formatSeconds(0), "0:00");
  assert.equal(formatSeconds(125.4), "2:05");
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(fileNameOf("/a/b/c.png"), "c.png");
  assert.equal(fileNameOf("C:\\media\\clip.mp4"), "clip.mp4");
});

test("icon catalog covers every icon id with SVG markup and category tabs", () => {
  for (const icon of ICON_CATALOG) {
    assert.ok(iconPath(icon.id).length > 5, `missing path for ${icon.id}`);
    assert.ok(ICON_CATEGORIES.includes(icon.category as (typeof ICON_CATEGORIES)[number]), `missing tab for ${icon.category}`);
  }
  assert.equal(iconSvgMarkup("home").includes("<svg"), true);
  assert.equal(iconSvgMarkup("home", 48).includes('width="48"'), true);
  assert.equal(iconPath("not-a-real-icon"), iconPath("image"));
});

test("viewerEmbedSrc builds a noVNC socket URL and rejects non-http hrefs", () => {
  assert.equal(
    viewerEmbedSrc("https://vnc.example.com/_mso-camoufox"),
    "https://vnc.example.com/_mso-camoufox/vnc.html?path=_mso-camoufox%2Fwebsockify&autoconnect=1&resize=remote",
  );
  assert.equal(
    viewerEmbedSrc("http://127.0.0.1:6080"),
    "http://127.0.0.1:6080/vnc.html?path=websockify&autoconnect=1&resize=remote",
  );
  assert.equal(viewerEmbedSrc(null), null);
  assert.equal(viewerEmbedSrc("not a url"), null);
});

test("docs sections filter by heading and entry text and count entries", () => {
  assert.equal(STATIC_SECTIONS.length, 3);
  assert.equal(countEntries(STATIC_SECTIONS[0]!.groups) > 0, true);
  const all = STATIC_SECTIONS.flatMap((section) => section.groups);
  assert.equal(filterGroups(all, "").length, all.length);
  const auth = filterGroups(all, "operator");
  assert.ok(auth.some((group) => group.entries.some((entry) => /Operator/.test(entry.body))));
  assert.deepEqual(filterGroups(all, "zzzz-no-match"), []);
  const headingOnly = filterGroups(all, "windows and apps");
  assert.equal(headingOnly.length, 1);
});

test("changelog parsing feeds the docs reader without injecting markup", () => {
  const sections = parseChangelogSections("## v1.2.0\n**Shell**\n- Added `docs` reader\n- Fixed **dock** focus\n## v1.1.0\n- Old note");
  assert.equal(sections.length, 2);
  assert.deepEqual(sections[0]?.items, ["Shell: Added docs reader", "Shell: Fixed dock focus"]);
  assert.equal(sections[0]?.heading, "v1.2.0");
});

test("create app draft validation reports every field issue in form order", () => {
  const empty = validateDraft({ id: "", title: "", description: "", url: "", mode: "embed" });
  assert.deepEqual(empty.map((issue) => issue.field), ["id", "title", "url"]);

  const bad = validateDraft({ id: "BAD ID", title: "x".repeat(121), description: "d".repeat(241), url: "https://a.example/?q=1", mode: "tab" });
  assert.deepEqual(bad.map((issue) => issue.field), ["id", "title", "description", "url"]);
  assert.match(issueFor(bad, "url") ?? "", /plain HTTP or HTTPS/);
  assert.equal(issueFor(bad, "mode" as never), null);

  const good = validateDraft({ id: "notes-app", title: "Notes", description: "Team notes", url: "https://notes.example.com/app", mode: "embed" });
  assert.deepEqual(good, []);
  assert.equal(slugifyAppId("My Fancy App!"), "my-fancy-app");
  assert.equal(slugifyAppId("---"), "");
  assert.equal(slugifyAppId("A".repeat(80)).length, 64);
});

test("tile categories map to a known glyph and launch modes explain themselves", () => {
  assert.equal(categoryFor("analytics").label, "Analytics");
  assert.equal(categoryFor("unknown-category").id, TILE_CATEGORIES[0]!.id);
  for (const category of TILE_CATEGORIES) assert.ok(tileGlyphPath(category).length > 5);
  assert.match(launchHint("embed"), /frame/);
  assert.match(launchHint("tab"), /own origin/);
});

test("runtime app helpers keep existing API contracts intact", async () => {
  const status = await readCamoufoxStatus(signal, async () => Response.json({ running: false, installed: true }));
  assert.equal(status.running, false);
  const started = await setCamoufoxPower("start", signal, async (_input, init) => {
    assert.equal(init?.method, "POST");
    return Response.json({ running: true, viewerReady: false });
  });
  assert.equal(started.running, true);
  assert.equal(
    resolveDesktopScreenshotUrl("bot-a", bridge, ":1"),
    "/api/v1/desktop/screenshot?container=bot-a&screen=%3A1",
  );
  assert.throws(() => resolveDesktopScreenshotUrl("  "), /identifier is required/);
});
