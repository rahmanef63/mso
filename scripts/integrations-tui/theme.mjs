const enabled = !process.env.NO_COLOR;
const esc = (code) => enabled ? `\x1b[${code}m` : "";
export const T = {
  reset: esc("0"), bold: esc("1"), dim: esc("2"), reverse: esc("7"),
  blue: esc("38;2;69;142;255"), blueBg: esc("48;2;69;142;255"),
  white: esc("38;2;255;255;255"), green: esc("38;2;46;229;157"),
  amber: esc("38;2;244;190;78"), red: esc("38;2;255;105;120"),
  border: esc("38;2;93;101;118"), muted: esc("38;2;139;145;158"),
};
export function selected(text, active = true) {
  if (!enabled) return active ? `${T.reverse}${text}${T.reset}` : `${T.bold}${text}${T.reset}`;
  return active ? `${T.blueBg}${T.white}${T.bold}${text}${T.reset}` : `${T.blue}${T.bold}${text}${T.reset}`;
}
export function statusStyle(status, text) {
  const code = status === "verified" || status === "default" ? T.green
    : status === "error" || status === "missing" ? T.red
      : status === "warning" ? T.amber : status === "configured" ? T.blue : T.muted;
  return `${code}${text}${T.reset}`;
}
export function resultStyle(text) {
  const s = String(text || "");
  if (/^[✕×!]/.test(s)) return `${T.red}${s}${T.reset}`;
  if (/^[⚠]/.test(s)) return `${T.amber}${s}${T.reset}`;
  if (/^[✓]/.test(s)) return `${T.green}${s}${T.reset}`;
  return `${T.muted}${s}${T.reset}`;
}
