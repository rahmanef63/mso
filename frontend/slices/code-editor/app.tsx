"use client";
// audit-allow-hex: VS-Code-dark editor chrome palette is the slice's design, not themable tokens.

import { useEffect, useState } from "react";
import { Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppProps } from "./lib/host";
import { usePublishInspector } from "./lib/host";
import { AppSidebar } from "./components/host-sidebar";
import { FileTree } from "./components/file-tree";
import { EditorToolbar } from "./components/editor-toolbar";
import { EditorSurface } from "./components/editor-surface";
import { PreviewPane } from "./components/preview-pane";
import { TabStrip } from "./components/tab-strip";
import { StatusBar } from "./components/status-bar";
import { NewFileModal } from "./components/new-file-modal";
import { CloseGuardDialog } from "./components/close-guard-dialog";
import { IntegratedTerminal } from "./components/integrated-terminal";
import { useEditor } from "./lib/use-editor";
import { useCloseGuard } from "./lib/use-close-guard";
import { isPreviewable } from "./lib/build-preview";
import { baseName, langOf } from "./lib/util";
import { parentPath } from "@/lib/path";

const TAB_SIZE = 2;

// Extract a `{ path }` from the cross-app window payload, if present.
function payloadPath(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "path" in payload) {
    const p = (payload as { path?: unknown }).path;
    if (typeof p === "string" && p.length) return p;
  }
  return null;
}

// Default export so os-shell can lazy-load it as a window app.
export default function CodeEditor({ payload, winId }: AppProps) {
  const ed = useEditor();
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [pos, setPos] = useState({ ln: 1, col: 1 });
  const [preview, setPreview] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);

  // Save-on-shortcut + dirty-window close guard. `saveRef` always points at the
  // current save (no stale closures in the global listener / Inspector action).
  const { confirmClose, setConfirmClose, forceClose, saveThenClose, saveRef } =
    useCloseGuard(winId, ed.dirty, ed.save);
  const save = () => void saveRef.current();

  // Open the payload path (cross-app "open this file"). Re-runs when the host
  // updates the payload on a re-open. Falls back to the seed when absent.
  const path = payloadPath(payload);
  useEffect(() => {
    if (path) ed.openPath(path);
    else ed.open("/Projects/counter.tsx");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const lang = ed.active ? langOf(ed.active) : "txt";
  const lineCount = ed.active != null ? ed.value.split("\n").length : 0;
  const canPreview = ed.active != null && isPreviewable(ed.active);
  const showPreview = preview && canPreview;

  // Surface editor state + actions to the shell AI Inspector. Re-publishes when
  // the open file, language, length, or dirty flag changes.
  usePublishInspector(
    "code-editor",
    {
      subject: ed.active ? baseName(ed.active) : "No file open",
      props: [
        { label: "File", value: ed.active ?? "—" },
        { label: "Language", value: lang },
        { label: "Lines", value: String(lineCount) },
        { label: "Unsaved", value: ed.dirty ? "yes" : "no" },
      ],
      actions: [
        { id: "save", label: "Save", run: save },
        { id: "new", label: "New file", run: () => setNewOpen(true) },
      ],
      context: `Code editor with ${ed.active ?? "no file"} open (${lang}).`,
      suggestions: ["Explain this file", "Find bugs", "Add a comment header"],
    },
    [ed.active, lang, lineCount, ed.dirty],
  );

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-[#1e1e22]">
      {/* Explorer: inline rail on wide windows, left Sheet on narrow/mobile. */}
      <AppSidebar
        open={explorerOpen}
        onOpenChange={setExplorerOpen}
        title="Explorer"
        railClassName="bg-[#16161a] border-[#2a2a30]"
        sheetClassName="bg-[#16161a] border-[#2a2a30]"
      >
        <FileTree
          rootPath="~"
          rootLabel="Explorer"
          activePath={ed.active}
          onOpenFile={(p) => { ed.open(p); setExplorerOpen(false); }}
          className="min-h-0 flex-1"
        />
      </AppSidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        <TabStrip
          tabs={ed.tabs}
          active={ed.active}
          dirtyOf={(p) => ed.buffers[p] !== ed.disk[p]}
          onSelect={ed.setActive}
          onClose={ed.close}
          onNew={() => setNewOpen(true)}
        />
        <EditorToolbar
          lang={lang}
          dirty={ed.dirty}
          canSave={ed.active != null}
          canPreview={canPreview}
          previewing={showPreview}
          terminalOpen={terminalOpen}
          onOpenExplorer={() => setExplorerOpen(true)}
          onTogglePreview={() => setPreview((p) => !p)}
          onToggleTerminal={() => setTerminalOpen((open) => !open)}
          onSave={save}
        />

        {/* Editor + optional live preview: side-by-side on a wide window, stacked
            on a narrow one (container query against the window width). */}
        <div className="flex min-h-0 flex-1 flex-col @[760px]:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {ed.active != null ? (
              <EditorSurface
                value={ed.value}
                onChange={ed.edit}
                lang={lang}
                onCursor={setPos}
                onSave={save}
              />
            ) : (
              <div className="grid flex-1 place-items-center text-[#7d8590]">
                <div className="text-center">
                  <div
                    className="mx-auto mb-3.5 grid size-14 place-items-center rounded-2xl text-white"
                    style={{ background: "linear-gradient(160deg,#3aa0ff,#1f6dff)" }}
                  >
                    <Code2 className="size-7" />
                  </div>
                  <div className="text-[15px] font-bold text-[#c7ccd4]">
                    No file open
                  </div>
                  <p className="mx-auto mt-1.5 max-w-[320px] text-[12.5px] leading-relaxed">
                    Open a file from the Explorer or start something new.
                  </p>
                  <div className="mt-3.5">
                    <Button size="sm" onClick={() => setNewOpen(true)}>
                      New file
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
          {showPreview && ed.active != null && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-[#2a2a30] @[760px]:border-l @[760px]:border-t-0">
              <PreviewPane path={ed.active} code={ed.value} />
            </div>
          )}
        </div>

        {terminalOpen && <IntegratedTerminal cwd={path ? parentPath(path) : "~"} />}

        <StatusBar
          path={ed.active}
          ln={pos.ln}
          col={pos.col}
          tabSize={TAB_SIZE}
          dirty={ed.dirty}
          saveState={ed.saveState}
        />
      </div>

      <NewFileModal open={newOpen} onOpenChange={setNewOpen} onCreate={ed.create} />

      <CloseGuardDialog
        open={confirmClose}
        onOpenChange={(o) => !o && setConfirmClose(false)}
        fileLabel={ed.active ? baseName(ed.active) : "This file"}
        onSave={() => void saveThenClose()}
        onDiscard={() => { setConfirmClose(false); forceClose(); }}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  );
}
