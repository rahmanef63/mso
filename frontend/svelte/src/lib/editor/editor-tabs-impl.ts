import { detectLanguage, type CursorPos } from "./editor-api.ts";
import { ApiError, readTextFile, writeTextFile } from "../files/files-api.ts";
import type {
  EditorTab, EditorWorkspaceSnapshot, MultiTabOptions, MultiTabState,
} from "./editor-tab-types.ts";
import { makeTab } from "./editor-tab-factory.ts";

export function createMultiTabEditor(
  update: (state: MultiTabState) => void,
  options: MultiTabOptions = {},
) {
  const fetcher = options.fetcher ?? fetch;
  const controllers = new Map<string, AbortController>();
  const generations = new Map<string, number>();
  let tabs: EditorTab[] = [];
  let activePath: string | null = null;
  let globalError: string | null = null;
  let lastDirty = false;
  let disposed = false;

  const emit = () => {
    const anyDirty = tabs.some((t) => t.dirty);
    if (anyDirty !== lastDirty) { lastDirty = anyDirty; options.onDirtyChange?.(anyDirty); }
    update({ tabs: tabs.map((t) => ({ ...t })), activePath, anyDirty, globalError });
  };

  const nextGen = (path: string) => {
    controllers.get(path)?.abort();
    const ctrl = new AbortController();
    controllers.set(path, ctrl);
    const run = (generations.get(path) ?? 0) + 1;
    generations.set(path, run);
    return { run, ctrl };
  };

  const patchTab = (path: string, patch: Partial<EditorTab>) => {
    tabs = tabs.map((t) => (t.path === path ? { ...t, ...patch } : t));
  };

  const findTab = (path?: string | null) => {
    const target = path ?? activePath;
    return target ? tabs.find((t) => t.path === target) : undefined;
  };

  async function openTab(rawPath: string): Promise<boolean> {
    if (disposed) return false;
    const path = rawPath.trim();
    if (!path) { globalError = "Enter a file path to open."; emit(); return false; }
    globalError = null;
    const existing = tabs.find((t) => t.path === path);
    if (existing && !existing.error) { activePath = path; emit(); return true; }
    if (!existing) tabs = [...tabs, makeTab(path, { loading: true })];
    else patchTab(path, { loading: true, error: null, actionError: null, notice: null });
    activePath = path;
    emit();

    const { run, ctrl } = nextGen(path);
    try {
      const content = await readTextFile(path, ctrl.signal, fetcher, options.bridge);
      if (disposed || generations.get(path) !== run) return false;
      const cur = tabs.find((t) => t.path === path);
      if (!cur) return false;
      patchTab(path, {
        loading: false,
        error: null,
        savedContent: content,
        content: cur.dirty ? cur.content : content,
        dirty: cur.dirty ? cur.content !== content : false,
        isNew: false,
      });
      emit();
      return true;
    } catch (err) {
      if (disposed || generations.get(path) !== run || ctrl.signal.aborted) return false;
      const message = err instanceof ApiError
        ? err.message : "Could not open file. Check the backend and retry.";
      patchTab(path, { loading: false, error: message });
      emit();
      return false;
    }
  }

  function createTab(rawPath: string, initialContent = ""): boolean {
    if (disposed) return false;
    const path = rawPath.trim();
    if (!path) { globalError = "Enter a file path for the new file."; emit(); return false; }
    globalError = null;
    if (tabs.some((t) => t.path === path)) { activePath = path; emit(); return true; }
    tabs = [
      ...tabs,
      makeTab(path, {
        content: initialContent,
        dirty: true,
        isNew: true,
        notice: "New unsaved file. Save to write it to disk.",
      }),
    ];
    activePath = path;
    emit();
    return true;
  }

  function selectTab(path: string): void {
    if (disposed || !tabs.some((t) => t.path === path)) return;
    activePath = path;
    globalError = null;
    emit();
  }

  function updateContent(next: string, path?: string): void {
    const tab = findTab(path);
    if (disposed || !tab || tab.loading || next === tab.content) return;
    patchTab(tab.path, {
      content: next, dirty: tab.isNew || next !== tab.savedContent, notice: null, actionError: null,
    });
    emit();
  }

  function setLanguage(language: string, path?: string): void {
    const tab = findTab(path);
    if (disposed || !tab || tab.language === language) return;
    patchTab(tab.path, { language });
    emit();
  }

  function setCursor(cursor: CursorPos, path?: string): void {
    const tab = findTab(path);
    if (disposed || !tab || (tab.cursor.ln === cursor.ln && tab.cursor.col === cursor.col)) return;
    patchTab(tab.path, { cursor });
    emit();
  }

  function revertTab(path?: string): void {
    const tab = findTab(path);
    if (disposed || !tab || tab.saving || !tab.dirty) return;
    patchTab(tab.path, {
      content: tab.savedContent, dirty: false, notice: "Reverted unsaved changes.", actionError: null,
    });
    emit();
  }

  async function saveTab(path?: string): Promise<boolean> {
    const tab = findTab(path);
    if (disposed || !tab || tab.loading || tab.saving || tab.error) return false;
    const targetPath = tab.path, contentSnap = tab.content;
    const { run, ctrl } = nextGen(targetPath);
    patchTab(targetPath, { saving: true, notice: null, actionError: null });
    emit();
    try {
      await writeTextFile(targetPath, contentSnap, ctrl.signal, fetcher, options.bridge);
      if (disposed || generations.get(targetPath) !== run) return false;
      const latest = tabs.find((t) => t.path === targetPath);
      if (!latest) return false;
      patchTab(targetPath, {
        savedContent: contentSnap, dirty: latest.content !== contentSnap,
        saving: false, isNew: false, notice: "File saved.", actionError: null,
      });
      emit();
      return true;
    } catch (err) {
      if (disposed || generations.get(targetPath) !== run || ctrl.signal.aborted) return false;
      const message = err instanceof ApiError
        ? err.message : "Could not save file. Check the backend and retry.";
      patchTab(targetPath, { saving: false, notice: null, actionError: message });
      emit();
      return false;
    }
  }

  function closeTab(path: string, force = false): "closed" | "needs-confirm" | "missing" {
    if (disposed) return "missing";
    const idx = tabs.findIndex((t) => t.path === path);
    if (idx < 0) return "missing";
    if (tabs[idx].dirty && !force) return "needs-confirm";
    controllers.get(path)?.abort();
    controllers.delete(path);
    tabs = tabs.filter((t) => t.path !== path);
    if (activePath === path) activePath = (tabs[idx] ?? tabs[idx - 1])?.path ?? null;
    emit();
    return "closed";
  }

  function snapshot(): EditorWorkspaceSnapshot {
    return {
      activePath,
      tabs: tabs.filter((t) => !t.loading && !t.error).map((t) => ({
        path: t.path, language: t.language, content: t.content,
        savedContent: t.savedContent, dirty: t.dirty, isNew: t.isNew,
      })),
    };
  }

  function restoreSnapshot(snap: EditorWorkspaceSnapshot | null | undefined): boolean {
    if (disposed || !snap || !Array.isArray(snap.tabs) || snap.tabs.length === 0) return false;
    tabs = snap.tabs.map((t) => makeTab(t.path, {
      language: t.language || detectLanguage(t.path),
      content: t.content, savedContent: t.savedContent, dirty: Boolean(t.dirty), isNew: Boolean(t.isNew),
    }));
    activePath = snap.activePath && tabs.some((t) => t.path === snap.activePath)
      ? snap.activePath : tabs[0].path;
    globalError = null;
    emit();
    return true;
  }

  function dispose(): void {
    disposed = true;
    for (const ctrl of controllers.values()) ctrl.abort();
    controllers.clear();
  }

  return {
    openTab, createTab, selectTab, updateContent, setLanguage,
    setCursor, revertTab, saveTab, closeTab, snapshot, restoreSnapshot, dispose,
  };
}
