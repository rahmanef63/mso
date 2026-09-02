"use client";

import { useMemo, type ReactNode } from "react";
import { HostApiProvider } from "@/features/appshell";
import { useSession } from "@/features/auth";
import { useAppearance } from "@/lib/appearance";
import { IS_DEMO } from "@/lib/demo";
import { HttpAdapter } from "@/lib/os-api/http-adapter";
import { MockAdapter } from "@/lib/os-api/mock-adapter";

/** MSO composition: choose mock/live adapter, then inject the generic host port. */
export function OsApiProvider({ children }: { children: ReactNode }) {
  const { tweaks } = useAppearance();
  const { status, role } = useSession();
  const mode = IS_DEMO || status !== "in" ? "mock" : tweaks.server.mode;
  const api = useMemo(
    () => (mode === "live" ? HttpAdapter({ url: "", role: role ?? "viewer" }) : MockAdapter()),
    [mode, role],
  );
  return <HostApiProvider api={api}>{children}</HostApiProvider>;
}
