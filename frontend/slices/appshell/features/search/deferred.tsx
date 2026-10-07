"use client";
import { useSpotlightOpen } from "../../hooks/use-shell";
import { DeferredSurface } from "../../primitives/deferred-surface";
const load = () => import("./components/spotlight").then((module) => ({ default: module.Spotlight }));
export function DeferredSpotlight() {
  const open = useSpotlightOpen();
  return <DeferredSurface active={open} load={load} label="Search" />;
}
