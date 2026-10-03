"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Activity, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShellAppearance, useCpuPercent } from "../registry/capabilities";
import { toggleSpotlight, toggleInspector, toggleNotificationCenter } from "../lib/store";
import { useNotifications } from "../lib/toast";
import { Slot } from "../registry/feature-registry";

// Right cluster of the menu bar: cpu · spotlight · inspector · theme · clock.
export function StatusCluster() {
  const { theme, setTheme } = useShellAppearance();
  const cpu = useCpuPercent();
  const clock = useClock();
  const unread = useNotifications().some((n) => !n.read);

  return (
    <div className="ml-auto flex items-center text-foreground">
      <span data-slot="system-status-host" data-status-placement="menu-bar" className="flex items-center">
        <Slot region="systemStatus" />
      </span>
      {cpu != null && (
        <span className="flex items-center gap-1 rounded-[4px] px-[9px] py-1 text-[13px] font-semibold tabular-nums">
          <Activity className="size-3.5" />
          {cpu}%
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Spotlight (⌘K)"
        onClick={toggleSpotlight}
        className="h-auto grid size-6 place-items-center rounded-[4px] hover:bg-foreground/10"
      >
        <Search className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="AI Inspector (⌘I)"
        onClick={toggleInspector}
        className="h-auto grid size-6 place-items-center rounded-[4px] hover:bg-foreground/10"
      >
        <Sparkles className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Toggle theme"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="h-auto grid size-6 place-items-center rounded-[4px] hover:bg-foreground/10"
      >
        {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
      </Button>
      {/* Host-contributed trailing items (e.g. macOS Control Center). */}
      <Slot region="menuBarStatus" />
      {/* Clock → Notification Center; dot = unread. */}
      <Button
        type="button"
        variant="ghost"
        aria-label="Notification Center"
        onClick={toggleNotificationCenter}
        className="h-auto relative flex items-center gap-2 rounded-[4px] py-1 pl-[9px] text-[13px] font-semibold tabular-nums text-foreground hover:bg-foreground/10"
      >
        {clock}
        {unread && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary" />}
      </Button>
    </div>
  );
}

function useClock() {
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) +
          "  " +
          new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      );
    tick();
    const t = setInterval(tick, 20000);
    return () => clearInterval(t);
  }, []);
  return now;
}
