"use client";

import { useActiveShell } from "../registry/shells";
import { designProfileFor } from "./profiles";

export function useShellDesign() {
  const { id } = useActiveShell();
  return designProfileFor(id);
}
