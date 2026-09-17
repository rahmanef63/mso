"use client";
import { useInspectorOpen } from "../../hooks/use-shell";
import { useIsMobile } from "../../responsive/use-is-mobile";
import { DeferredSurface } from "../../primitives/deferred-surface";
const loadInspector = () => import("./components/inspector").then((module) => ({ default: module.Inspector }));
const loadAlfa = () => import("./components/alfa-sheet").then((module) => ({ default: module.AlfaSheet }));
export function DeferredInspector() {
  const open = useInspectorOpen();
  return <DeferredSurface active={open} load={loadInspector} label="Inspector" keepMounted />;
}
export function DeferredAlfaSheet() {
  const open = useInspectorOpen();
  const mobile = useIsMobile();
  return <DeferredSurface active={open && mobile} load={loadAlfa} label="Alfa" keepMounted />;
}
