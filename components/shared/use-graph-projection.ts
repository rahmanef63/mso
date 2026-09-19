"use client";
import { useCallback, useState } from "react";
import { applyEdgeChanges, applyNodeChanges, type Edge, type EdgeChange, type Node, type NodeChange } from "@xyflow/react";
export type GraphProjection<N extends Node, E extends Edge> = { nodes: N[]; edges: E[] };
type Snapshot<N extends Node, E extends Edge> = GraphProjection<N, E> & { source: GraphProjection<N, E> };
const selectedKey = (items: { id: string; selected?: boolean }[]) => JSON.stringify(items.filter((item) => item.selected).map((item) => item.id).sort());

/** Controlled changes win; data-only updates retain transient box/ctrl selections. */
export function reconcileGraphProjection<N extends Node, E extends Edge>(source: GraphProjection<N, E>, previous: Snapshot<N, E>): Snapshot<N, E> {
  if (source === previous.source) return previous;
  const oldNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const nodeSelectionChanged = selectedKey(source.nodes) !== selectedKey(previous.source.nodes);
  const edgeSelectionChanged = selectedKey(source.edges) !== selectedKey(previous.source.edges);
  const oldEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
  return { source,
    nodes: source.nodes.map((node) => ({ ...node, measured: oldNodes.get(node.id)?.measured ?? node.measured, selected: nodeSelectionChanged ? Boolean(node.selected) : oldNodes.get(node.id)?.selected ?? node.selected })),
    edges: source.edges.map((edge) => ({ ...edge, selected: edgeSelectionChanged ? Boolean(edge.selected) : oldEdges.get(edge.id)?.selected ?? edge.selected })),
  };
}
export function useGraphProjection<N extends Node, E extends Edge>(source: GraphProjection<N, E>) {
  const [snapshot, setSnapshot] = useState<Snapshot<N, E>>(() => ({ ...source, source }));
  const current = reconcileGraphProjection(source, snapshot);
  // Record each controlled transition, including select→clear without a node event.
  // The caller memoizes source; this guarded self-update settles before children render.
  if (current !== snapshot) setSnapshot(current);
  const onNodesChange = useCallback((changes: NodeChange<N>[]) => setSnapshot((previous) => {
    const next = reconcileGraphProjection(source, previous); return { ...next, nodes: applyNodeChanges(changes, next.nodes) };
  }), [source]);
  const onEdgesChange = useCallback((changes: EdgeChange<E>[]) => setSnapshot((previous) => {
    const next = reconcileGraphProjection(source, previous); return { ...next, edges: applyEdgeChanges(changes, next.edges) };
  }), [source]);
  const reset = useCallback(() => setSnapshot({ ...source, source }), [source]);
  const clearSelection = useCallback(() => setSnapshot((previous) => {
    const next = reconcileGraphProjection(source, previous);
    return { ...next, nodes: next.nodes.map((node) => ({ ...node, selected: false })), edges: next.edges.map((edge) => ({ ...edge, selected: false })) };
  }), [source]);
  return { ...current, onNodesChange, onEdgesChange, reset, clearSelection };
}
