"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { useActiveShell } from "../registry/shells";
import { useShellConfig } from "../registry/shell-config";
import { shellLayout } from "./layout";

/** Portalled UI and iframe bridges inherit the same active shell metrics. */
export function LayoutBoundary({ children }: { children: ReactNode }) {
  const { id } = useActiveShell();
  const { layout } = useShellConfig();
  const variables = useMemo(() => shellLayout(id, layout), [id, layout]);
  useEffect(() => {
    const style = document.documentElement.style;
    const previous = Object.keys(variables).map((key) => [key, style.getPropertyValue(key)]);
    Object.entries(variables).forEach(([key, value]) => style.setProperty(key, String(value)));
    return () => previous.forEach(([key, value]) => { if (value) style.setProperty(key, value); else style.removeProperty(key); });
  }, [variables]);
  return <div className="contents" style={variables}>{children}</div>;
}
