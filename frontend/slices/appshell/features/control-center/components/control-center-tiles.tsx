"use client";

import { type LucideIcon, Bell, Moon, MoonStar, Sun, Server, Cloud, Sparkles, Layers, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWindowOrder } from "../../../hooks/use-shell";
import { closeAll, toggleInspector, toggleSpotlight } from "../../../lib/store";
import { toggleFocusMode, useFocusMode } from "../../../lib/focus-mode";
import { useShellAppearance, useServerToggle } from "../../../registry/capabilities";

// The six REAL toggles shared by the mobile pull-down Sheet CC and the desktop
// menu-bar popover CC — one source of truth. Only real state: appearance, the
// optional server toggle, focus, spotlight, assistant, close-all-windows. NO
// wifi/cellular/battery/brightness (fabricated hardware — VPS essence). `onClose`
// dismisses the container after the actions that navigate away.
export function ControlCenterTiles({ onClose, onAssistant }: { onClose: () => void; onAssistant?: () => void }) {
  const { theme, setTheme } = useShellAppearance();
  const server = useServerToggle();
  const openCount = useWindowOrder().length;
  const focus = useFocusMode();
  const dark = theme === "dark";
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Tile
        icon={dark ? Moon : Sun}
        label="Appearance"
        value={dark ? "Dark" : "Light"}
        on={dark}
        onClick={() => setTheme(dark ? "light" : "dark")}
      />
      {server && (
        <Tile
          icon={server.live ? Cloud : Server}
          label="Server"
          value={server.label}
          on={server.live}
          disabled={server.locked}
          onClick={server.toggle}
        />
      )}
      <Tile
        icon={focus ? MoonStar : Bell}
        label="Focus"
        value={focus ? "On — toasts to log" : "Off"}
        on={focus}
        onClick={toggleFocusMode}
      />
      <Tile icon={Search} label="Search" value="Spotlight" onClick={() => { onClose(); toggleSpotlight(); }} />
      <Tile icon={Sparkles} label="Alfa" value="Ask about this app" onClick={() => { onClose(); (onAssistant ?? toggleInspector)(); }} />
      <Tile
        icon={Layers}
        label="Windows"
        value={openCount ? `Close all (${openCount})` : "None open"}
        disabled={openCount === 0}
        onClick={() => { closeAll(); onClose(); }}
      />
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  on = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-auto flex items-center gap-3 rounded-2xl border border-border px-3.5 py-3 text-left transition-colors disabled:opacity-40",
        on ? "bg-primary text-primary-foreground" : "bg-background/60 hover:bg-background",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full",
          on ? "bg-primary-foreground/20" : "bg-muted",
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold leading-tight">{label}</span>
        <span className={cn("block truncate text-[11px]", on ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {value}
        </span>
      </span>
    </Button>
  );
}
