import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeBounds, groupColor, neighbourhood, placeNodes, ringDepths,
} from "../src/lib/memory-graph/memory-graph-layout.ts";
import {
  connector, layoutSeats, layoutUnits,
} from "../src/lib/organization/org-layout.ts";
import {
  draftTarget, emptySeatDraft, emptyUnitDraft, seatDraftFrom, unitDraftFrom,
  validateSeatDraft, validateUnitDraft,
} from "../src/lib/organization/org-mutations.ts";
import {
  createAgentGroup, deleteAgentGroup, emptyDraft, updateAgentGroup, validateDraft,
} from "../src/lib/agent-group/agent-group-mutations.ts";
import { parseInline, parseMarkdown, frontmatter, stripFrontmatter } from "../src/lib/agent-vault/markdown.ts";
import { backlinksOf, normalizePath, outgoingLinks, resolveNoteLink, safeExternalLink } from "../src/lib/agent-vault/note-links.ts";
import { ancestorsOf, buildTree, flattenTree } from "../src/lib/agent-vault/vault-tree.ts";
import {
  chart, graphEdges, graphNodes, jsonOf, notes, signal, unit,
} from "./memory-org-agents-refactor-fixtures.ts";

/* ---------- Memory graph layout ---------- */

test("memory graph layout is deterministic for every placement mode", () => {
  for (const layout of ["web", "radial", "layered"] as const) {
    const first = placeNodes(graphNodes, graphEdges, layout);
    const second = placeNodes(graphNodes, graphEdges, layout);
    assert.equal(first.size, graphNodes.length);
    for (const [id, point] of first) {
      const repeat = second.get(id)!;
      assert.equal(point.x, repeat.x, `${layout} x drift on ${id}`);
      assert.equal(point.y, repeat.y, `${layout} y drift on ${id}`);
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    }
  }
});

test("ring depth starts at the highest degree node and keeps orphans reachable", () => {
  const { pivot, ring } = ringDepths(graphNodes, graphEdges);
  assert.deepEqual([pivot, ring.get("a"), ring.get("b"), ring.get("c"), ring.get("z")], ["a", 0, 1, 1, 2]);
});

test("bounds always describe a drawable viewport, even with no nodes", () => {
  for (const box of [computeBounds(new Map()), computeBounds(placeNodes(graphNodes, graphEdges, "radial"))]) {
    assert.ok(box.w > 0 && box.h > 0);
  }
});

test("group color and neighbourhood stay inside the shipped palette and graph", () => {
  assert.match(groupColor("docs", ["docs", "unlinked"]), /^color-mix\(in srgb, var\(--accent\) \d+%, var\(--panel-solid\)\)$/);
  assert.deepEqual([[...neighbourhood(graphEdges, "b", 1)].sort(), [...neighbourhood(graphEdges, "b", 2)].sort()], [["a", "b"], ["a", "b", "c"]]);
});

/* ---------- Organization layout and drafts ---------- */

test("org layout nests units by depth and never leaves a dangling parent", () => {
  const placed = layoutUnits(chart, { maxColumns: 3 });
  assert.equal(placed.length, 3);
  const byId = new Map(placed.map((entry) => [entry.item.id, entry]));
  assert.equal(byId.get("root")!.depth, 0);
  assert.equal(byId.get("child")!.depth, 1);
  assert.equal(byId.get("grand")!.depth, 2);
  assert.ok(byId.get("grand")!.y > byId.get("child")!.y);

  // Cyclic parent data must not recurse forever.
  assert.equal(layoutUnits({ ...chart, units: [unit("x", "y"), unit("y", "x")], seats: [] }).length, 2);
});

test("seat layout pulls in cross-unit parents and marks them external", () => {
  const placed = layoutSeats(chart, "child");
  const ids = placed.map((entry) => entry.item.id).sort();
  assert.deepEqual(ids, ["s1", "s3"]);
  assert.equal(placed.find((entry) => entry.item.id === "s1")!.external, true);
  assert.equal(placed.find((entry) => entry.item.id === "s3")!.external, false);
});

test("connector is an orthogonal elbow between parent and child", () => {
  const path = connector(0, 0, 100, 80);
  assert.equal(path, "M 0 0 L 0 40 L 100 40 L 100 80");
});

test("org drafts convert to API payloads and reject invalid input early", () => {
  const unitDraft = unitDraftFrom(chart.units[1]!);
  assert.equal(unitDraft.parentUnitId, "root");
  assert.equal(validateUnitDraft(unitDraft), null);
  assert.match(String(validateUnitDraft({ ...emptyUnitDraft(), name: " " })), /unit name/);
  assert.match(String(validateUnitDraft({ ...emptyUnitDraft(), name: "N", key: "Bad Key" })), /lowercase/);

  const seatDraft = seatDraftFrom(chart.seats[1]!);
  assert.equal(seatDraft.reportsToSeatId, "s1");
  assert.equal(validateSeatDraft(seatDraft), null);
  assert.match(String(validateSeatDraft(emptySeatDraft())), /unit/);
  assert.match(
    String(validateSeatDraft({ ...emptySeatDraft("root"), name: "A", title: "T", role: "R", targetKind: "local-agent", targetRef: " " })),
    /agent reference/,
  );
  assert.deepEqual(draftTarget({ ...emptySeatDraft(), targetKind: "none" }), { kind: "none" });
  assert.deepEqual(
    draftTarget({ ...emptySeatDraft(), targetKind: "project-agent", targetRef: " mso " }),
    { kind: "project-agent", project: "mso" },
  );
});

/* ---------- Agent group drafts and mutations ---------- */

test("agent group draft validation catches empty names, profiles, and round bounds", () => {
  assert.match(String(validateDraft(emptyDraft())), /group name/);
  assert.match(String(validateDraft({ ...emptyDraft(), name: "Council", members: [] })), /at least one agent/);
  assert.match(String(validateDraft({ ...emptyDraft(), name: "Council", members: [{ name: "A", profile: " " }] })), /Hermes profile/);
  assert.match(String(validateDraft({ ...emptyDraft(), name: "Council", maxRounds: 0 })), /between 1 and 20/);
  assert.equal(validateDraft({ ...emptyDraft(), name: "Council", members: [{ name: "A", profile: "architect" }] }), null);
});

test("agent group mutations post the documented action payloads", async () => {
  const created: Array<Record<string, unknown>> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    created.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "grp-1", name: "Council", members: [], maxRounds: 1, enabled: true, createdAt: "t", updatedAt: "t", runs: [] });
  };
  const draft = { ...emptyDraft(), name: "Council", members: [{ name: "A", profile: "architect" }] };
  const view = await createAgentGroup(draft, signal, fetcher);
  assert.equal(view.id, "grp-1");
  assert.deepEqual(created[0], {
    action: "create",
    data: { name: "Council", maxRounds: 1, enabled: true, members: [{ id: "m1", name: "A", profile: "architect" }] },
  });

  await updateAgentGroup({ ...draft, id: "grp-1" }, 4, signal, fetcher);
  assert.equal(created[1]!.action, "update");
  assert.equal(created[1]!.id, "grp-1");
  assert.equal(created[1]!.expectedRevision, 4);

  await deleteAgentGroup("grp-1", 5, signal, jsonOf({ ok: true }));
  await assert.rejects(createAgentGroup(emptyDraft(), signal, fetcher), /group name/);
});

test("agent group mutation errors map revision conflicts and owner requirements", async () => {
  const valid = { ...emptyDraft(), name: "C", id: "g", members: [{ name: "A", profile: "p" }] };
  const conflict: typeof fetch = async () => Response.json({ error: "agent_group_revision_changed" }, { status: 409 });
  await assert.rejects(updateAgentGroup(valid, 1, signal, conflict), /changed on another device/);
  const forbidden: typeof fetch = async () => Response.json({ error: "owner_required" }, { status: 403 });
  await assert.rejects(deleteAgentGroup("g", 1, signal, forbidden), /Owner role is required/);
});

/* ---------- Agent vault markdown, links, and tree ---------- */

test("markdown parses headings, lists, fences, quotes, and rules without HTML", () => {
  const blocks = parseMarkdown(
    "---\ntitle: Ignored\n---\n# Title **bold**\n- one\n- two\n\n> quoted\n\n```ts\nconst x = 1;\n```\n\n---\n\n<script>alert(1)</script>",
  );
  assert.equal(blocks[0]!.kind, "heading");
  assert.deepEqual(blocks[1], {
    kind: "list", ordered: false,
    items: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }]],
  });
  assert.deepEqual(blocks[2], { kind: "quote", inline: [{ kind: "text", text: "quoted" }] });
  assert.deepEqual(blocks[3], { kind: "code", lang: "ts", code: "const x = 1;" });
  assert.equal(blocks[4]!.kind, "rule");
  // Raw HTML stays literal text; it is never promoted to a markup block.
  assert.deepEqual(blocks[5], { kind: "paragraph", inline: [{ kind: "text", text: "<script>alert(1)</script>" }] });
});

test("inline parsing keeps wikilinks, markdown lines, code, and embeds inert", () => {
  const parts = parseInline("Read [[Plan|the plan]] and [docs](https://example.com) `code` **bold** *em* ![img](a.png)");
  const kinds = parts.map((part) => part.kind);
  assert.deepEqual(kinds, ["text", "link", "text", "link", "text", "code", "text", "strong", "text", "em", "text", "image"]);
  const wiki = parts.find((part) => part.kind === "link" && part.wiki);
  assert.deepEqual(wiki, { kind: "link", label: "the plan", target: "Plan", wiki: true });
  assert.equal(parseInline("![x](y.png)")[0]!.kind, "image");
});

test("frontmatter and body stripping stay separate concerns", () => {
  const content = "---\ntitle: Note\ntags: a, b\ncontinuation\n---\n# Body";
  assert.deepEqual(frontmatter(content), [{ key: "title", value: "Note" }, { key: "tags", value: "a, b continuation" }]);
  assert.equal(stripFrontmatter(content), "# Body");
  assert.deepEqual(frontmatter("no frontmatter"), []);
});

test("note links resolve inside the snapshot only and reject hostile targets", () => {
  assert.equal(normalizePath("A/./B/../C.md"), "a/c");
  assert.equal(resolveNoteLink(notes, notes[0]!.path, "Plan", true)?.path, notes[1]!.path);
  assert.equal(resolveNoteLink(notes, notes[1]!.path, "../overview/Beranda.md")?.path, notes[0]!.path);
  assert.equal(resolveNoteLink(notes, notes[1]!.path, "../../../../etc/passwd"), undefined);
  assert.equal(resolveNoteLink(notes, notes[1]!.path, "/etc/passwd"), undefined);
  assert.equal(resolveNoteLink(notes, notes[1]!.path, "javascript:alert(1)"), undefined);
  assert.equal(resolveNoteLink(notes, notes[1]!.path, "https://example.com"), undefined);
  assert.equal(safeExternalLink("https://example.com/a"), "https://example.com/a");
  assert.equal(safeExternalLink("javascript:alert(1)"), undefined);
  assert.equal(safeExternalLink("https://user:pass@example.com"), undefined);
});

test("outgoing links and backlinks are bounded by snapshot notes", () => {
  assert.deepEqual(outgoingLinks("[[A]] [[A|x]] [[B]]"), ["A", "B"]);
  const contents = new Map<string, string>([[notes[1]!.path, "Links to [[Beranda]]"], [notes[2]!.path, "Links to [[Plan]]"]]);
  const back = backlinksOf(notes, contents, notes[0]!.path);
  assert.deepEqual(back.map((entry) => entry.path), [notes[1]!.path]);
});

test("vault tree groups folders, sorts dirs before notes, and honours collapse", () => {
  const tree = buildTree(notes);
  assert.equal(tree.length, 1);
  assert.equal(tree[0]!.kind, "dir");
  const root = tree[0] as Extract<ReturnType<typeof buildTree>[number], { kind: "dir" }>;
  assert.equal(root.name, "Snapshots");
  assert.equal(root.count, 3);
  const snap = root.children[0] as Extract<ReturnType<typeof buildTree>[number], { kind: "dir" }>;
  assert.equal(snap.name, "snap-1");
  assert.deepEqual(snap.children.map((child) => child.name), ["overview", "progress"]);

  const flat = flattenTree(tree, []);
  assert.ok(flat.some((row) => row.kind === "note" && row.path === notes[0]!.path));
  const collapsed = flattenTree(tree, ["Snapshots/snap-1/overview"]);
  assert.ok(!collapsed.some((row) => row.kind === "note" && row.path === notes[0]!.path));
  assert.deepEqual(ancestorsOf(notes[0]!.path), ["Snapshots", "Snapshots/snap-1", "Snapshots/snap-1/overview"]);
});
