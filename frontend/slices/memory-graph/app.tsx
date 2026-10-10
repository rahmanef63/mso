"use client";

import type { AppProps } from "@/features/appshell";
import { AppFrame } from "@/features/appshell";
import { MemoryGraphScreen } from "./components/memory-graph-screen";

export default function MemoryGraphApp({ payload }: AppProps) {
  const context = payload && typeof payload === "object" ? payload as { root?: unknown; project?: unknown } : {};
  const root = typeof context.root === "string" ? context.root : undefined;
  const project = typeof context.project === "string" ? context.project : undefined;
  return (
    <AppFrame safeArea={false} className="h-full bg-background" bodyClassName="overflow-hidden">
      <MemoryGraphScreen key={`${root ?? ""}\n${project ?? ""}`} initialRoot={root} initialProject={project} />
    </AppFrame>
  );
}
