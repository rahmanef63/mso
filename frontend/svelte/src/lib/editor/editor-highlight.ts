export type TokenKind = "plain" | "kw" | "str" | "num" | "cmt" | "fn" | "tag" | "heading";
export type CodeToken = { kind: TokenKind; text: string };
export type FindMatch = { start: number; end: number; line: number; col: number };

type TokenFamily = "code" | "hash" | "json" | "css" | "md" | "markup" | "plain";

const MAX_HIGHLIGHT_CHARS = 120_000;

const KEYWORDS = new Set(
  (
    "const let var function return if else for while do switch case break continue " +
    "new class extends super this import from export default await async yield " +
    "typeof instanceof in of delete void try catch finally throw null true false undefined " +
    "public private protected static interface type enum implements namespace readonly " +
    "as satisfies keyof infer never unknown any boolean string number object symbol bigint " +
    "def lambda elif except with pass raise global nonlocal None True False and or not is " +
    "fn pub mod use struct impl trait match mut ref loop where crate self Self " +
    "func package chan defer go range select map " +
    "echo fi then esac done local source exit set export unset " +
    "SELECT FROM WHERE INSERT INTO UPDATE DELETE CREATE TABLE ALTER DROP JOIN GROUP ORDER BY LIMIT"
  ).split(/\s+/),
);

function familyFor(language: string): TokenFamily {
  const l = language.toLowerCase();
  if (l === "json") return "json";
  if (l === "css") return "css";
  if (l === "markdown") return "md";
  if (l === "html" || l === "xml" || l === "svelte") return "markup";
  if (l === "python" || l === "shell" || l === "yaml" || l === "toml" || l === "dockerfile" || l === "makefile" || l === "env") {
    return "hash";
  }
  if (l === "plain text") return "plain";
  return "code";
}

function pushToken(out: CodeToken[], kind: TokenKind, text: string): void {
  if (!text) return;
  const prev = out[out.length - 1];
  if (prev && prev.kind === kind) prev.text += text;
  else out.push({ kind, text });
}

function tokenizeJsonLine(line: string): CodeToken[] {
  const re = /("(?:\\.|[^"\\])*")|(\b-?\d[\d.eE+-]*\b)|\b(true|false|null)\b/g;
  const out: CodeToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    pushToken(out, "plain", line.slice(last, m.index));
    if (m[1]) {
      const isKey = /^\s*:/.test(line.slice(re.lastIndex));
      pushToken(out, isKey ? "fn" : "str", m[1]);
    } else if (m[2]) {
      pushToken(out, "num", m[2]);
    } else if (m[3]) {
      pushToken(out, "kw", m[3]);
    }
    last = re.lastIndex;
  }
  pushToken(out, "plain", line.slice(last));
  return out.length ? out : [{ kind: "plain", text: "" }];
}

function tokenizeCssLine(line: string): CodeToken[] {
  if (/\/\*.*\*\//.test(line)) return [{ kind: "cmt", text: line }];
  const m = line.match(/^(\s*)([\w-]+)(\s*:\s*)(.+?)(;?)$/);
  if (m) {
    const tokens: CodeToken[] = [
      { kind: "plain", text: m[1] },
      { kind: "fn", text: m[2] },
      { kind: "plain", text: m[3] },
      { kind: "str", text: m[4] },
      { kind: "plain", text: m[5] },
    ];
    return tokens.filter((t) => t.text.length > 0);
  }
  if (/^\s*[.#@a-zA-Z]/.test(line) && line.includes("{")) {
    return [{ kind: "kw", text: line }];
  }
  return [{ kind: "plain", text: line }];
}

function tokenizeMdLine(line: string): CodeToken[] {
  if (/^\s*#{1,6}\s/.test(line)) return [{ kind: "heading", text: line }];
  if (/^\s*```/.test(line)) return [{ kind: "cmt", text: line }];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
  const out: CodeToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    pushToken(out, "plain", line.slice(last, m.index));
    if (m[1]) pushToken(out, "str", m[1]);
    else if (m[2]) pushToken(out, "fn", m[2]);
    else if (m[3]) pushToken(out, "kw", m[3]);
    last = re.lastIndex;
  }
  pushToken(out, "plain", line.slice(last));
  return out.length ? out : [{ kind: "plain", text: "" }];
}

function tokenizeMarkupLine(line: string): CodeToken[] {
  // The comment arm accepts the legacy `--!>` terminator as well as `-->`; a regex
  // that only knows `-->` is the CodeQL js/bad-tag-filter shape and also mis-colours
  // real markup that closes a comment the old way.
  const re = /(<!--[\s\S]*?--!?>)|(<\/?[A-Za-z][\w:-]*|\/>|>)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
  const out: CodeToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    pushToken(out, "plain", line.slice(last, m.index));
    if (m[1]) pushToken(out, "cmt", m[1]);
    else if (m[2]) pushToken(out, "tag", m[2]);
    else if (m[3]) pushToken(out, "str", m[3]);
    last = re.lastIndex;
  }
  pushToken(out, "plain", line.slice(last));
  return out.length ? out : [{ kind: "plain", text: "" }];
}

function tokenizeCodeLine(line: string, hashComment: boolean): CodeToken[] {
  const re = hashComment
    ? /(#[^\n]*)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d[\d_.eExXa-fA-F]*\b)|([A-Za-z_$][\w$]*)/g
    : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d[\d_.eExXa-fA-F]*\b)|([A-Za-z_$][\w$]*)/g;
  const out: CodeToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    pushToken(out, "plain", line.slice(last, m.index));
    if (m[1]) pushToken(out, "cmt", m[1]);
    else if (m[2]) pushToken(out, "str", m[2]);
    else if (m[3]) pushToken(out, "num", m[3]);
    else if (m[4]) {
      const word = m[4];
      if (KEYWORDS.has(word)) pushToken(out, "kw", word);
      else if (line[re.lastIndex] === "(") pushToken(out, "fn", word);
      else pushToken(out, "plain", word);
    }
    last = re.lastIndex;
  }
  pushToken(out, "plain", line.slice(last));
  return out.length ? out : [{ kind: "plain", text: "" }];
}

export function tokenizeLines(content: string, language: string): CodeToken[][] {
  const lines = content.split("\n");
  const fam = content.length > MAX_HIGHLIGHT_CHARS ? "plain" : familyFor(language);
  if (fam === "plain") return lines.map((text) => [{ kind: "plain", text }]);
  return lines.map((line) => {
    if (!line) return [{ kind: "plain", text: "" }];
    if (fam === "json") return tokenizeJsonLine(line);
    if (fam === "css") return tokenizeCssLine(line);
    if (fam === "md") return tokenizeMdLine(line);
    if (fam === "markup") return tokenizeMarkupLine(line);
    return tokenizeCodeLine(line, fam === "hash");
  });
}

export function findMatches(content: string, query: string, caseSensitive: boolean): FindMatch[] {
  if (!query) return [];
  const haystack = caseSensitive ? content : content.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: FindMatch[] = [];
  let idx = 0;
  let line = 1;
  let lineStart = 0;
  while (idx <= haystack.length - needle.length) {
    const hit = haystack.indexOf(needle, idx);
    if (hit < 0) break;
    for (let i = idx; i < hit; i++) {
      if (content.charCodeAt(i) === 10) {
        line++;
        lineStart = i + 1;
      }
    }
    matches.push({ start: hit, end: hit + query.length, line, col: hit - lineStart + 1 });
    idx = hit + Math.max(1, needle.length);
    for (let i = hit; i < idx; i++) {
      if (content.charCodeAt(i) === 10) {
        line++;
        lineStart = i + 1;
      }
    }
  }
  return matches;
}

export function replaceMatchAt(content: string, match: FindMatch, replacement: string): string {
  return content.slice(0, match.start) + replacement + content.slice(match.end);
}

export function replaceAllMatches(
  content: string,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): { next: string; count: number } {
  const matches = findMatches(content, query, caseSensitive);
  if (matches.length === 0) return { next: content, count: 0 };
  let out = "";
  let cursor = 0;
  for (const m of matches) {
    out += content.slice(cursor, m.start) + replacement;
    cursor = m.end;
  }
  out += content.slice(cursor);
  return { next: out, count: matches.length };
}
