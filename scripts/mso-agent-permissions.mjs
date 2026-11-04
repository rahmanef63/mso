const PERMISSION_MODES = [
  { id: "ask", label: "Ask", detail: "Confirm every write and exec call", tone: "safe" },
  { id: "auto", label: "Auto-write", detail: "Approve writes; still ask before exec", tone: "auto" },
  { id: "yolo", label: "YOLO", detail: "Approve write and exec automatically", tone: "danger" },
];

export function permissionMode(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  const aliases = { a: "ask", ask: "ask", w: "auto", auto: "auto", "auto-write": "auto", y: "yolo", yolo: "yolo" };
  const id = aliases[raw];
  return id ? PERMISSION_MODES.find((mode) => mode.id === id) || null : null;
}

export function nextPermissionMode(current) {
  // An unrecognised mode falls back to the SAFEST one, not to the next one. `Math.max(0, findIndex(...))`
  // made any unknown string resolve to index 0 and then advance to `auto`, so a typo or an old config
  // escalated write approval instead of staying at ask.
  const index = PERMISSION_MODES.findIndex((mode) => mode.id === permissionMode(current)?.id);
  if (index < 0) return PERMISSION_MODES[0];
  return PERMISSION_MODES[(index + 1) % PERMISSION_MODES.length];
}


export function approvesTool(mode, scope) {
  if (scope === "read") return true;
  if (mode === "yolo") return true;
  return mode === "auto" && scope === "write";
}

export function permissionCompletionItems(query = "") {
  const q = String(query || "").trim().toLowerCase();
  return PERMISSION_MODES
    .map((mode) => ({ text: mode.label, label: mode.label, value: mode.id, meta: mode.detail }))
    .filter((item) => !q || `${item.label} ${item.value} ${item.meta}`.toLowerCase().includes(q));
}
