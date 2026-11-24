import { detectLanguage } from "./editor-api.ts";
import type { EditorTab } from "./editor-tab-types.ts";

export function makeTab(path: string, overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    path,
    language: detectLanguage(path),
    content: "",
    savedContent: "",
    dirty: false,
    loading: false,
    saving: false,
    error: null,
    notice: null,
    actionError: null,
    cursor: { ln: 1, col: 1 },
    isNew: false,
    ...overrides,
  };
}
