import type { AgentVaultNote } from "./agent-vault-api.ts";

export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[]; count: number }
  | { kind: "note"; name: string; path: string; note: AgentVaultNote };

function dirNode(name: string, path: string): Extract<TreeNode, { kind: "dir" }> {
  return { kind: "dir", name, path, children: [], count: 0 };
}

/** Builds a collapsible folder tree from snapshot note paths, sorted dirs first then notes. */
export function buildTree(notes: AgentVaultNote[]): TreeNode[] {
  const root = dirNode("", "");
  for (const note of notes) {
    const parts = note.path.split("/").filter(Boolean);
    let cursor = root;
    cursor.count++;
    for (let index = 0; index < parts.length - 1; index++) {
      const name = parts[index]!;
      const path = parts.slice(0, index + 1).join("/");
      let next = cursor.children.find((child): child is Extract<TreeNode, { kind: "dir" }> =>
        child.kind === "dir" && child.name === name);
      if (!next) {
        next = dirNode(name, path);
        cursor.children.push(next);
      }
      next.count++;
      cursor = next;
    }
    cursor.children.push({
      kind: "note", name: parts[parts.length - 1] ?? note.path, path: note.path, note,
    });
  }
  sortLevel(root.children);
  return root.children;
}

function sortLevel(children: TreeNode[]): void {
  children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of children) if (child.kind === "dir") sortLevel(child.children);
}

/** Expands every ancestor directory of `path` so the selected note is visible. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, Math.max(0, parts.length - 1)).map((_part, index) => parts.slice(0, index + 1).join("/"));
}

export type FlatRow =
  | { kind: "dir"; path: string; name: string; depth: number; count: number; open: boolean }
  | { kind: "note"; path: string; name: string; depth: number; note: AgentVaultNote };

/** Flattens the tree for keyboard-reachable rendering; collapsed folders hide their subtree. */
export function flattenTree(nodes: TreeNode[], collapsed: string[], depth = 0, out: FlatRow[] = []): FlatRow[] {
  for (const node of nodes) {
    if (node.kind === "dir") {
      const open = !collapsed.includes(node.path);
      out.push({ kind: "dir", path: node.path, name: node.name, depth, count: node.count, open });
      if (open) flattenTree(node.children, collapsed, depth + 1, out);
    } else {
      out.push({ kind: "note", path: node.path, name: node.name, depth, note: node.note });
    }
  }
  return out;
}
