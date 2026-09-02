"use client";

import { usePublishInspector } from "@/features/appshell";
import { fmtGiB } from "../lib/format";
import type { UseFiles } from "./use-files";

// Publish this app's live state to the shell AI Inspector. Re-runs when the
// current dir, item count, or selection changes; cleared on unmount.
export function useFilesInspector(
  fs: UseFiles,
  selectedCount: number,
  onEmptyTrash: () => void,
) {
  const entryCount = fs.entries?.length ?? 0;
  const usageStr = fs.usage
    ? `${fmtGiB(fs.usage.used)} of ${fmtGiB(fs.usage.total)}`
    : "—";

  usePublishInspector(
    "files-manager",
    {
      subject: fs.path,
      props: [
        { label: "Path", value: fs.path },
        { label: "Items", value: String(entryCount) },
        { label: "Selected", value: String(selectedCount) },
        { label: "Storage", value: usageStr },
      ],
      actions: [
        { id: "newfolder", label: "New folder", run: () => fs.mkdir() },
        { id: "refresh", label: "Refresh", run: () => fs.refresh() },
        { id: "trash", label: "Empty Trash", run: () => onEmptyTrash() },
      ],
      context: `File manager browsing ${fs.path} with ${entryCount} items.`,
      suggestions: ["What's taking space?", "Organize this folder", "Find large files"],
    },
    [fs.path, entryCount, selectedCount],
  );
}
