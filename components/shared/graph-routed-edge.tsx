"use client";
import { useMemo } from "react";
import { BaseEdge, Position, getSmoothStepPath, useNodes, useEdges, type EdgeProps } from "@xyflow/react";
import { orthogonalRoute, routeLabel, routePath, segmentBlocked, type RoutePoint } from "./graph-route";
const direction = (position: Position) => position === Position.Left ? { x: -1, y: 0 } : position === Position.Right ? { x: 1, y: 0 } : position === Position.Top ? { x: 0, y: -1 } : { x: 0, y: 1 };

/** Use actual measured cards, including collapsed groups. Only presentation changes. */
export function GraphRoutedEdge(props: EdgeProps) {
  const nodes = useNodes(), edges = useEdges();
  const { id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const siblings = edges.filter((edge) => edge.source === source || edge.target === target).map((edge) => edge.id).sort();
  const lane = Math.max(0, siblings.indexOf(id));
  const geometry = useMemo(() => {
    const a = { x: sourceX, y: sourceY }, b = { x: targetX, y: targetY }, sd = direction(sourcePosition), td = direction(targetPosition), escape = 26 + (lane % 5) * 4;
    const start = { x: a.x + sd.x * escape, y: a.y + sd.y * escape }, end = { x: b.x + td.x * escape, y: b.y + td.y * escape };
    const obstacles = nodes.filter((node) => !node.hidden).map((node) => ({ x: node.position.x - 10, y: node.position.y - 10, width: (node.measured?.width ?? node.width ?? 240) + 20, height: (node.measured?.height ?? node.height ?? 120) + 20 }));
    const ownSource = nodes.findIndex((node) => node.id === source), ownTarget = nodes.findIndex((node) => node.id === target);
    const escapes = !segmentBlocked(a, start, obstacles.filter((_, i) => i !== ownSource)) && !segmentBlocked(end, b, obstacles.filter((_, i) => i !== ownTarget));
    const middle = escapes ? orthogonalRoute(start, end, obstacles, lane % 7) : null;
    if (!middle) { const [path, x, y] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, offset: escape }); return { path, label: { x, y }, blocked: true }; }
    const points: RoutePoint[] = [a, ...middle, b];
    return { path: routePath(points), label: routeLabel(middle), blocked: false };
  }, [nodes, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, lane]);
  const anySelected = nodes.some((node) => node.selected), adjacent = nodes.some((node) => node.selected && (node.id === source || node.id === target));
  const style = { ...props.style, strokeWidth: adjacent || props.selected ? 3 : 2, opacity: anySelected && !adjacent && !props.selected ? 0.25 : props.style?.opacity ?? 1, ...(geometry.blocked ? { strokeDasharray: "3 5" } : {}), vectorEffect: "non-scaling-stroke" as const };
  return <g data-routing-state={geometry.blocked ? "overlap" : "clear"}>
    <title>{geometry.blocked ? "No clear route: move overlapping nodes apart" : `${source} → ${target}`}</title>
    <path d={geometry.path} fill="none" stroke="var(--background)" strokeWidth={7} opacity={style.opacity} vectorEffect="non-scaling-stroke" pointerEvents="none"/>
    <BaseEdge id={id} path={geometry.path} markerStart={props.markerStart} markerEnd={props.markerEnd} style={style} interactionWidth={22} label={props.label} labelX={geometry.label.x} labelY={geometry.label.y} labelStyle={{ fill: "var(--foreground)", fontSize: 11, ...props.labelStyle }} labelShowBg labelBgPadding={[5, 3]} labelBgBorderRadius={3} labelBgStyle={{ fill: "var(--background)" }}/>
  </g>;
}
export const graphRoutedEdgeTypes = { routed: GraphRoutedEdge };
