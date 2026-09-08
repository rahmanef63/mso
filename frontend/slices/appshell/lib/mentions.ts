// Trigger parsing for the composer's @ and / completions. Pure — no React, no
// DOM — because the rules are the whole feature and they deserve a real test.
//
// THE / PROBLEM. This is a VPS cockpit: the user types absolute paths constantly
// ("ls /home/user", "read /etc/hosts"). A slash trigger that fires after any
// whitespace would open a menu on almost every message. So `/` opens ONLY when it
// is the first character of the composer — the Slack/Discord convention — which
// makes a command an explicit act and leaves every path alone. `@` is safe after
// whitespace too, since it is rare mid-message on this box, but it still will not
// fire inside a word (so an email address types cleanly).

export type MentionKind = "agent" | "command";

export type MentionQuery = {
  kind: MentionKind;
  /** Text typed after the trigger, lowercased. "" right after the trigger char. */
  query: string;
  /** Index of the trigger char in the source string. */
  start: number;
  /** Index one past the end of the query (always the caret). */
  end: number;
};

/** A word char for our purposes — what a query may contain without ending it. */
const WORD = /[A-Za-z0-9._:-]/;

/**
 * What completion, if any, the caret is currently sitting in.
 *
 * `caret` is the selectionStart. Only text BEFORE the caret matters: typing in the
 * middle of an existing message should still complete the token being edited.
 */
export function mentionAt(text: string, caret: number): MentionQuery | null {
  const upto = text.slice(0, Math.max(0, Math.min(caret, text.length)));

  // Walk back to the trigger. Stop at whitespace: a query never spans a space, so
  // "@dev ops" has closed by the time the caret is after "ops".
  let i = upto.length - 1;
  while (i >= 0 && WORD.test(upto[i])) i--;
  if (i < 0) return null;

  const ch = upto[i];
  if (ch !== "@" && ch !== "/") return null;

  const before = i === 0 ? "" : upto[i - 1];

  if (ch === "/") {
    // First character of the whole composer, nothing else. This is what keeps
    // "/home/user" — and every other path — from opening the menu.
    if (i !== 0) return null;
  } else if (before !== "" && !/\s/.test(before)) {
    // Mid-word @ is an email or a handle inside a token, not a mention.
    return null;
  }

  return {
    kind: ch === "@" ? "agent" : "command",
    query: upto.slice(i + 1).toLowerCase(),
    start: i,
    end: caret,
  };
}

/** Replace the active trigger+query with `insert`, returning text + new caret. */
export function applyMention(
  text: string,
  q: MentionQuery,
  insert: string,
): { text: string; caret: number } {
  // One trailing space so the next word starts cleanly and the popup closes (a
  // space ends the query by definition) — but not a SECOND one when completing
  // mid-message, where the text already continues with whitespace.
  const rest = text.slice(q.end);
  const body = /^\s/.test(rest) ? insert : `${insert} `;
  return {
    text: text.slice(0, q.start) + body + rest,
    caret: q.start + body.length,
  };
}

export type MentionItem = {
  id: string;
  label: string;
  hint?: string;
  /** What gets written into the composer when chosen. */
  insert: string;
  kind: MentionKind;
  /** Side effect of CHOOSING this item, e.g. switching the active agent.
   *
   *  The action rides on the pick rather than being parsed back out of the text
   *  later, which avoids three separate traps: a multi-word name ("New Agent" is
   *  the default for every user-created agent) would be truncated by the query's
   *  character class; a refused send would still have switched the agent; and the
   *  resolver would have to live in the conversation store, which is already at
   *  its line budget. Typing a mention by hand inserts text only — the pick is the
   *  deliberate act. */
  onPick?: () => void;
};

/**
 * Rank candidates for a query. Prefix matches first, then substring, each group
 * alphabetical so the list is stable while typing. Deliberately NOT fuzzy: with
 * ~90 skills a plain prefix match is predictable, and predictable beats clever in
 * something the user drives by muscle memory.
 */
export function rankMentions(items: MentionItem[], query: string, limit = 8): MentionItem[] {
  if (!query) return items.slice(0, limit);
  const prefix: MentionItem[] = [];
  const contains: MentionItem[] = [];
  for (const it of items) {
    const hay = it.label.toLowerCase();
    if (hay.startsWith(query)) prefix.push(it);
    else if (hay.includes(query)) contains.push(it);
  }
  return [...prefix, ...contains].slice(0, limit);
}
