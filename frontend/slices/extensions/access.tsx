"use client";
import type { ReactNode } from "react";
import { useSession } from "@/features/auth";
import { IS_DEMO } from "@/lib/demo";
export function ExtensionAccess({ children }: { children: ReactNode }) {
  const { status, role } = useSession();
  if (status === "loading") return <p role="status">Checking owner access…</p>;
  if (IS_DEMO || status !== "in" || role !== "owner") return <p className="p-4 text-sm text-muted-foreground">{IS_DEMO ? "Host installations are disabled in this demo." : "Sign in with an Owner device to manage MCPs and skills on this VPS."}</p>;
  return children;
}
