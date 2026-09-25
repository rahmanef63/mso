import { IntegrationError } from "./identity";
const invalid = () => new IntegrationError("invalid_google_arguments");
export function keys(args: Record<string, unknown>, allowed: string[]) {
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(k => !allowed.includes(k))) throw invalid();
}
export function text(value: unknown, max = 2048): string {
  if (typeof value !== "string" || !value || value.length > max || /[\x00-\x20\x7f]/.test(value)) throw invalid();
  return value;
}
export function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw invalid();
  return Number(value);
}
export function date(value: unknown): string {
  const d = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) throw invalid();
  return d;
}
export function dates(start: unknown, end: unknown) {
  const a = date(start), b = date(end); if (a > b) throw invalid(); return { startDate: a, endDate: b };
}
export function publicUrl(value: unknown): URL {
  const raw = text(value);
  let u: URL; try { u = new URL(raw); } catch { throw invalid(); }
  if (u.protocol !== "https:" || u.username || u.password || u.hash || !u.hostname.includes(".") || u.hostname.endsWith(".") || /^\[|^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname) || raw.includes("\\") || /%(?:2f|5c|00)/i.test(raw)) throw invalid();
  return u;
}
export function property(value: unknown): string {
  const raw = text(value);
  if (raw.startsWith("sc-domain:")) {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(raw.slice(10))) throw invalid();
  } else { const u = publicUrl(raw); if (u.search) throw invalid(); }
  return raw;
}
export function inspection(site: string, value: unknown): string {
  const url = publicUrl(value);
  if (site.startsWith("sc-domain:")) { const domain = site.slice(10); if (url.hostname !== domain && !url.hostname.endsWith("." + domain)) throw invalid(); }
  else { const prefix = new URL(site); if (prefix.origin !== url.origin || !url.pathname.startsWith(prefix.pathname)) throw invalid(); }
  return text(value);
}
export function named(values: unknown, max: number) {
  if (!Array.isArray(values) || !values.length || values.length > max) throw invalid();
  return values.map(row => { if (!row || typeof row !== "object" || Array.isArray(row)) throw invalid(); keys(row, ["name"]); const name = text(row.name, 80); if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name)) throw invalid(); return { name }; });
}
export function enumeration(value: unknown, allowed: string[]): string {
  if (typeof value !== "string" || !allowed.includes(value)) throw invalid(); return value;
}
