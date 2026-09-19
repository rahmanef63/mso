"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { BaseEdge, Position, getSmoothStepPath, type Edge, type EdgeProps, type Node } from "@xyflow/react";
import {
  createRoutingScene, GraphRouteCache,
  type ConnectorRequest, type RouteSide, type RoutingScene,
} from "./graph-route-cache";

type RoutingContext = { scene: RoutingScene; cache: GraphRouteCache; selectedIds: Set<string> };
const GraphRoutingContext = createContext<RoutingContext | null>(null);
const side = (position: Position): RouteSide =>
  position === Position.Left ? "left" : position === Position.Right ? "right" : position === Position.Top ? "top" : "bottom";

/** One shared obstacle scene/cache per canvas update; individual edges never subscribe to the full node array. */
export function GraphRoutingProvider({ nodes, edges, children }: {
  nodes: readonly Node[];
  edges: readonly Edge[];
  children: ReactNode;
}) {
  const scene = useMemo(() => createRoutingScene(
    nodes.filter((node) => !node.hidden).map((node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      width: node.measured?.width ?? node.width ?? 240,
      height: node.measured?.height ?? node.height ?? 120,
    })),
    edges.filter((edge) => !edge.hidden).map(({ id, source, target }) => ({ id, source, target })),
  ), [edges, nodes]);
  const [cache] = useState(() => new GraphRouteCache());
  const selectedIds = useMemo(() => new Set(nodes.filter((node) => node.selected).map((node) => node.id)), [nodes]);
  const value = useMemo(() => ({ scene, cache, selectedIds }), [cache, scene, selectedIds]);
  return <GraphRoutingContext.Provider value={value}>{children}</GraphRoutingContext.Provider>;
}

/** Measured, obstacle-aware edge using the canvas-shared scene and bounded route memo. */
export function GraphRoutedEdge(props: EdgeProps) {
  const routing = useContext(GraphRoutingContext);
  const { id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const request = useMemo<ConnectorRequest>(() => ({
    id, source, target,
    a: { x: sourceX, y: sourceY },
    b: { x: targetX, y: targetY },
    sourceSide: side(sourcePosition),
    targetSide: side(targetPosition),
  }), [id, source, sourcePosition, sourceX, sourceY, target, targetPosition, targetX, targetY]);
  const fallback = useMemo(() => {
    const [path, x, y] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, offset: 26 });
    return { path, label: { x, y }, blocked: true };
  }, [sourcePosition, sourceX, sourceY, targetPosition, targetX, targetY]);
  const geometry = useMemo(() => routing ? routing.cache.resolve(routing.scene, request) : fallback, [fallback, request, routing]);
  const anySelected = Boolean(routing?.selectedIds.size);
  const adjacent = Boolean(routing?.selectedIds.has(source) || routing?.selectedIds.has(target));
  const style = {
    ...props.style,
    strokeWidth: adjacent || props.selected ? 3 : 2,
    opacity: anySelected && !adjacent && !props.selected ? 0.25 : props.style?.opacity ?? 1,
    ...(geometry.blocked ? { strokeDasharray: "3 5" } : {}),
    vectorEffect: "non-scaling-stroke" as const,
  };
  return <g data-routing-state={geometry.blocked ? "overlap" : "clear"}>
    <title>{geometry.blocked ? "No clear route: move overlapping nodes apart" : `${source} → ${target}`}</title>
    <path d={geometry.path} fill="none" stroke="var(--background)" strokeWidth={7} opacity={style.opacity} vectorEffect="non-scaling-stroke" pointerEvents="none"/>
    <BaseEdge id={id} path={geometry.path} markerStart={props.markerStart} markerEnd={props.markerEnd} style={style} interactionWidth={22} label={props.label} labelX={geometry.label.x} labelY={geometry.label.y} labelStyle={{ fill: "var(--foreground)", fontSize: 11, ...props.labelStyle }} labelShowBg labelBgPadding={[5, 3]} labelBgBorderRadius={3} labelBgStyle={{ fill: "var(--background)" }}/>
  </g>;
}
export const graphRoutedEdgeTypes = { routed: GraphRoutedEdge };
