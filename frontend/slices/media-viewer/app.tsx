"use client";

import { useCallback, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AppProps } from "@/features/appshell";
import { AppFrame, openWindow, saveAs, usePublishInspector } from "@/features/appshell";
import { SAMPLES } from "./lib/samples";
import { editorFor } from "./lib/media";
import { ViewerToolbar } from "./components/viewer-toolbar";
import { MediaStage } from "./components/media-stage";
import { RemoteView, remoteFile } from "./components/remote-view";

export default function MediaViewer({ payload }: AppProps) {
  const remote = remoteFile(payload);
  return (
    <TooltipProvider delayDuration={200}>
      {remote ? <RemoteView file={remote} /> : <SampleGallery />}
    </TooltipProvider>
  );
}

// Offline sample carousel — the default experience when launched bare.
function SampleGallery() {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const file = SAMPLES[index];

  const go = (delta: number) => {
    setIndex((i) => (i + delta + SAMPLES.length) % SAMPLES.length);
    setZoom(1);
  };

  // Trigger a browser download from the inline data-URI when one exists.
  const onDownload = useCallback(() => {
    if (!file.src) return;
    saveAs(file.src, file.name);
  }, [file]);

  const editor = editorFor(file.kind);
  const actions = [
    { id: "download", label: "Download", run: onDownload },
    ...(editor
      ? [{ id: "edit", label: `Open in ${editor.label}`, run: () => { openWindow(editor.app, file.name); } }]
      : []),
  ];
  usePublishInspector(
    "media-viewer",
    {
      subject: file.name,
      props: [
        { label: "Type", value: file.kind },
        { label: file.dims ? "Dimensions" : "Info", value: file.meta ?? "—" },
        { label: "Source", value: "sample" },
      ],
      actions,
      context: `Viewing ${file.name} (${file.kind})`,
      suggestions: ["Describe this", "Suggest edits", "What format is best?"],
    },
    [file.name, file.kind, file.meta, editor?.app],
  );

  return (
    <AppFrame
      className="bg-background"
      header={
        <ViewerToolbar
          file={file}
          index={index}
          count={SAMPLES.length}
          zoom={zoom}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          onZoomIn={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))}
          onZoomOut={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)))}
          onDownload={onDownload}
        />
      }
      bodyClassName="flex flex-col"
    >
      <MediaStage file={file} zoom={zoom} />
    </AppFrame>
  );
}
