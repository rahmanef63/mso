"use client";

import type { AppProps } from "@/features/appshell";
import { AppFrame } from "@/features/appshell";
import { MemoryGraphScreen } from "./components/memory-graph-screen";

export default function MemoryGraphApp(_props: AppProps) {
  return (
    <AppFrame safeArea={false} className="h-full bg-background" bodyClassName="overflow-hidden">
      <MemoryGraphScreen />
    </AppFrame>
  );
}
