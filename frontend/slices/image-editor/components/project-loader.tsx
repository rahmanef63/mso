"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { useEditor } from "../lib/store";
import { parseProject, readBoundedProjectResponse } from "../lib/project";

// Loads a saved Doc/Project JSON from a URL into the live store on mount —
// accepts a full Project or a bare Doc (wrapped with empty paint). Renders null.
// Reports the OUTCOME (ok flag + error message) so the caller only flips `ready`
// — which un-gates the save-back autosave — on a genuine load. A failed/empty
// fetch must NEVER flip ready, or autosave would clobber the file with the blank
// starter doc.
export function ProjectLoader({
  src,
  onDone,
}: {
  src: string;
  onDone: (ok: boolean, error?: string) => void;
}) {
  const { loadProject } = useEditor();
  useEffect(() => {
    let on = true;
    fetch(src)
      .then(readBoundedProjectResponse)
      .then((text) => {
        if (!on) return;
        const project = parseProject(text);
        if (!project) throw new Error("Project file is malformed, unsafe, or exceeds editor limits");
        loadProject(project);
        onDone(true);
      })
      .catch((err: unknown) => {
        if (on) onDone(false, err instanceof Error ? err.message : "Could not open project");
      });
    return () => { on = false; };
  }, [src, loadProject, onDone]);
  return null;
}

// Inline, non-blocking banner shown when a projectSrc fails to load — makes the
// data-safe outcome (the saved file was NOT clobbered) explicit to the user.
export function ProjectLoadError({ message }: { message: string }) {
  return (
    <div role="alert" className="pointer-events-none absolute inset-x-0 top-2 z-50 flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-md items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive shadow-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          <b className="font-medium">Couldn’t open this project.</b> {message}. Your saved file was left untouched.
        </span>
      </div>
    </div>
  );
}
