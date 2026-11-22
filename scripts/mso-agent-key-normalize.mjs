// Turning a physical key event (or a binding string) into one canonical spelling.
//
// This is its own module because it is pure, it has more edge cases than anything else in the keymap, and
// two of them silently disabled keys outright:
//
//   a bare Escape arrives as meta:true   -> counting it as Alt made "escape" unmatchable
//   ctrl+i IS tab                        -> storing "ctrl+i" killed the Tab binding it replaced
//   "shift+ctrl+k"                       -> a permuted spelling never matched {ctrl,shift,k}
//
// Every caller compares normalized strings, so one wrong spelling is a dead binding with no error.

// Control bytes that readline reports under a different name.
const CONTROL_ALIASES = { i: "tab", m: "return", j: "return", h: "backspace" };

// Names readline can produce. A binding whose key is not one of these can never fire, so it is refused
// rather than stored: storing it replaced a working default with a no-op.
const KNOWN_KEYS = new Set([
  "escape", "return", "tab", "space", "backspace", "delete", "insert",
  "left", "right", "up", "down", "home", "end", "pageup", "pagedown",
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
]);

// Canonical modifier order. The object path always emits ctrl,alt,shift, so the string path must too.
const MODIFIER_ORDER = ["ctrl", "alt", "shift"];

export function isKnownKeyName(name) {
  return KNOWN_KEYS.has(name);
}

/**
 * @param {any} spec a keypress object from readline, or a binding string like "ctrl+shift+k"
 * @returns {string} canonical spelling, or "" when the spec cannot describe a real key
 */
export function normalizeKey(spec) {
  if (!spec) return "";
  if (typeof spec === "object") {
    const parts = [];
    // The name is lowered FIRST: comparing the raw name meant {name:"Escape"} produced alt+escape while
    // {name:"escape"} did not, so one spelling of the same physical key was dead.
    const name = String(spec.name || "").toLowerCase().trim();
    if (spec.ctrl) parts.push("ctrl");
    if (spec.meta && name !== "escape") parts.push("alt");
    if (spec.shift) parts.push("shift");
    if (!name) return "";
    parts.push(name === "enter" ? "return" : name);
    return parts.join("+");
  }

  const tokens = String(spec).toLowerCase().trim().replace(/\s+/g, "").split("+").filter(Boolean);
  if (!tokens.length) return "";
  const mods = new Set();
  let key = "";
  let unknown = "";
  for (const token of tokens) {
    if (token === "ctrl" || token === "control") mods.add("ctrl");
    else if (token === "alt" || token === "meta") mods.add("alt");
    else if (token === "shift") mods.add("shift");
    // A multi-character token that is not a known key is a typo such as "ctrlp+k". Treating it as the key
    // produced a single-letter binding that swallowed typing: one keystroke cleared the screen and the
    // letter could never be typed.
    else if (token.length > 1 && !KNOWN_KEYS.has(token) && token !== "enter") unknown = token;
    else key = token === "enter" ? "return" : token;
  }
  if (unknown) return "";

  // ctrl+i IS tab: readline reports one key, so ctrl is dropped rather than kept alongside.
  if (key.length === 1 && mods.has("ctrl") && CONTROL_ALIASES[key]) {
    mods.delete("ctrl");
    key = CONTROL_ALIASES[key];
  }
  if (!key) return "";
  return [...MODIFIER_ORDER.filter((mod) => mods.has(mod)), key].join("+");
}
