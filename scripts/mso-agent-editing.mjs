const ANSI = /\x1b\[[0-9;]*m/g;
const chars = (value) => Array.from(String(value ?? ""));
const plain = (value) => String(value ?? "").replace(ANSI, "");
const width = (value) => chars(plain(value)).length;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function fit(value, max) {
  const row = chars(plain(value).replace(/[\r\n\t]+/g, " "));
  if (row.length <= max) return row.join("");
  return max <= 1 ? "…".slice(0, max) : row.slice(0, max - 1).join("") + "…";
}

export function pad(value, max) {
  const clean = fit(value, max);
  return clean + " ".repeat(Math.max(0, max - width(clean)));
}

export function wordLeftIndex(value, cursor) {
  const row = chars(value);
  let index = clamp(cursor, 0, row.length);
  while (index > 0 && /\s/u.test(row[index - 1])) index--;
  while (index > 0 && !/\s/u.test(row[index - 1])) index--;
  return index;
}

export function wordRightIndex(value, cursor) {
  const row = chars(value);
  let index = clamp(cursor, 0, row.length);
  while (index < row.length && /\s/u.test(row[index])) index++;
  while (index < row.length && !/\s/u.test(row[index])) index++;
  return index;
}
