// Where the completion overlay is painted, and how tall it may be.
//
// The panel owns rows 1..N and paints the transcript and chrome. The composer owns the prompt, the
// draft, and the menu that hangs above them. Getting that split wrong is what made a menu look like the
// whole layout jumping:
//
//   the panel shrank to make room  ->  its own top lines fell out of the viewport
//   the frame grew past the last row -> the terminal scrolled, permanently
//
// So the geometry lives here, in one place, and the rule is stated once: the frame is anchored to the
// BOTTOM and the menu may only use the rows the panel leaves free.

// Chrome rows (separator + footer lines) the panel paints above the prompt. A menu that reached past
// them would cover the header instead of the transcript.
const PANEL_RESERVE_ROWS = 4;

/**
 * Computes the visible composer frame and the absolute row it starts at.
 *
 * @param {{lines: string[], menu: string[], foot: string[], owned: number, rows?: number}} input
 *   `lines` is prompt + draft + menu + foot; `owned` counts prompt + draft only.
 * @returns {{visible: string[], top: number}} frame to paint, and the 1-based row it starts on
 */
export function overlayFrame({ lines, menu = [], foot = [], owned = 1, rows = 24 } = {}) {
  const total = Math.max(1, Number(rows) || 24);
  const claimed = Math.max(1, Number(owned) || 1);
  // `lines` already ends with the footer, so it is not appended again: doing that printed the status
  // row twice, one copy under the other.
  const promptRows = lines.length - menu.length - foot.length;
  // The menu may not take rows the panel needs, so a tall menu is shortened from the top. Keeping the
  // LAST entries matters: the first match is rarely the one a user wants after narrowing a query.
  const room = Math.max(0, total - claimed - PANEL_RESERVE_ROWS);
  const shown = menu.length > room ? menu.slice(menu.length - room) : menu;
  const visible = [...lines.slice(0, promptRows), ...shown, ...foot].filter(Boolean);
  // Anchor to the bottom so a taller menu grows upward over the transcript, never downward past the
  // final row. Clamped so it can never start above row 1.
  return { visible, top: Math.max(1, total - visible.length + 1) };
}

/**
 * Paints one composer frame: prompt, draft, overlay menu, footer.
 *
 * Pulled out of the composer's render because it is the part with the arithmetic that has broken twice,
 * and it is easier to keep honest when it is not interleaved with key handling and cursor bookkeeping.
 *
 * @param {{output: any, lines: string[], menu: string[], foot: string[], owned: number, previous: string[],
 *   absolute: boolean}} args
 * @returns {string[]} the frame now on screen
 */
export function paintOverlayFrame({ output, lines, menu, foot, owned, previous, absolute, writeFrame, writeFrameAt }) {
  const { visible, top } = overlayFrame({ lines, menu, foot, owned, rows: output?.rows });

  return absolute
    ? writeFrameAt(output, previous, visible, top, output?.columns)
    : writeFrame(output, previous, visible);
}

/**
 * Composes the composer's visible lines from its parts.
 *
 * Split out of render because this is the only part of it that is pure: everything else there touches
 * the terminal, the caret, or the keymap. A pure function is also the only part that can be tested
 * without a fake TTY, which is why the two layout bugs in this area survived the suite.
 *
 * @param {{prompt: string, draft: string[], menu: string[], foot: string[], promptWidth: number}} parts
 * @returns {{lines: string[], owned: number}} frame lines, and how many belong to prompt plus draft
 */
export function composeComposerLines({ prompt = "", draft = [], menu = [], foot = [], promptWidth = 0 } = {}) {
  const continuation = " ".repeat(Math.max(0, promptWidth));
  const lines = [
    `${prompt}${draft[0] || ""}`,
    ...draft.slice(1).map((row) => `${continuation}${row}`),
    ...menu,
    ...foot,
  ];
  // Prompt plus draft own rows; menu and footer overlay what is already there.
  return { lines, owned: Math.max(1, draft.length) };
}

/**
 * The draft's row budget, given what the menu and footer already took.
 *
 * A quarter of the terminal would be three rows on a twelve row screen, and a six line draft is exactly
 * the case that overflows there, so the cap is a subtraction rather than a fraction.
 *
 * @param {{rows?: number, menuRows?: number, footRows?: number}} input
 * @returns {number} maximum draft rows
 */
export function draftRowBudget({ rows = 24, menuRows = 0, footRows = 0 } = {}) {
  const total = Math.max(8, Number(rows) || 24);
  return Math.max(2, Math.min(12, total - menuRows - footRows - 4, Math.floor(total * 0.32)));
}

/**
 * Where the caret goes after a frame is on screen: one row per draft line, then along the prompt.
 *
 * Kept next to the frame because it is the same arithmetic. When these two disagreed the caret landed
 * inside the panel and the next repaint wrote over it.
 *
 * @param {{cursorRow?: number, promptWidth?: number, cursorCol?: number}} input
 * @returns {string} escape sequence placing the caret
 */
export function caretEscape({ cursorRow = 0, promptWidth = 0, cursorCol = 0 } = {}) {
  const down = Number(cursorRow) > 0 ? `\x1b[${Number(cursorRow)}B` : "";
  return `${down}\r\x1b[${Math.max(0, Number(promptWidth) + Number(cursorCol))}C`;
}

/**
 * Hands the Ctrl+P key to the caller and closes this prompt.
 
 * The dialog needs the row this prompt occupies, so the prompt must go first; opening one from inside
 * the key handler drew both into the same rows and the menu never appeared.
 *
 * @param {(() => void) | null | undefined} open caller's dialog opener
 * @param {(echo?: boolean) => void} cancel closes this prompt
 * @returns {boolean | undefined} true when handled, undefined when unbound
 */
export function openCommandDialog(open, cancel) {
  if (typeof open !== "function") return undefined;
  open();
  cancel(false);
  return true;
}
