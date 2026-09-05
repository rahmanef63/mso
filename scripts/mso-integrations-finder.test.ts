import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { columns, layer } from "./mso-integrations-finder-model.mjs";
import { cellWidth, frame, shortcutEvent, stripAnsi, visibleColumns } from "./mso-integrations-finder.mjs";

const SECRET = "SYNTHETIC_SECRET_MUST_NEVER_RENDER";
const snap: any = {
  user: "alice",
  users: [{ id: "alice", label: "Alice", isDefault: true, connectionCount: 2 }],
  catalog: [
    { id: "github", title: "GitHub", description: "GitHub account", sources: [
      { id: "direct", label: "MSO direct", methods: [{ id: "direct", label: "Direct credential", scope: "account", fields: [{ key: "apiKey", label: "API key", secret: true, required: true, value: SECRET }] }] },
      { id: "composio", label: "Composio", methods: [{ id: "oauth2", label: "OAuth2", scope: "account", fields: [] }] },
    ] },
    { id: "hostinger", title: "Hostinger", description: "Hostinger VPS, DNS and Mail", sources: [
      { id: "direct", label: "MSO direct", methods: [{ id: "direct", label: "Account API token", scope: "account", fields: [{ key: "apiToken", label: "Account API token", secret: true, required: true }] }] },
    ] },
  ],
  connections: [
    { user: "alice", id: "work", label: "Work GitHub", provider: "github", source: "direct", authMethod: "direct", scope: "account", state: "verified", isDefault: false, fields: [{ key: "apiKey", label: "API key", stored: true, value: SECRET }] },
    { user: "alice", id: "mail", label: "Mail", provider: "hostinger", source: "direct", authMethod: "direct", scope: "account", state: "configured", isDefault: true, fields: [{ key: "apiToken", label: "Account API token", stored: true }] },
  ],
};
const deepStack = ["connections", "user:alice", "provider:github", "connection:work"];
const cellAt = (value: string, target: number) => { let pos = 0; for (const ch of value) { const w = cellWidth(ch); if (pos === target) return ch; if (target > pos && target < pos + w) return ""; pos += w; } return ""; };

it("models Finder ancestry and a populated connection action/inspector column", () => {
  const cols = columns(snap, deepStack);
  expect(cols).toHaveLength(5);
  expect(cols.slice(1).map((x: any) => x.title)).toEqual(["Connections", "Alice", "GitHub", "Work GitHub"]);
  expect(cols.at(-1)?.items.map((x: any) => x.id)).toEqual(expect.arrayContaining(["action:setup", "action:verify", "action:route", "action:connection-delete"]));
  expect(cols.at(-1)?.items.find((x: any) => x.id === "action:verify")?.preview.some((line: string) => line.includes("State: verified"))).toBe(true);
});

it("uses 4/3/2/1 Finder panes by terminal width without placeholder columns", () => {
  const cols = columns(snap, deepStack);
  expect(visibleColumns(cols, 150).map((x: any) => x.title)).toEqual(["Connections", "Alice", "GitHub", "Work GitHub"]);
  expect(visibleColumns(cols, 110)).toHaveLength(3);
  expect(visibleColumns(cols, 80)).toHaveLength(2);
  expect(visibleColumns(cols, 60)).toHaveLength(1);
  const root = frame({ snapshot: snap, stack: [], activity: [] }, { cols: 150, rows: 40 }).lines.map(stripAnsi);
  const top = root.find((line: string) => line.startsWith("┌"))!;
  expect(top.match(/┬/g) ?? []).toHaveLength(0);
});

it.each([[60,20],[80,24],[100,30],[120,32],[150,40],[200,50]])("keeps every %ix%i frame within the terminal and borders continuous", (cols, rows) => {
  const built = frame({ snapshot: snap, stack: deepStack, activity: [] }, { cols, rows });
  const plain = built.lines.map(stripAnsi);
  expect(plain).toHaveLength(rows);
  for (const line of plain) expect(cellWidth(line)).toBeLessThanOrEqual(cols - 1);
  const topIndex = plain.findIndex((line: string) => line.startsWith("┌"));
  const bottomIndex = plain.findIndex((line: string, i: number) => i > topIndex && line.startsWith("└"));
  expect(topIndex).toBeGreaterThanOrEqual(0); expect(bottomIndex).toBeGreaterThan(topIndex);
  const top = plain[topIndex];
  const boundaries = [0, ...[...top].map((ch, i) => ch === "┬" ? i : -1).filter((i) => i >= 0), top.length - 1];
  for (let i = topIndex + 1; i < bottomIndex; i++) {
    const row = plain[i];
    if (!row.startsWith("│")) continue;
    expect(boundaries.every((x) => cellAt(row, x) === "│")).toBe(true);
  }
});

it("renders MSO shell chrome, path, inspector, status and never secret-shaped values", () => {
  const text = frame({ snapshot: snap, stack: deepStack, activity: [] }, { cols: 150, rows: 40 }).lines.map(stripAnsi).join("\n");
  for (const label of ["MSO  Integrations", "SECTIONS", "PATH", "Connections", "Alice", "GitHub", "Work GitHub", "INSPECTOR", "verified", "Ctrl-D quit"]) expect(text).toContain(label);
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain("value:");
});

it("new connection and transfer flows remain modeled as Finder branches", () => {
  expect(layer(snap, ["connections", "user:alice", "provider:github", "new"]).map((x: any) => x.id)).toEqual(["source:direct", "source:composio"]);
  expect(layer(snap, ["connections", "user:alice", "provider:github", "new", "source:direct"]).map((x: any) => x.id)).toEqual(["auth:direct"]);
  expect(layer(snap, ["transfer"]).map((x: any) => x.id)).toEqual(["action:transfer:metadata", "action:transfer:encrypted", "action:transfer:import", "action:transfer:schema"]);
});

it("exposes context-aware keyboard shortcuts without turning ordinary keys into secrets", () => {
  const config: any = { snapshot: snap, stack: deepStack };
  expect(shortcutEvent("v", config)).toEqual({ type: "shortcut", id: "verify" });
  expect(shortcutEvent("s", config)).toEqual({ type: "shortcut", id: "setup" });
  expect(shortcutEvent("2", config)).toEqual({ type: "section", id: "users" });
  expect(shortcutEvent("?", config)).toEqual({ type: "shortcut", id: "help" });
  expect(shortcutEvent("x", config)).toBeNull();
});

it("sanitizes secret-shaped snapshot fields before the private temp config and removes it", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mso-finder-safe-"));
  const captured = path.join(dir, "config.json"), marker = path.join(dir, "path.txt");
  execFileSync("bash", [path.join(__dirname, "test-support/integrations-finder-sanitize-harness.sh")], { env: { ...process.env, MSO_CAPTURE_CONFIG: captured, MSO_CAPTURE_PATH: marker } });
  const text = readFileSync(captured, "utf8");
  expect(text).not.toContain("SYNTHETIC_SECRET_NEVER_TEMP");
  expect(JSON.parse(text).snapshot.connections[0]).toMatchObject({ id: "x", stored: true });
});

it("Transfer surfaces auto-detected SI-Coder metadata without implying secret sync",()=>{const detected={...snap,scMigration:{available:true,producer:"si-coder",userCount:6,connectionCount:20,mode:"metadata"}};const rows=layer(detected,["transfer"]);expect(rows[0]).toMatchObject({id:"action:transfer:sc",label:"Import from SI-Coder"});expect(rows[0].hint).toContain("6 users");expect(rows[0].preview.join(" ")).toContain("no credential values");});
it("root Transfer announces local SI-Coder discovery without applying anything",()=>{const detected={...snap,scMigration:{available:true,producer:"si-coder",userCount:6,connectionCount:20,mode:"metadata"}};const transfer=layer(detected,[]).find((x:any)=>x.id==="transfer");expect(transfer).toMatchObject({badge:"SC"});expect(transfer.hint).toContain("SI-Coder detected");expect(transfer.preview.join(" ")).toContain("never auto-copied");});
