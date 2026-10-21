/** Icon value model. Stored as one string in pages/databases.icon. Forms:
 *
 *   - ""                            → empty (default fallback)
 *   - "🎯"                           → emoji glyph (legacy + new)
 *   - "lucide:Star"                 → lucide icon (stroke), currentColor
 *   - "lucide:Star?c=f59e0b"        → lucide + hex color (no #)
 *   - "phosphor:Star"               → phosphor icon (fill), currentColor
 *   - "phosphor:Star?c=f59e0b"      → phosphor + hex color (no #)
 *   - "🎯?c=f59e0b"                  → emoji + tint hint (only used for twemoji bg/ring)
 *
 *  Color is suffixed with `?c=<hex>` (no leading #) — backwards-compat
 *  with all existing emoji values, no schema migration. */

export type IconValue =
  | { kind: "emoji"; emoji: string; color?: string }
  | { kind: "lucide"; name: string; color?: string }
  | { kind: "phosphor"; name: string; color?: string }
  | { kind: "empty" };

export const LUCIDE_PREFIX = "lucide:";
export const PHOSPHOR_PREFIX = "phosphor:";

export function parseIconValue(raw: string | null | undefined): IconValue {
  if (!raw) return { kind: "empty" };

  const qi = raw.indexOf("?");
  const head = qi >= 0 ? raw.slice(0, qi) : raw;
  const query = qi >= 0 ? raw.slice(qi + 1) : "";
  const color = parseColorParam(query);

  if (head.startsWith(LUCIDE_PREFIX)) {
    const name = head.slice(LUCIDE_PREFIX.length).trim();
    return name ? { kind: "lucide", name, color } : { kind: "empty" };
  }
  if (head.startsWith(PHOSPHOR_PREFIX)) {
    const name = head.slice(PHOSPHOR_PREFIX.length).trim();
    return name ? { kind: "phosphor", name, color } : { kind: "empty" };
  }
  return { kind: "emoji", emoji: head, color };
}

function parseColorParam(q: string): string | undefined {
  if (!q) return undefined;
  for (const part of q.split("&")) {
    const [k, v] = part.split("=");
    if (k === "c" && v) {
      const hex = v.replace(/^#/, "");
      if (/^[0-9a-fA-F]{3,8}$/.test(hex)) return `#${hex.toLowerCase()}`;
    }
  }
  return undefined;
}

export function lucideValue(name: string, color?: string): string {
  return withColor(`${LUCIDE_PREFIX}${name}`, color);
}

export function phosphorValue(name: string, color?: string): string {
  return withColor(`${PHOSPHOR_PREFIX}${name}`, color);
}

export function withColor(raw: string, color?: string): string {
  if (!raw) return raw;
  const base = raw.split("?")[0];
  if (!color) return base;
  const hex = color.replace(/^#/, "").toLowerCase();
  return `${base}?c=${hex}`;
}

export function isLucideValue(raw: string | null | undefined): boolean {
  return !!raw && raw.startsWith(LUCIDE_PREFIX);
}

export function isPhosphorValue(raw: string | null | undefined): boolean {
  return !!raw && raw.startsWith(PHOSPHOR_PREFIX);
}
