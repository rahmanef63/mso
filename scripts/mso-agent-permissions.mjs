export const PERMISSION_MODES = [
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
  const index = Math.max(0, PERMISSION_MODES.findIndex((mode) => mode.id === current));
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
