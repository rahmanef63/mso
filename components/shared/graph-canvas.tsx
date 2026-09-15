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
  type MiniMapProps,
  type Node,
  type ReactFlowProps,
} from "@xyflow/react";
import { Hand, LayoutGrid, Maximize2, MousePointer2, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

export type GraphCanvasMode = "select" | "pan";
type MiniMapNodeColor = MiniMapProps["nodeColor"];
type GraphCanvasProps<NodeType extends Node = Node, EdgeType extends Edge = Edge> = Omit<
  ReactFlowProps<NodeType, EdgeType>,
  "panOnDrag" | "panOnScroll" | "selectionOnDrag" | "selectionMode"
> & {
  ariaLabel: string;
  initialMode?: GraphCanvasMode;
  showMinimap?: boolean;
  onTidy?: () => void;
  fitPadding?: number;
  miniMapNodeColor?: MiniMapNodeColor;
  miniMapNodeStrokeColor?: MiniMapNodeColor;
};

export function GraphCanvas<NodeType extends Node = Node, EdgeType extends Edge = Edge>(props: GraphCanvasProps<NodeType, EdgeType>) {
  return <ReactFlowProvider><GraphCanvasInner {...props}/></ReactFlowProvider>;
}

function GraphCanvasInner<NodeType extends Node = Node, EdgeType extends Edge = Edge>({
  ariaLabel, initialMode = "select", showMinimap = true, onTidy, fitPadding = 0.22,
  miniMapNodeColor, miniMapNodeStrokeColor, className, children, fitViewOptions, onKeyDown, ...props
}: GraphCanvasProps<NodeType, EdgeType>) {
  const [mode, setMode] = useState<GraphCanvasMode>(initialMode);
  const { fitView, zoomIn, zoomOut } = useReactFlow<NodeType, EdgeType>();
  const fit = useCallback(() => void fitView({ padding: fitPadding, duration: 220, ...fitViewOptions }), [fitPadding, fitView, fitViewOptions]);
  const tidy = useCallback(() => { onTidy?.(); requestAnimationFrame(() => requestAnimationFrame(fit)); }, [fit, onTidy]);
  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event); if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest("input,textarea,select,[contenteditable='true']")) return;
    const key = event.key.toLowerCase();
    if (key === "v") { event.preventDefault(); setMode("select"); }
    if (key === "h") { event.preventDefault(); setMode("pan"); }
    if (key === "f") { event.preventDefault(); fit(); }
    if (key === "+" || key === "=") { event.preventDefault(); void zoomIn({ duration: 160 }); }
    if (key === "-") { event.preventDefault(); void zoomOut({ duration: 160 }); }
  };
  return <div className="h-full w-full outline-none" tabIndex={0} onKeyDown={keyboard}>
    <ReactFlow<NodeType, EdgeType>
      {...props}
      aria-label={ariaLabel}
      className={cn("mso-graph-flow h-full w-full", className)}
      fitView fitViewOptions={{ padding: fitPadding, duration: 220, ...fitViewOptions }}
      minZoom={props.minZoom ?? 0.18} maxZoom={props.maxZoom ?? 2.5}
      selectionMode={SelectionMode.Partial} selectionOnDrag={mode === "select"}
      panOnDrag={mode === "pan" ? true : [1, 2]} panOnScroll={mode === "select"}
      zoomOnScroll={mode === "pan"} zoomOnPinch zoomActivationKeyCode={["Meta", "Control"]}
      panActivationKeyCode="Space" multiSelectionKeyCode={["Meta", "Control"]} preventScrolling
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.25} color="var(--sep-strong)"/>
      <Controls position="bottom-left" showZoom={false} showFitView={false} showInteractive={false}>
        <ControlButton aria-label="Select mode" title="Select (V)" onClick={() => setMode("select")} className={mode === "select" ? "is-active" : undefined}><MousePointer2 aria-hidden/></ControlButton>
        <ControlButton aria-label="Pan mode" title="Pan (H or hold Space)" onClick={() => setMode("pan")} className={mode === "pan" ? "is-active" : undefined}><Hand aria-hidden/></ControlButton>
        <ControlButton aria-label="Zoom in" title="Zoom in (+)" onClick={() => void zoomIn({ duration: 160 })}><ZoomIn aria-hidden/></ControlButton>
        <ControlButton aria-label="Zoom out" title="Zoom out (-)" onClick={() => void zoomOut({ duration: 160 })}><ZoomOut aria-hidden/></ControlButton>
        <ControlButton aria-label="Fit view" title="Fit view (F)" onClick={fit}><Maximize2 aria-hidden/></ControlButton>
        {onTidy ? <ControlButton aria-label="Tidy up" title="Tidy up" onClick={tidy} className="mso-graph-secondary-control"><LayoutGrid aria-hidden/></ControlButton> : null}
      </Controls>
      {showMinimap ? <MiniMap
        pannable zoomable position="bottom-right" ariaLabel={`${ariaLabel} minimap`}
        nodeColor={miniMapNodeColor ?? "var(--text-dim)"}
        nodeStrokeColor={miniMapNodeStrokeColor ?? "var(--border)"}
        nodeStrokeWidth={2} nodeBorderRadius={5}
      /> : null}
      {children}
    </ReactFlow>
  </div>;
}
