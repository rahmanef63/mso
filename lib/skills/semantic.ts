/**
 * Small, deterministic semantic vectors for the local skill/recipe index.
 *
 * This is deliberately local: no API key, network call, model download or token
 * cost. Word features, bilingual aliases and character n-grams are feature-hashed
 * into a compact normalized vector. It is not a frontier embedding model, but it
 * is fast, typo-tolerant and good enough to route an intent to a few dozen MSO
 * tools/skills/recipes. The version is persisted with learned recipes so a future
 * encoder can re-index them safely.
 */
export const SKILL_EMBEDDING_VERSION = "mso-local-hybrid-v1";
export const SKILL_EMBEDDING_DIM = 384;
export const MAX_SEMANTIC_QUERY_BYTES = 4 * 1024;
export const MAX_SEMANTIC_QUERY_TERMS = 256;

const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "i", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "with",
  "aku", "akan", "apa", "agar", "bisa", "buat", "dan", "dari", "di", "ini", "itu", "ke", "kita", "mau", "saya", "sekarang", "tolong", "untuk", "yang",
]);

const ALIASES: Array<[RegExp, string]> = [
  [/\b(screen ?shot|screen capture|capture screen|tangkapan layar|gambar progress|kirim gambar)\b/g, "screen_capture visual_progress"],
  [/\b(deploy|deployment|rebuild|build ulang|restart production|push main|rilis)\b/g, "deploy_release"],
  [/\b(icon|ikon|logo|webp|transparent|transparan|no bg|background)\b/g, "image_asset icon_artwork"],
  [/\b(activity|aktivitas|log activity|audit trail|sedang ngapain|progress log)\b/g, "activity_observability"],
  [/\b(skill|skills|recipe|resep|workflow|playbook|cara tercepat|best path|memory)\b/g, "skill_memory workflow_recipe"],
  [/\b(vps|server|cpu|ram|memory|disk|uptime|process)\b/g, "server_health"],
  [/\b(camoufox|browser|firefox|vnc)\b/g, "camoufox_browser"],
  [/\b(hermes)\b/g, "hermes_agent"],
  [/\b(openclaw|open claw|lobster)\b/g, "openclaw_agent"],
  [/\b(file|files|folder|directory|path|berkas|direktori)\b/g, "filesystem"],
  [/\b(delete|hapus|remove|rm)\b/g, "destructive_delete"],
  [/\b(test|tests|testing|verify|verification|cek|check)\b/g, "verify_test"],
];

export function normalizeSemanticText(text: string): string {
  let out = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " url ")
    .replace(/[^a-z0-9_./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [re, alias] of ALIASES) out = out.replace(re, (m) => `${m} ${alias}`);
  return out;
}

function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function add(vec: number[], feature: string, weight: number): void {
  const h = hash32(feature);
  const index = h % vec.length;
  const sign = (h & 0x80000000) === 0 ? 1 : -1;
  vec[index] += sign * weight;
}

function terms(text: string, limit = Number.POSITIVE_INFINITY): string[] {
  return normalizeSemanticText(text)
    .split(" ")
    .map((v) => v.trim())
    .filter((v) => v.length > 1 && !STOP.has(v))
    .slice(0, limit);
}

export type PreparedSemanticQuery = {
  raw: string;
  vector: number[];
  terms: ReadonlySet<string>;
};

export function prepareSemanticQuery(query: string): PreparedSemanticQuery {
  const raw = query.trim();
  if (!raw) throw new Error("query must be a non-empty string");
  if (Buffer.byteLength(raw, "utf8") > MAX_SEMANTIC_QUERY_BYTES) throw new Error("query exceeds byte limit");
  return {
    raw,
    vector: embedSkillText(raw, MAX_SEMANTIC_QUERY_TERMS),
    terms: new Set(terms(raw, MAX_SEMANTIC_QUERY_TERMS)),
  };
}

export function embedSkillText(text: string, termLimit = Number.POSITIVE_INFINITY): number[] {
  const vec = Array<number>(SKILL_EMBEDDING_DIM).fill(0);
  const xs = terms(text, termLimit);
  for (let i = 0; i < xs.length; i += 1) {
    const token = xs[i];
    add(vec, `w:${token}`, token.includes("_") ? 2.2 : 1);
    if (i > 0) add(vec, `b:${xs[i - 1]}_${token}`, 1.25);
    const compact = token.replace(/[^a-z0-9_]/g, "");
    for (const n of [3, 4]) {
      if (compact.length < n) continue;
      for (let j = 0; j <= compact.length - n; j += 1) add(vec, `c${n}:${compact.slice(j, j + n)}`, 0.18);
    }
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < vec.length; i += 1) vec[i] /= norm;
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i += 1) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

export function lexicalSimilarity(a: string, b: string): number {
  const aa = new Set(terms(a));
  const bb = new Set(terms(b));
  if (!aa.size || !bb.size) return 0;
  let overlap = 0;
  for (const t of aa) if (bb.has(t)) overlap += 1;
  return overlap / Math.sqrt(aa.size * bb.size);
}

export function hybridSemanticScore(query: string | PreparedSemanticQuery, text: string, vector?: number[]): number {
  const prepared = typeof query === "string" ? prepareSemanticQuery(query) : query;
  const dv = vector ?? embedSkillText(text);
  const cosine = Math.max(0, cosineSimilarity(prepared.vector, dv));
  const docTerms = new Set(terms(text));
  let overlap = 0;
  for (const term of prepared.terms) if (docTerms.has(term)) overlap += 1;
  const lexical = prepared.terms.size && docTerms.size ? overlap / Math.sqrt(prepared.terms.size * docTerms.size) : 0;
  return Math.max(0, Math.min(1, cosine * 0.74 + lexical * 0.26));
}
