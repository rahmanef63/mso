import type { CSSProperties } from "react";
import type { ShellId } from "../registry/shells";

export type LayoutMetrics = { pagePadding: number; gap: number; controlHeight: number; controlPadding: number; sidebarWidth: number };
export type LayoutConfig = Partial<Record<ShellId, Partial<LayoutMetrics>>>;
const defaults: Record<ShellId, LayoutMetrics> = {
  macos: { pagePadding: 20, gap: 12, controlHeight: 36, controlPadding: 12, sidebarWidth: 240 },
  windows: { pagePadding: 24, gap: 12, controlHeight: 36, controlPadding: 12, sidebarWidth: 248 },
  ios: { pagePadding: 20, gap: 16, controlHeight: 44, controlPadding: 16, sidebarWidth: 272 },
  android: { pagePadding: 16, gap: 16, controlHeight: 48, controlPadding: 16, sidebarWidth: 280 },
  dashboard: { pagePadding: 16, gap: 8, controlHeight: 36, controlPadding: 12, sidebarWidth: 224 },
};
const names: Record<keyof LayoutMetrics, string> = {
  pagePadding: "--feature-padding", gap: "--feature-gap", controlHeight: "--ui-control-height",
  controlPadding: "--ui-control-padding", sidebarWidth: "--feature-sidebar-width",
};
export function layoutVariables(metrics: Partial<LayoutMetrics>): CSSProperties {
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => Number.isFinite(value) && value > 0 && value <= 512)
    .map(([key, value]) => [names[key as keyof LayoutMetrics], `${value / 16}rem`])) as CSSProperties;
}
export function shellLayout(id: ShellId, config?: LayoutConfig): CSSProperties {
  return layoutVariables({ ...defaults[id], ...config?.[id] });
}
