"use client";
import { useCallback, useMemo, useState } from "react";
import { applyEdgeChanges, applyNodeChanges, type Edge, type EdgeChange, type Node, type NodeChange } from "@xyflow/react";
export type GraphProjection<N extends Node, E extends Edge> = { nodes: N[]; edges: E[] };
type Snapshot<N extends Node, E extends Edge> = GraphProjection<N, E> & { source: GraphProjection<N, E> };

/** One owner for transient selection/measurement/drag state. No effect-to-selection feedback. */
export function reconcileGraphProjection<N extends Node, E extends Edge>(source: GraphProjection<N, E>, previous: Snapshot<N, E>): Snapshot<N, E> {
  if (source === previous.source) return previous;
  const oldNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const addedSelection = source.nodes.some((node) => node.selected && !oldNodes.has(node.id));
  const oldEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
  return { source,
    nodes: source.nodes.map((node) => ({ ...node, measured: oldNodes.get(node.id)?.measured ?? node.measured, selected: addedSelection ? Boolean(node.selected) : oldNodes.get(node.id)?.selected ?? node.selected })),
    edges: source.edges.map((edge) => ({ ...edge, selected: oldEdges.get(edge.id)?.selected ?? edge.selected })),
  };
}
export function useGraphProjection<N extends Node, E extends Edge>(source: GraphProjection<N, E>) {
  const [snapshot, setSnapshot] = useState<Snapshot<N, E>>(() => ({ ...source, source }));
  const current = useMemo(() => reconcileGraphProjection(source, snapshot), [source, snapshot]);
  const onNodesChange = useCallback((changes: NodeChange<N>[]) => setSnapshot((previous) => {
    const next = reconcileGraphProjection(source, previous); return { ...next, nodes: applyNodeChanges(changes, next.nodes) };
  }), [source]);
  const onEdgesChange = useCallback((changes: EdgeChange<E>[]) => setSnapshot((previous) => {
    const next = reconcileGraphProjection(source, previous); return { ...next, edges: applyEdgeChanges(changes, next.edges) };
  }), [source]);
  const reset = useCallback(() => setSnapshot({ ...source, source }), [source]);
  return { ...current, onNodesChange, onEdgesChange, reset };
}
