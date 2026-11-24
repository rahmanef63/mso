import type { CursorPos } from "./editor-api.ts";
import type { ShellBridge } from "../files/files-api.ts";

export type EditorTab = {
  path: string;
  language: string;
  content: string;
  savedContent: string;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  notice: string | null;
  actionError: string | null;
  cursor: CursorPos;
  isNew: boolean;
};

export type MultiTabState = {
  tabs: EditorTab[];
  activePath: string | null;
  anyDirty: boolean;
  globalError: string | null;
};

export type EditorWorkspaceSnapshot = {
  tabs: Array<Pick<EditorTab, "path" | "language" | "content" | "savedContent" | "dirty" | "isNew">>;
  activePath: string | null;
};

export type MultiTabOptions = {
  fetcher?: typeof fetch;
  bridge?: ShellBridge;
  onDirtyChange?: (dirty: boolean) => void;
};
