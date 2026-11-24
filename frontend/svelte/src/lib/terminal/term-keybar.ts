// Mobile/touch key bar sequences, plus the sticky-modifier transform ported from
// the legacy key-bar. Soft keyboards have no Esc/Tab/arrows, so interactive
// programs stay usable on a phone.
export type KeyDef = { label: string; aria: string; seq: string };

export const PRE_KEYS: KeyDef[] = [
  { label: "Esc", aria: "Escape", seq: "\x1b" },
  { label: "Tab", aria: "Tab", seq: "\t" },
];

export const NAV_KEYS: KeyDef[] = [
  { label: "Up", aria: "Arrow up", seq: "\x1b[A" },
  { label: "Down", aria: "Arrow down", seq: "\x1b[B" },
];

export const CHORD_KEYS: KeyDef[] = [
  { label: "^C", aria: "Control C: interrupt", seq: "\x03" },
  { label: "^D", aria: "Control D: end of input", seq: "\x04" },
  { label: "^L", aria: "Control L: clear screen", seq: "\x0c" },
];

export const ALL_KEYS: KeyDef[] = [...PRE_KEYS, ...NAV_KEYS, ...CHORD_KEYS];

export const isPrintable = (data: string): boolean =>
  data.length === 1 && data >= " " && data !== "\x7f";

/** Ctrl maps letters to charCode & 0x1f; Alt prefixes ESC. Non-printable input passes through. */
export function applyMods(data: string, ctrl: boolean, alt: boolean): string {
  if (!isPrintable(data)) return data;
  let out = data;
  if (ctrl && /^[a-z]$/i.test(out)) out = String.fromCharCode(out.toUpperCase().charCodeAt(0) & 0x1f);
  return alt ? `\x1b${out}` : out;
}

/** Sticky modifiers apply to one key press, then disarm. */
export function pressWithMods(seq: string, ctrl: boolean, alt: boolean): string {
  const printable = isPrintable(seq);
  return ctrl || alt ? applyMods(seq, ctrl && printable, alt && printable) : seq;
}
