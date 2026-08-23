"use client";

import { Suspense } from "react";
import { Terminal } from "@/features/os-terminal";

export function IntegratedTerminal({ cwd }: { cwd: string }) {
  return (
    <div className="h-[42%] min-h-[150px] shrink-0 border-t border-[#2a2a30] @[700px]:h-[34%] @[700px]:min-h-[170px]">
      <Suspense
        fallback={
          <div className="grid h-full place-items-center bg-[#0d0e12] font-mono text-xs text-[#9298a4]">
            Loading terminal…
          </div>
        }
      >
        <Terminal initialCwd={cwd} />
      </Suspense>
    </div>
  );
}
