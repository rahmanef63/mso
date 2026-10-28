import process from "node:process";

// One palette, one switch. Every module imports `C` (re-exported by
// mso-agent-runtime.mjs), so a theme has to be resolved HERE and re-assigned in
// place: modules capture the object reference at import time, so replacing the
// object would leave half the UI on the old colours. Mutating the same object is
// what keeps a theme switch honest instead of cosmetic.
//
// `NO_COLOR` and a non-TTY stdout always win: nothing here can emit ANSI into a
// pipe, a log file, or a screenshot diff.

export const THEMES = {
  dark: {
    blue: "\x1b[38;2;58;160;255m",
    cyan: "\x1b[38;2;52;211;153m",
    warn: "\x1b[38;2;245;158;11m",
    err: "\x1b[38;2;239;68;68m",
  },
  light: {
    // Chosen for contrast on a white terminal: the dark theme's cyan and warn are
    // unreadable on #fff, so both are darkened rather than reused.
    blue: "\x1b[38;2;21;94;183m",
    cyan: "\x1b[38;2;13;122;86m",
    warn: "\x1b[38;2;150;84;0m",
    err: "\x1b[38;2;176;24;24m",
  },
  mono: { blue: "", cyan: "", warn: "", err: "" },
};

export const THEME_NAMES = Object.keys(THEMES);
let currentTheme = "dark";

export function colorEnabled() {
  if (process.env.NO_COLOR) return false;
  return Boolean(process.stdout.isTTY);
}

export const C = {
  reset: colorEnabled() ? "\x1b[0m" : "",
  bold: colorEnabled() ? "\x1b[1m" : "",
  dim: colorEnabled() ? "\x1b[2m" : "",
  blue: "", cyan: "", warn: "", err: "",
};
C.a = C.blue;
C.b = C.blue;
C.c = C.cyan;
C.a = C.blue;
C.b = C.blue;
C.c = C.cyan;

export function themeNames() {
  return [...THEME_NAMES];
}

export function currentThemeName() {
  return currentTheme;
}

/**
 * Apply a theme in place. Returns the id that is now active, which may differ from
 * the request when colour is disabled entirely: a caller that prints
 * "theme light" while every colour is blank would be lying about what it did.
 */
export function applyTheme(name) {
  const requested = String(name || "").trim().toLowerCase();
  const wanted = THEME_NAMES.includes(requested) ? requested : null;
  if (!colorEnabled()) {
    C.blue = C.cyan = C.warn = C.err = "";
    currentTheme = "mono";
    return { theme: currentTheme, changed: false, reason: "colour disabled (NO_COLOR or not a TTY)" };
  }
  const picked = wanted ? THEMES[wanted] : THEMES[currentTheme] || THEMES.dark;
  C.blue = picked.blue;
  C.cyan = picked.cyan;
  C.warn = picked.warn;
  C.err = picked.err;
  // The short aliases exist for legacy call sites; keep them pointing at the live
  // values so a theme switch reaches them too.
  C.a = C.blue;
  C.b = C.blue;
  C.c = C.cyan;
  C.reset = "\x1b[0m";
  C.bold = "\x1b[1m";
  C.dim = "\x1b[2m";
  const changed = currentTheme !== (wanted || currentTheme);
  currentTheme = wanted || currentTheme;
  return { theme: currentTheme, changed, reason: wanted ? undefined : `unknown theme "${requested}"; keeping ${currentTheme}` };
}

// Resolve the initial palette through the same path so there is only one place
// that knows how colour works.
applyTheme(process.env.MSO_AGENT_THEME || "dark");
