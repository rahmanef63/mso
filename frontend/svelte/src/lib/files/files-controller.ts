export {
  joinFsPath, validateEntryName, sortFsEntries,
} from "./files-controller-types.ts";
export type {
  FilePreviewState, FilesReadyState, FilesState,
} from "./files-controller-types.ts";

import type { FsEntryMeta } from "./files-api.ts";
import {
  sortFsEntries as sortEntries,
  type FilesState,
} from "./files-controller-types.ts";
export { createFilesController } from "./files-controller-impl.ts";
