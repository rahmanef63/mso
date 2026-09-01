function clean(value) { return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim(); }

export function resolveSessionQuery(rows, query) {
  const sessions = Array.isArray(rows) ? rows : [];
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

export function sessionCompletionItems(rows, input) {
  const q = clean(input).toLowerCase();
  return (Array.isArray(rows) ? rows : []).map((row, index) => ({
    text: row.id,
    meta: `${index + 1} · ${row.source || "cli"} · ${row.historyTurns || 0} turns · ${clean(row.title || "MSO Agent session")}`,
  })).filter((item) => !q || item.text.toLowerCase().includes(q) || item.meta.toLowerCase().includes(q)).slice(0, 20);
}
