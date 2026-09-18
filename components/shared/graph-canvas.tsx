"use client";

// Owned by the lazy graph boundary, not every page in the cockpit.
import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
  useNodesInitialized,
  useStore,
  type Edge,
  type MiniMapProps,
  type Node,
  type ReactFlowProps,
} from "@xyflow/react";
import { Hand, LayoutGrid, Maximize2, MousePointer2, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { compactGraphViewport } from "./graph-fit";
import { GraphRoutingProvider } from "./graph-routed-edge";

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
  /** On compact panes, keep these nodes readable instead of shrinking an entire wide graph. */
  compactFitNodeIds?: string[];
  compactFitMaxZoom?: number;
};

export function GraphCanvas<NodeType extends Node = Node, EdgeType extends Edge = Edge>(props: GraphCanvasProps<NodeType, EdgeType>) {
  return <ReactFlowProvider><GraphCanvasInner {...props}/></ReactFlowProvider>;
}

function GraphCanvasInner<NodeType extends Node = Node, EdgeType extends Edge = Edge>({
  ariaLabel, initialMode = "select", showMinimap = true, onTidy, fitPadding = 0.22,
  miniMapNodeColor, miniMapNodeStrokeColor, compactFitNodeIds, compactFitMaxZoom = 0.9,
  className, children, fitViewOptions, onKeyDown, ...props
}: GraphCanvasProps<NodeType, EdgeType>) {
  const [mode, setMode] = useState<GraphCanvasMode>(initialMode);
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const flowId = props.id || `mso-graph-${instanceId}`;
  // Use the graph's measured viewport, including height: landscape panes can be
  // wide but far too short to fit a complete graph at a readable scale.
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const initialized = useNodesInitialized();
  const compact = compactGraphViewport(width, height);
  const fitted = useRef(false);
  const [fitRevision, requestFit] = useState(0);
  // Node selection/movement may recreate the array without changing the focus set.
  const focusKey = JSON.stringify(compactFitNodeIds ?? []);
  const focusNodes = useMemo(() => (JSON.parse(focusKey) as string[]).map((id) => ({ id })), [focusKey]);
  const { fitView, zoomIn, zoomOut } = useReactFlow<NodeType, EdgeType>();
  const fit = useCallback(() => void fitView({ padding: fitPadding, duration: 220, ...fitViewOptions }), [fitPadding, fitView, fitViewOptions]);
  const fitResponsive = useCallback((duration: number) => {
    const nodes = compact && focusNodes.length ? focusNodes : undefined;
    void fitView({ padding: compact ? Math.min(fitPadding, 0.14) : fitPadding, duration, ...fitViewOptions, ...(nodes ? { nodes, maxZoom: compactFitMaxZoom } : {}) });
  }, [compact, compactFitMaxZoom, focusNodes, fitPadding, fitView, fitViewOptions]);
  useEffect(() => {
    if (!initialized || width <= 0 || height <= 0) return;
    // A single owner fits only after lazy CSS and node measurement are ready.
    // Cancel whichever frame is pending on resize/unmount, including the inner one.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { fitResponsive(fitted.current ? 220 : 0); fitted.current = true; });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialized, width, height, fitResponsive, fitRevision]);
  const tidy = useCallback(() => { onTidy?.(); requestFit((revision) => revision + 1); }, [onTidy]);
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
  const routingNodes = props.nodes ?? props.defaultNodes ?? [];
  const routingEdges = props.edges ?? props.defaultEdges ?? [];
  return <GraphRoutingProvider nodes={routingNodes} edges={routingEdges}><div className="h-full min-h-0 w-full min-w-0 outline-none" tabIndex={0} onKeyDown={keyboard}>
    <ReactFlow<NodeType, EdgeType>
      {...props}
      id={flowId}
      aria-label={ariaLabel}
      className={cn("mso-graph-flow h-full w-full", className)}
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
        style={compact ? { width: 116, height: 82 } : { width: 180, height: 126 }}
        nodeColor={miniMapNodeColor ?? "var(--text-dim)"}
        nodeStrokeColor={miniMapNodeStrokeColor ?? "var(--border)"}
        nodeStrokeWidth={2} nodeBorderRadius={5}
      /> : null}
      {children}
    </ReactFlow>
  </div></GraphRoutingProvider>;
}
