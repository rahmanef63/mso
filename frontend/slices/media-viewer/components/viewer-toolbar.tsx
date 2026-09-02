"use client";

import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { openWindow } from "@/features/appshell";
import { cn } from "@/lib/utils";
import type { Sample } from "../lib/samples";
import { editorFor } from "../lib/media";

type Props = {
  file: Sample;
  index: number;
  count: number;
  zoom: number;
  onPrev: () => void;
  onNext: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onDownload: () => void;
};

export function ViewerToolbar({
  file,
  index,
  count,
  zoom,
  onPrev,
  onNext,
  onZoomIn,
  onZoomOut,
  onDownload,
}: Props) {
  const isImage = file.kind === "image";
  const editor = editorFor(file.kind);

  return (
    // Wide: one row (title + controls). Compact (@max-[480px]): the title takes
    // the full first row and the controls wrap underneath with bigger targets.
    // The bottom border is owned by AppFrame's header slot.
    <header className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-background/60 px-3 py-2 backdrop-blur">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold @max-[480px]:basis-full">
        {file.name}
      </span>
      <Badge variant="secondary" className="font-mono text-[10px] uppercase">
        {file.kind}
      </Badge>

      {isImage && (
        <>
          <Separator orientation="vertical" className="mx-1 h-5 @max-[480px]:hidden" />
          <IconBtn label="Zoom out" onClick={onZoomOut} disabled={zoom <= 0.4}>
            <ZoomOut className="size-4" />
          </IconBtn>
          <span className="w-10 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <IconBtn label="Zoom in" onClick={onZoomIn} disabled={zoom >= 3}>
            <ZoomIn className="size-4" />
          </IconBtn>
        </>
      )}

      <Separator orientation="vertical" className="mx-1 h-5 @max-[480px]:hidden" />
      <IconBtn label="Download" onClick={onDownload}>
        <Download className="size-4" />
      </IconBtn>
      {editor && (
        <IconBtn
          label={`Open in ${editor.label}`}
          onClick={() =>
            openWindow(editor.app, file.name, undefined, {
              path: file.name,
              name: file.name,
              kind: file.kind,
            })
          }
        >
          <ExternalLink className="size-4" />
        </IconBtn>
      )}

      <Separator orientation="vertical" className="mx-1 h-5 @max-[480px]:hidden" />
      <IconBtn label="Previous" onClick={onPrev}>
        <ChevronLeft className="size-4" />
      </IconBtn>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {index + 1}/{count}
      </span>
      <IconBtn label="Next" onClick={onNext}>
        <ChevronRight className="size-4" />
      </IconBtn>
    </header>
  );
}

function IconBtn({
  label,
  children,
  className,
  ...rest
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label={label}
          // Slightly larger hit target when the pane is compact (touch).
          className={cn("size-7 @max-[480px]:size-8 [@media(pointer:coarse)]:size-[44px]", className)}
          {...rest}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
