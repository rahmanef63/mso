function clean(value) { return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim(); }

function modifiedMs(row) {
  const value = Date.parse(String(row?.updatedAt || row?.createdAt || ""));
  return Number.isFinite(value) ? value : 0;
}

export function formatSessionModified(value, now = Date.now()) {
  const at = Date.parse(String(value || ""));
  if (!Number.isFinite(at)) return "recently";
  const diff = Math.max(0, Number(now) - at);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))}h ago`;
  if (diff < 604_800_000) return `${Math.max(1, Math.floor(diff / 86_400_000))}d ago`;
  return new Date(at).toISOString().slice(0, 10);
}

export function sessionPromptHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter((row) => row?.role === "user" && typeof row.text === "string" && row.text.trim())
    .map((row) => clean(row.text))
    .reverse()
    .slice(0, 100);
}

export function resolveSessionQuery(rows, query) {
  const sessions = (Array.isArray(rows) ? rows : []).slice().sort((a, b) => modifiedMs(b) - modifiedMs(a));
  if (!sessions.length) return { session: null, ambiguous: [], reason: "empty" };
  const raw = clean(query);
  if (!raw || raw.toLowerCase() === "latest" || raw.toLowerCase() === "continue") return { session: sessions[0], ambiguous: [] };
  if (/^\d+$/.test(raw)) {
    const index = Number(raw) - 1;
    return { session: sessions[index] || null, ambiguous: [], reason: sessions[index] ? undefined : "index" };
  }
  const lower = raw.toLowerCase();
  const exactId = sessions.find((row) => String(row.id) === raw);
  if (exactId) return { session: exactId, ambiguous: [] };
  const wantedName = lower.replace(/^@/, "");
  const exactName = sessions.filter((row) => clean(row.name).toLowerCase() === wantedName);
  if (exactName.length === 1) return { session: exactName[0], ambiguous: [] };
  if (exactName.length > 1) return { session: null, ambiguous: exactName, reason: "ambiguous" };
  const idPrefix = sessions.filter((row) => String(row.id).toLowerCase().startsWith(lower) || String(row.id).toLowerCase().endsWith(lower));
  if (idPrefix.length === 1) return { session: idPrefix[0], ambiguous: [] };
  if (idPrefix.length > 1) return { session: null, ambiguous: idPrefix, reason: "ambiguous" };
  const exactTitle = sessions.filter((row) => clean(row.title).toLowerCase() === lower);
  if (exactTitle.length === 1) return { session: exactTitle[0], ambiguous: [] };
  if (exactTitle.length > 1) return { session: null, ambiguous: exactTitle, reason: "ambiguous" };
  const fuzzy = sessions.filter((row) => clean(row.title).toLowerCase().includes(lower));
  if (fuzzy.length === 1) return { session: fuzzy[0], ambiguous: [] };
  if (fuzzy.length > 1) return { session: null, ambiguous: fuzzy, reason: "ambiguous" };
  return { session: null, ambiguous: [], reason: "not_found" };
}

export function visibleSessionRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const emptyDefaultCli = row?.source === "cli" && Number(row?.historyTurns || 0) === 0
      && clean(row?.title) === "MSO Agent session" && ["default", "manual"].includes(String(row?.titleSource || "default"));
    return !emptyDefaultCli;
  });
}

export function sessionCompletionItems(rows, input, now = Date.now(), currentId = "") {
  const q = clean(input).toLowerCase();
  return visibleSessionRows(rows)
    .slice()
    .sort((a, b) => modifiedMs(b) - modifiedMs(a))
    .map((row) => {
      const title = clean(row.title) || "MSO Agent session";
      const name = clean(row.name) || "agent";
      const text = `@${name}`;
      const modified = `modified ${formatSessionModified(row.updatedAt || row.createdAt, now)}`;
      const meta = `${title} · ${String(row.id) === String(currentId) ? `current · ${modified}` : modified}`;
      return { text, value: String(row.id), meta, search: `${text} ${title} ${row.id} ${meta}`.toLowerCase() };
    })
    .filter((item) => !q || item.search.includes(q))
    .slice(0, 20)
    .map(({ search: _search, ...item }) => item);
}
