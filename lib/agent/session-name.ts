import { createHash, randomInt } from "node:crypto";

const FAMILIAR_NAMES = [
  "milo", "luna", "nara", "rio", "rafi", "niko", "maya", "zara", "leo", "kira",
  "bimo", "tara", "naya", "ari", "dino", "sora", "lio", "mira", "noah", "nino",
  "riko", "sana", "theo", "vivi", "yuki", "zeno", "coco", "ruby", "olive", "hazel",
  "max", "sam", "ben", "eli", "kai", "ivy", "joy", "finn", "hugo", "lily",
  "nico", "remi", "tobi", "nova", "alma", "cora", "dara", "ezra", "faye", "gabi",
  "hana", "iris", "juno", "luca", "mika", "nala", "omar", "piko", "raya", "suki",
  "timo", "vera", "wren", "yara", "zane", "adit", "bela", "cali", "dika", "eko",
  "fara", "gino", "hadi", "ika", "jaka", "kano", "lani", "miko", "navi", "raka",
] as const;

export const AGENT_SESSION_NAME_RE = /^[a-z][a-z0-9-]{1,23}$/;

export function normalizeAgentSessionName(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .replace(/^@/, "")
    .replace(/^\[|\]$/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24)
    .replace(/-$/g, "");
  return AGENT_SESSION_NAME_RE.test(raw) ? raw : "";
}

export function requireAgentSessionName(value: unknown): string {
  const name = normalizeAgentSessionName(value);
  if (!name) throw new Error("session name must be 2-24 lowercase letters/numbers/hyphens, starting with a letter");
  return name;
}

export function legacyAgentSessionName(id: string): string {
  const digest = createHash("sha256").update(String(id)).digest();
  const base = FAMILIAR_NAMES[digest.readUInt16BE(0) % FAMILIAR_NAMES.length]!;
  const suffix = createHash("sha256").update(`legacy:${id}`).digest("hex").slice(0, 4);
  return `${base}-${suffix}`;
}

export function allocateAgentSessionName(usedNames: Iterable<string>): string {
  const used = new Set(Array.from(usedNames, (value) => normalizeAgentSessionName(value)).filter(Boolean));
  const start = randomInt(FAMILIAR_NAMES.length);
  for (let i = 0; i < FAMILIAR_NAMES.length; i += 1) {
    const candidate = FAMILIAR_NAMES[(start + i) % FAMILIAR_NAMES.length]!;
    if (!used.has(candidate)) return candidate;
  }
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const base = FAMILIAR_NAMES[(start + suffix) % FAMILIAR_NAMES.length]!;
    const candidate = `${base}-${suffix}`;
    if (candidate.length <= 24 && !used.has(candidate)) return candidate;
  }
  throw new Error("session name space is exhausted");
}
