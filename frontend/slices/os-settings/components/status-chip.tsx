"use client";

import { cn } from "@/lib/utils";

export type TestState =
  | null
  | { state: "testing" }
  | { state: "ok"; msg: string }
  | { state: "err"; msg: string };

// Small status pill mirroring the prototype: dot + label, colored by outcome.
export function StatusChip({ test }: { test: TestState }) {
  if (!test) return null;
  const ok = test.state === "ok";
  const err = test.state === "err";
  const label =
    test.state === "testing"
      ? "Testing…"
      : ok
        ? `Connected: ${test.msg}`
        : `Failed: ${test.msg}`;
  return (
    <span className="flex min-w-0 items-center gap-2 text-[12px] font-semibold">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          ok ? "bg-success" : err ? "bg-destructive" : "bg-muted-foreground",
        )}
      />
      <span
        className={cn(
          "truncate",
          ok ? "text-success" : err ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </span>
  );
}
