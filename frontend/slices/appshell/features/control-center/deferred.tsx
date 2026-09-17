"use client";
import { useShellUI } from "../../registry/shell-ui";
import { DeferredSurface } from "../../primitives/deferred-surface";
const load = () => import("./components/control-center").then((module) => ({ default: module.ControlCenter }));
export function DeferredControlCenter() {
  const { controlCenterOpen } = useShellUI();
  return <DeferredSurface active={controlCenterOpen} load={load} label="Control Center" keepMounted />;
}
