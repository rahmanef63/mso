"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

// macOS 27 menu panels are portaled, so the tone has to travel with the content
// rather than a [data-shell] ancestor.
const DropdownToneContext = React.createContext(false);

function DropdownMenuContent({
  className,
  sideOffset = 6,
  tone,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & { tone?: "macos" }) {
  const macos = tone === "macos";
  return (
    <DropdownToneContext.Provider value={macos}>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          sideOffset={sideOffset}
          data-macos-menu={macos ? "" : undefined}
          className={cn(
            macos
              ? "glass z-[950] min-w-[244px] overflow-hidden rounded-[12px] border border-black/10 bg-white/75 px-3 py-[5px] text-[13px] text-foreground shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_8px_48px_rgba(0,0,0,0.25)] dark:border-white/10 dark:bg-[rgba(44,44,48,0.88)] dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.14),0_8px_48px_rgba(0,0,0,0.55)]"
              : "glass z-[950] min-w-[200px] overflow-hidden rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-pop)]",
            className,
          )}
          {...props}
        />
      </DropdownMenuPrimitive.Portal>
    </DropdownToneContext.Provider>
  );
}

function DropdownMenuItem({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }) {
  const macos = React.useContext(DropdownToneContext);
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        macos
          ? "flex h-6 cursor-default items-center justify-between gap-2 rounded-[5px] px-0 text-[13px] font-medium outline-none focus:bg-primary focus:text-primary-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
          : "flex cursor-default items-center justify-between gap-6 rounded-md px-2.5 py-1.5 text-[13px] outline-none transition-colors focus:bg-primary focus:text-primary-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        inset && "pl-8",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  const macos = React.useContext(DropdownToneContext);
  return (
    <span className={cn(macos ? "text-[13px] font-medium text-[#8e8e93] dark:text-white/45" : "text-xs opacity-50", className)} {...props} />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  const macos = React.useContext(DropdownToneContext);
  return (
    <DropdownMenuPrimitive.Separator
      className={cn(macos ? "my-[5px] h-px bg-black/10 dark:bg-white/12" : "mx-1.5 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuSeparator,
};
