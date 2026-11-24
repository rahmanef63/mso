import { createFilesController, type FilesState } from "./files-controller.ts";
import { getWinState, setWinState } from "../shell/window-feature-state.ts";
import type { FilesViewMode } from "./FilesChromeHeader.svelte";

export type FilesController = ReturnType<typeof createFilesController>;

export type SavedFilesDraft = { editing: boolean; editPath: string | null; draft: string };

export type MountState = {
  view: FilesState;
  viewMode: FilesViewMode;
  editing: boolean;
  editPath: string | null;
  draft: string;
  creatingFolder: boolean;
  confirmDeleteName: string | null;
  renamingName: string | null;
  openMenuName: string | null;
  zipTargets: string[] | null;
  selectedNames: ReadonlySet<string>;
};

export type MountDeps = {
  winId: string | undefined;
  initialPath: string;
  loadUsage: (path: string) => Promise<void>;
  onState: (next: FilesState) => void;
  onPath: (path: string) => void;
};

export function mountFilesWorkspace(deps: MountDeps, state: MountState) {
  let usageAutoLoaded = false;
  let lastPath = "";
  const savedDraft = getWinState<SavedFilesDraft | null>(deps.winId, "files.draft", null);
  state.viewMode = getWinState<FilesViewMode>(deps.winId, "files.viewMode", "list");
  const restoredPath = getWinState<string>(deps.winId, "files.path", deps.initialPath);

  const controller: FilesController = createFilesController((next) => {
    deps.onState(next);
    if (next.kind !== "ready") {
      state.creatingFolder = false;
      state.confirmDeleteName = null;
      state.renamingName = null;
      state.editing = false;
      state.editPath = null;
      return;
    }
    setWinState(deps.winId, "files.path", next.path);
    deps.onPath(next.path);
    if (next.roots.length > 0 && !usageAutoLoaded) {
      usageAutoLoaded = true;
      void deps.loadUsage(next.path);
    }
    if (next.path !== lastPath) {
      lastPath = next.path;
      state.creatingFolder = false;
      state.confirmDeleteName = null;
      state.renamingName = null;
      state.openMenuName = null;
      state.zipTargets = null;
      state.selectedNames = new Set();
      if (!savedDraft?.editing) {
        state.editing = false;
        state.editPath = null;
      }
    } else if (next.preview.kind !== "ready" || next.preview.path !== state.editPath) {
      state.editing = false;
      state.editPath = null;
    }
  }, { initialPath: restoredPath });

  const ready = controller.openDir(restoredPath).then(() => {
    if (!savedDraft?.editing || !savedDraft.editPath) return;
    const name = savedDraft.editPath.split("/").pop() ?? savedDraft.editPath;
    return controller.openFile({ name }).then(() => {
      state.editing = true;
      state.editPath = savedDraft.editPath;
      state.draft = savedDraft.draft;
    });
  });

  return { controller, ready };
}
