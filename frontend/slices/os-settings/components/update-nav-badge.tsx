"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/features/auth";
import { IS_DEMO } from "@/lib/demo";
import { hasAvailableUpdate, readStatus } from "./update-status-client";

export function UpdateNavBadge() {
  const { status, role } = useSession();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (IS_DEMO || status !== "in" || role !== "owner") return;
    let alive = true;
    readStatus(true)
      .then((next) => {
        if (alive) setAvailable(hasAvailableUpdate(next));
      })
      .catch(() => {
        if (alive) setAvailable(false);
      });
    return () => {
      alive = false;
    };
  }, [status, role]);

  if (IS_DEMO || status !== "in" || role !== "owner" || !available) return null;
  return (
    <Badge
      data-slot="settings-update-badge"
      variant="secondary"
      className="ml-auto h-5 shrink-0 px-1.5 text-[9px] uppercase tracking-wide"
      aria-label="New MSO version available"
    >
      New
    </Badge>
  );
}
