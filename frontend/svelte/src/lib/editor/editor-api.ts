import {
  ApiError, readTextFile, writeTextFile, type ShellBridge,
} from "../files/files-api.ts";

export { ApiError };
export type { ShellBridge };

export type EditorStats = { lines: number; chars: number; bytes: number };
export type CursorPos = { ln: number; col: number };

export type EditorReadyState = {
  kind: "ready";
  path: string;
  language: string;
  content: string;
  savedContent: string;
  dirty: boolean;
  saving: boolean;
  notice: string | null;
  actionError: string | null;
};

export type EditorState =
  | { kind: "idle" }
  | { kind: "loading"; path: string }
  | EditorReadyState
  | { kind: "error"; path: string; message: string };

export type EditorControllerOptions = {
  fetcher?: typeof fetch;
  bridge?: ShellBridge;
  onDirtyChange?: (dirty: boolean) => void;
};

export const LANGUAGE_OPTIONS = [
  "Plain Text", "TypeScript", "TypeScript JSX", "JavaScript", "JavaScript JSX",
  "Svelte", "Python", "Shell", "JSON", "Markdown", "CSS", "HTML", "YAML",
  "TOML", "Rust", "Go", "SQL", "XML", "C", "C++", "Java", "Dockerfile", "Makefile", "Env",
] as const;

const EXT_LANGUAGES: Record<string, string> = {
  ts: "TypeScript", mts: "TypeScript", cts: "TypeScript", tsx: "TypeScript JSX",
  js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JavaScript JSX",
  svelte: "Svelte", rs: "Rust", py: "Python", go: "Go",
  json: "JSON", jsonc: "JSON", md: "Markdown", mdx: "Markdown",
  css: "CSS", scss: "CSS", html: "HTML", htm: "HTML",
  yml: "YAML", yaml: "YAML", toml: "TOML",
  sh: "Shell", bash: "Shell", zsh: "Shell", sql: "SQL",
  xml: "XML", svg: "XML", c: "C", h: "C",
  cpp: "C++", cc: "C++", hpp: "C++", java: "Java",
};

const utf8Encoder = new TextEncoder();

export function detectLanguage(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "Plain Text";
  const base = (trimmed.split(/[\\/]/).filter(Boolean).pop() ?? trimmed).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "Dockerfile";
  if (base === "makefile" || base === "gnumakefile") return "Makefile";
  if (base === ".env" || base.startsWith(".env.")) return "Env";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "Plain Text";
  return EXT_LANGUAGES[base.slice(dot + 1)] ?? "Plain Text";
}

export function isMarkdownFile(path: string, language?: string): boolean {
  return language === "Markdown" || /\.(md|mdx|markdown)$/i.test(path.trim());
}

export function baseName(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "Untitled";
  return trimmed.split(/[\\/]/).filter(Boolean).pop() ?? trimmed;
}

export function parentDir(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
  if (!trimmed || trimmed === "~" || trimmed === "/") return trimmed || "~";
  const idx = trimmed.lastIndexOf("/");
  if (idx < 0) return "~";
  return idx === 0 ? "/" : trimmed.slice(0, idx);
}

export function joinFsPath(dir: string, name: string): string {
  const cleanName = name.trim().replace(/^\/+/, "");
  if (!cleanName) return dir || "~";
  const cleanDir = dir.trim().replace(/\/+$/, "");
  if (!cleanDir) return `/${cleanName}`;
  return `${cleanDir}/${cleanName}`;
}

export function countStats(content: string): EditorStats {
  if (!content) return { lines: 0, chars: 0, bytes: 0 };
  return {
    lines: content.split(/\r?\n/).length,
    chars: content.length,
    bytes: utf8Encoder.encode(content).length,
  };
}

export function lineColFromOffset(text: string, offset: number): CursorPos {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const lines = text.slice(0, clamped).split("\n");
  return { ln: lines.length, col: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

export function offsetForLine(text: string, targetLine: number): number {
  const lines = text.split("\n");
  const clamped = Math.max(1, Math.min(Math.floor(targetLine), lines.length));
  let offset = 0;
  for (let i = 0; i < clamped - 1; i++) offset += lines[i].length + 1;
  return offset;
}

export function createEditorController(
  update: (state: EditorState) => void,
  options: EditorControllerOptions = {},
) {
  const fetcher = options.fetcher ?? fetch;
  let gen = 0, active: AbortController | undefined, disposed = false;
  let current: EditorReadyState | null = null, lastDirty = false;
  const syncDirty = (dirty: boolean) => {
    if (dirty !== lastDirty) { lastDirty = dirty; options.onDirtyChange?.(dirty); }
  };
  const emit = (next: EditorState) => {
    current = next.kind === "ready" ? next : null;
    syncDirty(next.kind === "ready" ? next.dirty : false);
    update(next);
  };
  async function open(rawPath: string): Promise<boolean> {
    if (disposed) return false;
    const path = rawPath.trim();
    if (!path) { emit({ kind: "error", path: "", message: "Enter a file path to open." }); return false; }
    const run = ++gen; active?.abort(); const ctrl = (active = new AbortController());
    emit({ kind: "loading", path });
    try {
      const content = await readTextFile(path, ctrl.signal, fetcher, options.bridge);
      if (disposed || run !== gen) return false;
      emit({
        kind: "ready", path, language: detectLanguage(path), content, savedContent: content,
        dirty: false, saving: false, notice: null, actionError: null,
      });
      return true;
    } catch (error) {
      if (disposed || run !== gen || ctrl.signal.aborted) return false;
      const message = error instanceof ApiError
        ? error.message : "Could not open file. Check the backend and retry.";
      emit({ kind: "error", path, message });
      return false;
    }
  }
  function updateContent(next: string): void {
    if (disposed || !current || next === current.content) return;
    emit({ ...current, content: next, dirty: next !== current.savedContent, notice: null, actionError: null });
  }
  function revert(): void {
    if (disposed || !current || current.saving || !current.dirty) return;
    emit({
      ...current, content: current.savedContent, dirty: false,
      notice: "Reverted unsaved changes.", actionError: null,
    });
  }
  async function save(): Promise<boolean> {
    if (disposed || !current || current.saving) return false;
    const targetPath = current.path, snapshot = current.content, run = ++gen;
    active?.abort(); const ctrl = (active = new AbortController());
    emit({ ...current, saving: true, notice: null, actionError: null });
    try {
      await writeTextFile(targetPath, snapshot, ctrl.signal, fetcher, options.bridge);
      if (disposed || run !== gen || !current || current.path !== targetPath) return false;
      emit({
        ...current, savedContent: snapshot, dirty: current.content !== snapshot,
        saving: false, notice: "File saved.", actionError: null,
      });
      return true;
    } catch (error) {
      if (disposed || run !== gen || ctrl.signal.aborted || !current) return false;
      const message = error instanceof ApiError
        ? error.message : "Could not save file. Check the backend and retry.";
      emit({ ...current, saving: false, notice: null, actionError: message });
      return false;
    }
  }
  function dispose(): void { disposed = true; gen++; active?.abort(); syncDirty(false); }
  return { open, updateContent, revert, save, dispose };
}
