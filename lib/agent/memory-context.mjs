export const MEMORY_CONTEXT_VERSION = "mso-memory-context-v1";
export const MEMORY_LEXICON_VERSION = "mso-memory-lexicon-v1";

const ALIAS_GROUPS = [
  ["ide", "editor"],
  ["kantor", "office"],
  ["proyek", "project"],
  ["repositori", "repository", "repo"],
  ["rilis", "release", "deploy", "deployment"],
  ["tes", "test", "uji", "verify", "verification"],
  ["gagal", "failed", "failure", "error"],
  ["ingatan", "memori", "memory"],
  ["alur", "workflow"],
  ["pengguna", "user"],
  ["kredensial", "credential", "credentials"],
  ["integrasi", "integration", "integrations"],
  ["peramban", "browser"],
  ["direktori", "directory", "folder"],
  ["berkas", "file", "files"],
];

const CORE_KEY_HINT = /\b(policy|rule|preference|default|identity|locale|language|timezone|credential|integration|isolation|decision|owner|profile)\b/i;
const PROMPT_BOUNDARY = /<\/?(?:CORE_MEMORY|RELEVANT_MEMORY|USER\.md|MEMORY\.md)>/gi;
const HIDDEN_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const SECRET_PATTERNS = [
  /(authorization\s*[:=]\s*)([^\s]+)/gi,
  /\b(password|token|secret|api[_ -]?key|private[_ -]?key)\s*[:=]\s*([^\s]+)/gi,
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
  /\b(?:sk|pk|ghp|mso_mcp)_[a-z0-9_-]{8,}\b/gi,
];

function baseTerms(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*/gu) ?? [];
}

export function normalizeMemoryPhrase(value) {
  return baseTerms(value).join(" ");
}

export function expandMemoryTerms(value) {
  const terms = new Set(baseTerms(value));
  for (const group of ALIAS_GROUPS) {
    if (!group.some((term) => terms.has(term))) continue;
    for (const term of group) terms.add(term);
  }
  return [...terms];
}

export function redactMemoryContext(value) {
  let out = String(value ?? "")
    .replace(HIDDEN_CONTROLS, "")
    .replace(PROMPT_BOUNDARY, "[memory-boundary]");
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (...args) => {
      const prefix = typeof args[1] === "string" && /[:=]/.test(args[1]) ? args[1] : "";
      return prefix ? `${prefix}[redacted]` : "[redacted]";
    });
  }
  return out;
}

function parseDocument(document, body) {
  const text = String(body ?? "");
  if (!text.trim()) return [];
  const matches = [...text.matchAll(/^##\s+([^\r\n]+)\s*$/gm)];
  if (!matches.length) {
    return [{ document, key: "Legacy", value: redactMemoryContext(text.trim()), order: 0 }];
  }
  const out = [];
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    const key = redactMemoryContext(String(current[1] ?? "").trim()).slice(0, 120);
    const start = Number(current.index ?? 0) + current[0].length;
    const end = next ? Number(next.index ?? text.length) : text.length;
    const value = redactMemoryContext(text.slice(start, end).trim()).slice(0, 8192);
    if (!key || !value) continue;
    out.push({ document, key, value, order: i });
  }
  return out;
}

export function memorySnapshotSections(snapshot = {}) {
  return [
    ...parseDocument("USER.md", snapshot.user),
    ...parseDocument("MEMORY.md", snapshot.memory),
  ].map((section) => ({ ...section, ref: `${section.document}#${section.key}` }));
}

function sectionScore(section, query) {
  const queryPhrase = normalizeMemoryPhrase(query);
  const queryTerms = expandMemoryTerms(query);
  if (!queryTerms.length) return 0;
  const keyPhrase = normalizeMemoryPhrase(section.key);
  const valuePhrase = normalizeMemoryPhrase(section.value);
  const keyTerms = new Set(expandMemoryTerms(section.key));
  const valueTerms = new Set(expandMemoryTerms(section.value));
  let score = 0;
  if (queryPhrase && keyPhrase === queryPhrase) score += 40;
  else if (queryPhrase && keyPhrase.includes(queryPhrase)) score += 18;
  if (queryPhrase && valuePhrase.includes(queryPhrase)) score += 8;
  for (const term of queryTerms) {
    if (keyTerms.has(term)) score += 6;
    else if (valueTerms.has(term)) score += 2;
  }
  return score;
}

function corePriority(section) {
  let score = section.document === "USER.md" ? 60 : 20;
  if (CORE_KEY_HINT.test(section.key)) score += 35;
  if (/^workflow:/i.test(section.key)) score -= 45;
  if (/\b(failure|debug|task)\b/i.test(section.key)) score -= 8;
  return score;
}

function clipEntry(entry, remaining) {
  const header = `[${entry.ref}]\n`;
  if (remaining <= header.length + 12) return null;
  const valueBudget = Math.max(1, remaining - header.length - 2);
  const value = entry.value.length > valueBudget
    ? `${entry.value.slice(0, Math.max(1, valueBudget - 1))}…`
    : entry.value;
  return { ...entry, value };
}

function selectBudgeted(entries, maxChars) {
  const selected = [];
  let used = 0;
  for (const entry of entries) {
    const rendered = `[${entry.ref}]\n${entry.value}\n\n`;
    if (used + rendered.length <= maxChars) {
      selected.push(entry);
      used += rendered.length;
      continue;
    }
    if (!selected.length) {
      const clipped = clipEntry(entry, maxChars - used);
      if (clipped) {
        selected.push(clipped);
        used += `[${clipped.ref}]\n${clipped.value}\n\n`.length;
      }
    }
    break;
  }
  return { entries: selected, chars: used };
}

export function formatMemoryEntries(entries) {
  return entries.map((entry) => `[${entry.ref}]\n${entry.value}`).join("\n\n");
}

function contextBudget(value, fallback) {
  if (value === 0) return 0;
  const numeric = Number(value);
  return Math.max(1000, Math.min(24000, Number.isFinite(numeric) && numeric > 0 ? numeric : fallback));
}

export function buildMemoryContext(snapshot = {}, query = "", options = {}) {
  const coreChars = contextBudget(options.coreChars, 6000);
  const jitChars = contextBudget(options.jitChars, 8000);
  const maxRelevant = Math.max(1, Math.min(24, Number(options.maxRelevant) || 12));
  const sections = memorySnapshotSections(snapshot);
  const coreRanked = [...sections]
    .sort((a, b) => corePriority(b) - corePriority(a) || a.document.localeCompare(b.document) || a.order - b.order);
  const core = selectBudgeted(coreRanked, coreChars);
  const coreRefs = new Set(core.entries.map((entry) => entry.ref));
  const relevantRanked = sections
    .filter((entry) => !coreRefs.has(entry.ref))
    .map((entry) => ({ ...entry, score: sectionScore(entry, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref))
    .slice(0, maxRelevant);
  const relevant = selectBudgeted(relevantRanked, jitChars);
  return {
    version: MEMORY_CONTEXT_VERSION,
    lexiconVersion: MEMORY_LEXICON_VERSION,
    capturedAt: typeof snapshot.capturedAt === "string" ? snapshot.capturedAt : undefined,
    coreText: formatMemoryEntries(core.entries),
    relevantText: formatMemoryEntries(relevant.entries),
    coreEntries: core.entries,
    relevantEntries: relevant.entries,
    stats: {
      totalEntries: sections.length,
      coreEntries: core.entries.length,
      relevantEntries: relevant.entries.length,
      coreChars: core.chars,
      relevantChars: relevant.chars,
    },
  };
}
