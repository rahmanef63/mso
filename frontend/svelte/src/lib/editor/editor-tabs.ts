import { ApiError, readTextFile, writeTextFile } from "../files/files-api.ts";
import { detectLanguage, type CursorPos } from "./editor-api.ts";

export type {
  EditorTab, MultiTabState, EditorWorkspaceSnapshot, MultiTabOptions,
} from "./editor-tab-types.ts";
import type {
  EditorTab, MultiTabState, EditorWorkspaceSnapshot, MultiTabOptions,
} from "./editor-tab-types.ts";
export { createMultiTabEditor } from "./editor-tabs-impl.ts";
