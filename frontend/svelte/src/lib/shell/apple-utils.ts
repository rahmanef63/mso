export type AppleClockStrings = {
  readonly t12: string;
  readonly macClock: string;
  readonly padStatusLeft: string;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function shadeHex(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return hex;
  }
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * 0.68);
  const g = Math.round(((n >> 8) & 255) * 0.68);
  const b = Math.round((n & 255) * 0.72);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export function eqAppleColor(a: string, b: string): boolean {
  return (a || "").toLowerCase() === (b || "").toLowerCase();
}

export function formatAppleClock(now: Date): AppleClockStrings {
  const hh = now.getHours();
  const mm = String(now.getMinutes()).padStart(2, "0");
  const t12 = `${hh % 12 || 12}:${mm}`;
  const stamp = `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
  const meridiem = hh < 12 ? "AM" : "PM";
  return {
    t12,
    macClock: `${stamp}  ${t12} ${meridiem}`,
    padStatusLeft: `${t12}  \u00b7  ${stamp}`,
  };
}
