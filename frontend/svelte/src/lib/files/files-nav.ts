import type { FilesState } from "./files-controller.ts";

export type MobileNavSink = (nav: { title: string; backLabel: string; onBack: () => void } | null) => void;

// Single source of truth for the mobile back-navigation contract across the
// five Files shell variants. Called from a component $effect so it stays reactive.
export function syncFilesMobileNav(input: {
  mobile: boolean;
  view: FilesState;
  folderTitle: string;
  parentTitle: string;
  closePreview: () => void;
  goParent: () => void;
  sink: MobileNavSink | undefined;
}): void {
  const { sink } = input;
  if (!sink) return;
  if (!input.mobile || input.view.kind !== "ready") { sink(null); return; }
  if (input.view.preview.kind !== "idle") {
    sink({ title: input.view.preview.name, backLabel: input.folderTitle, onBack: input.closePreview });
    return;
  }
  if (input.view.parent) {
    sink({ title: input.folderTitle, backLabel: input.parentTitle, onBack: input.goParent });
    return;
  }
  sink(null);
}
