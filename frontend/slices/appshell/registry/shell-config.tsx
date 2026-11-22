"use client";

import type { LayoutConfig } from "../design/layout";
import { createContext, useContext, type ReactNode } from "react";

// Non-brand runtime config the shell core needs (kept out of Brand so brand
// stays purely presentational): the persistence namespace, so a generic appshell
// never hardcodes a consumer's localStorage key.
export type ShellConfig = {
  persistKey: string;
  layout?: LayoutConfig;
};

const ShellConfigContext = createContext<ShellConfig>({ persistKey: "appshell:layout" });

export function ShellConfigProvider({
  value,
  children,
}: {
  value: ShellConfig;
  children: ReactNode;
}) {
  return <ShellConfigContext.Provider value={value}>{children}</ShellConfigContext.Provider>;
}

export function useShellConfig(): ShellConfig {
  return useContext(ShellConfigContext);
}
