"use client";

import { useCallback, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type Edge,
  type Node,
  type ReactFlowProps,
} from "@xyflow/react";
import { Hand, LayoutGrid, MousePointer2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type GraphCanvasMode = "select" | "pan";

type GraphCanvasProps<NodeType extends Node = Node, EdgeType extends Edge = Edge> =
  Omit<ReactFlowProps<NodeType, EdgeType>, "panOnDrag" | "panOnScroll" | "selectionOnDrag" | "selectionMode"> & {
    ariaLabel: string;
    initialMode?: GraphCanvasMode;
    showMinimap?: boolean;
    onTidy?: () => void;
    fitPadding?: number;
  };

export function GraphCanvas<NodeType extends Node = Node, EdgeType extends Edge = Edge>(props: GraphCanvasProps<NodeType, EdgeType>) {
  return <ReactFlowProvider><GraphCanvasInner {...props} /></ReactFlowProvider>;
}

function GraphCanvasInner<NodeType extends Node = Node, EdgeType extends Edge = Edge>({
  ariaLabel,
  initialMode = "select",
  showMinimap = true,
  onTidy,
  fitPadding = 0.22,
  className,
  children,
  fitViewOptions,
  onKeyDown,
  ...props
}: GraphCanvasProps<NodeType, EdgeType>) {
  const [mode, setMode] = useState<GraphCanvasMode>(initialMode);
  const { fitView } = useReactFlow<NodeType, EdgeType>();
  const fit = useCallback(() => void fitView({ padding: fitPadding, duration: 220, ...fitViewOptions }), [fitPadding, fitView, fitViewOptions]);
  const tidy = useCallback(() => {
    onTidy?.();
    requestAnimationFrame(() => requestAnimationFrame(fit));
  }, [fit, onTidy]);

  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest("input,textarea,select,[contenteditable='true']")) return;
    const key = event.key.toLowerCase();
    if (key === "v") { event.preventDefault(); setMode("select"); }
    if (key === "h") { event.preventDefault(); setMode("pan"); }
    if (key === "f") { event.preventDefault(); fit(); }
  };

  return (
    <div className="h-full w-full outline-none" tabIndex={0} onKeyDown={keyboard}>
    <ReactFlow<NodeType, EdgeType>
      {...props}
      aria-label={ariaLabel}
      className={cn("mso-graph-flow h-full w-full", className)}
      fitView
      fitViewOptions={{ padding: fitPadding, duration: 220, ...fitViewOptions }}
      minZoom={props.minZoom ?? 0.18}
      maxZoom={props.maxZoom ?? 2.5}
      selectionMode={SelectionMode.Partial}
      selectionOnDrag={mode === "select"}
      panOnDrag={mode === "pan" ? true : [1, 2]}
      panOnScroll={mode === "select"}
      zoomOnScroll={mode === "pan"}
      zoomOnPinch
      zoomActivationKeyCode={["Meta", "Control"]}
      panActivationKeyCode="Space"
      multiSelectionKeyCode={["Meta", "Control"]}
      preventScrolling
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.25} color="var(--sep-strong)" />
      <Controls position="bottom-left" showInteractive={false} fitViewOptions={{ padding: fitPadding, duration: 220 }}>
        <ControlButton aria-label="Select mode" title="Select (V)" onClick={() => setMode("select")} className={mode === "select" ? "is-active" : undefined}>
          <MousePointer2 aria-hidden />
        </ControlButton>
        <ControlButton aria-label="Pan mode" title="Pan (H or hold Space)" onClick={() => setMode("pan")} className={mode === "pan" ? "is-active" : undefined}>
          <Hand aria-hidden />
        </ControlButton>
        {onTidy ? <ControlButton aria-label="Tidy up" title="Tidy up" onClick={tidy}><LayoutGrid aria-hidden /></ControlButton> : null}
      </Controls>
      {showMinimap ? <MiniMap pannable zoomable position="bottom-right" ariaLabel={`${ariaLabel} minimap`} /> : null}
      {children}
    </ReactFlow>
    </div>
  );
}
