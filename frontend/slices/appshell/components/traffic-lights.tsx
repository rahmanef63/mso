"use client";

import { Button } from "@/components/ui/button";

// macOS window controls. Glyphs fade in on hover of the cluster (os-rr).
export function TrafficLights({
  focused = true,
  onClose,
  onMinimize,
  onMaximize,
}: {
  focused?: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
}) {
  return (
    <div className="group/lights flex items-center gap-[9px] pr-2">
      <Light focused={focused} color="#ff5c60" stroke="#7a0a00" label="Close window" onClick={onClose}>
        <path d="M1.6 1.6l4.8 4.8M6.4 1.6l-4.8 4.8" strokeWidth="1.2" strokeLinecap="round" />
      </Light>
      <Light focused={focused} color="#fac800" stroke="#7a4b00" label="Minimize window" onClick={onMinimize}>
        <path d="M1.4 4h5.2" strokeWidth="1.4" strokeLinecap="round" />
      </Light>
      <Light focused={focused} color="#35c759" stroke="#0a5200" label="Maximize window" onClick={onMaximize}>
        <path d="M2 6V2h4M6 2L2 6" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Light>
    </div>
  );
}

function Light({
  focused,
  color,
  stroke,
  label,
  onClick,
  children,
}: {
  focused: boolean;
  color: string;
  stroke: string;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="!size-[14px] !min-h-[14px] !min-w-[14px] !p-0 rounded-full border-[0.5px] border-black/45 hover:!bg-transparent [&_svg]:!size-2 data-[dim=true]:border-black/10 data-[dim=true]:!bg-black/15 dark:data-[dim=true]:border-white/10 dark:data-[dim=true]:!bg-white/20"
      data-dim={focused ? undefined : true}
      style={focused ? { background: color } : undefined}
    >
      <svg
        viewBox="0 0 8 8"
        className="size-2 opacity-0 group-hover/lights:opacity-60"
        stroke={stroke}
      >
        {children}
      </svg>
    </Button>
  );
}
