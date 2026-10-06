"use client";

import { Button } from "@/components/ui/button";

// A 24px hit area surrounds each 14px macOS control.
export function TrafficLights({
  onClose, onMinimize, onMaximize, focused = true,
}: {
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  focused?: boolean;
}) {
  return (
    <div className="group/lights flex shrink-0" data-focused={focused}>
      <Light color="var(--mac-close)" label="Close window" onClick={onClose}>
        <path d="M1.6 1.6l4.8 4.8M6.4 1.6l-4.8 4.8" />
      </Light>
      <Light color="var(--mac-minimize)" label="Minimize window" onClick={onMinimize}>
        <path d="M1.4 4h5.2" />
      </Light>
      <Light color="var(--mac-maximize)" label="Maximize window" onClick={onMaximize}>
        <path d="M2 6V2h4M6 2L2 6" />
      </Light>
    </div>
  );
}

function Light({ color, label, onClick, children }: {
  color: string;
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
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerDown={(e) => e.stopPropagation()}
      className="macos-light-button grid size-6 rounded-full p-0 hover:bg-transparent"
      style={{ "--mac-light": color } as React.CSSProperties}
    >
      <span className="macos-light grid size-[14px] place-items-center rounded-full" aria-hidden>
        <svg viewBox="0 0 8 8" className="size-2 text-black opacity-0 group-hover/lights:opacity-70 group-focus-within/lights:opacity-70" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          {children}
        </svg>
      </span>
    </Button>
  );
}
