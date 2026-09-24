// Graph assembly inspired by rahmanef63/open-silong memory-graph (MIT):
// unresolved [[wikilinks]] become ghost nodes, and links are undirected for
// neighbourhood queries. MSO supplies the notes; this file does not copy that UI.

import type { GraphInputLink, GraphInputNode, MemoryGraphDocument, MemoryGraphEdge, MemoryGraphNode } from "./types";

const WIKILINK_RE = /\[\[([^\]|#^]+?)(?:\|[^\]]+)?\]\]/g;
const TAG_RE = /(?:^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]{0,40})/g;
const HREF_RE = /\[[^\]]*]\(([^)\s]+)\)/g;

export function slug(title: string): string {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
}

export function extractNoteLinks(text: string): { wikilinks: string[]; hrefs: string[]; tags: string[] } {
  const wikilinks: string[] = [];
  const hrefs: string[] = [];
  const tags: string[] = [];
  for (const match of text.matchAll(WIKILINK_RE)) {
    const title = (match[1] ?? "").trim();
    if (title) wikilinks.push(title);
  }
  for (const match of text.matchAll(HREF_RE)) {
    const href = (match[1] ?? "").trim();
    if (href && !/^[a-z]+:/i.test(href)) hrefs.push(href);
  }
  for (const match of text.matchAll(TAG_RE)) if (match[1]) tags.push(match[1]);
  return { wikilinks, hrefs, tags };
}

export function neighbourhood(edges: MemoryGraphEdge[], rootId: string, depth: number): Set<string> {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    adj.set(edge.source, [...(adj.get(edge.source) ?? []), edge.target]);
    adj.set(edge.target, [...(adj.get(edge.target) ?? []), edge.source]);
  }
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adj.get(id) ?? []) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return seen;
}

function stemOf(id: string): string {
  return id.replace(/^(note|knowledge|memory|agent|folder|project):/, "");
}

function indexes(nodes: GraphInputNode[]) {
  const bySlug = new Map<string, string[]>();
  const byStem = new Map<string, string>();
  const byBase = new Map<string, string[]>();
  for (const node of nodes) {
    const titleSlug = slug(node.title);
    bySlug.set(titleSlug, [...(bySlug.get(titleSlug) ?? []), node.id]);
    const stem = stemOf(node.id).replace(/\.md$/i, "").toLowerCase();
    byStem.set(stem, node.id);
    byStem.set(slug(stem), node.id);
    const base = slug(stem.split("/").pop() ?? stem);
    byBase.set(base, [...(byBase.get(base) ?? []), node.id]);
  }
  return { bySlug, byStem, byBase };
}

function unique(ids: string[] | undefined): string | null {
  return ids && ids.length === 1 ? ids[0] : null;
}

function resolveWikilink(raw: string, index: ReturnType<typeof indexes>): string | null {
  const clean = raw.trim().replace(/\.md$/i, "");
  const key = clean.toLowerCase();
  return index.byStem.get(key) ?? index.byStem.get(slug(clean)) ?? unique(index.byBase.get(slug(clean.split("/").pop() ?? clean))) ?? unique(index.bySlug.get(slug(clean)));
}

function resolveHref(raw: string, source: GraphInputNode, index: ReturnType<typeof indexes>): string | null {
  const noHash = raw.split("#")[0]?.split("?")[0] ?? "";
  if (!noHash.toLowerCase().endsWith(".md")) return null;
  const sourceStem = stemOf(source.id).replace(/\.md$/i, "");
  const dir = sourceStem.includes("/") ? sourceStem.slice(0, sourceStem.lastIndexOf("/")) : "";
  const parts = `${dir}/${noHash}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const joined = stack.join("/").replace(/\.md$/i, "").toLowerCase();
  return index.byStem.get(joined) ?? null;
}

function pushEdge(edges: MemoryGraphEdge[], seen: Set<string>, edge: MemoryGraphEdge) {
  if (edge.source === edge.target) return;
  const key = `${edge.kind}|${edge.source}|${edge.target}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push(edge);
}

export function assembleMemoryGraph(
  inputs: GraphInputNode[],
  links: GraphInputLink[],
  options: { includeGhosts?: boolean; includeTags?: boolean } = {},
): Pick<MemoryGraphDocument, "nodes" | "edges" | "counts"> {
  const includeGhosts = options.includeGhosts ?? true;
  const includeTags = options.includeTags ?? true;
  const index = indexes(inputs);
  const nodes = new Map<string, MemoryGraphNode>();
  for (const input of inputs) {
    const { text: _text, ...rest } = input;
    nodes.set(input.id, { ...rest, degree: 0 });
  }
  const edges: MemoryGraphEdge[] = [];
  const seen = new Set<string>();
  const tagCount = { n: 0 };

  const addTag = (source: string, tag: string) => {
    if (!includeTags || tagCount.n > 40) return;
    const id = `tag:${tag.toLowerCase()}`;
    if (!nodes.has(id)) {
      tagCount.n += 1;
      nodes.set(id, { id, title: `#${tag}`, kind: "tag", group: "Tags", degree: 0 });
    }
    pushEdge(edges, seen, { source, target: id, kind: "tag", resolved: true });
  };

  for (const input of inputs) {
    if (!input.text) continue;
    const extracted = extractNoteLinks(input.text);
    for (const title of extracted.wikilinks) {
      const target = resolveWikilink(title, index);
      if (target) pushEdge(edges, seen, { source: input.id, target, kind: "wikilink", resolved: true });
      else if (includeGhosts) {
        const id = `ghost:${slug(title)}`;
        if (!nodes.has(id)) nodes.set(id, { id, title, kind: "ghost", group: "Unresolved", degree: 0 });
        pushEdge(edges, seen, { source: input.id, target: id, kind: "wikilink", resolved: false });
      }
    }
    for (const href of extracted.hrefs) {
      const target = resolveHref(href, input, index);
      if (target) pushEdge(edges, seen, { source: input.id, target, kind: "mention", resolved: true });
    }
    for (const tag of extracted.tags) addTag(input.id, tag);
  }

  for (const link of links) {
    const target = link.targetId ?? (link.target ? resolveWikilink(link.target, index) : null);
    if (!target || !nodes.has(link.source) || !nodes.has(target)) continue;
    pushEdge(edges, seen, { source: link.source, target, kind: link.kind, resolved: true });
  }

  for (const edge of edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (source) source.degree += 1;
    if (target) target.degree += 1;
  }
  const nodeList = [...nodes.values()];
  return {
    nodes: nodeList,
    edges,
    counts: {
      notes: nodeList.filter((node) => node.kind === "note" || node.kind === "knowledge").length,
      memories: nodeList.filter((node) => node.kind === "memory" || node.kind === "agent").length,
      ghosts: nodeList.filter((node) => node.kind === "ghost").length,
    },
  };
}
