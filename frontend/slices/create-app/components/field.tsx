"use client";
import { useId, type ReactNode } from "react";
export function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  const labelId = useId();
  return <div className="space-y-1.5" role="group" aria-labelledby={labelId}>
    <label id={labelId} htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</label>
    {children}
  </div>;
}
