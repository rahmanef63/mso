import { createHash, randomBytes } from "node:crypto";

const SEED_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function randomCorpusSeed() {
  return randomBytes(12).toString("hex");
}

export function normalizeCorpusSeed(value, fallback = randomCorpusSeed) {
  if (value == null || value === "") return fallback();
  const seed = String(value).trim();
  if (!SEED_RE.test(seed)) throw new Error("--seed must be 1-128 characters using letters, numbers, ., _, :, or -");
  return seed;
}

export function deriveRunSeed(baseSeed, runIndex) {
  if (!Number.isInteger(runIndex) || runIndex < 0) throw new Error("runIndex must be a non-negative integer");
  const base = normalizeCorpusSeed(baseSeed, () => { throw new Error("base seed is required"); });
  return createHash("sha256").update(`mso-agent-quality-v2:${base}:${runIndex}`).digest("hex").slice(0, 24);
}

export function rotateAgentOrder(agents, runIndex) {
  if (!agents.length) return [];
  const offset = runIndex % agents.length;
  return [...agents.slice(offset), ...agents.slice(0, offset)];
}
