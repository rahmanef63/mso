"use client";

import * as React from "react";

import { DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useResponsiveDialogContext } from "./responsive-dialog-context";
import { cn } from "@/lib/utils";
import { useShellDesign } from "../design/use-shell-design";

export interface ResponsiveDialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function ResponsiveDialogHeader({ className, children, ...props }: ResponsiveDialogHeaderProps) {
  const { variant, isMobile } = useResponsiveDialogContext("Header");
  const design = useShellDesign();
  const baseClasses = "shrink-0 border-b text-left";

  if (isMobile) {
    return (
      <DrawerHeader data-shell-family={design.family} className={cn(
        baseClasses,
        design.family === "apple" ? "gap-1 px-5 pb-3 pt-4 md:text-left" : "gap-1.5 px-5 pb-3 pt-4 md:text-left",
        className,
      )} {...props}>
        {children}
      </DrawerHeader>
    );
  }
  if (variant === "alert") {
    return (
      <AlertDialogHeader className={cn(baseClasses, "gap-1.5 px-6 pb-4 pt-6", className)} {...props}>
        {children}
      </AlertDialogHeader>
    );
  }
  if (variant === "panel") {
    return (
      <SheetHeader className={cn(baseClasses, "gap-1.5 px-6 pb-4 pt-6", className)} {...props}>
        {children}
      </SheetHeader>
    );
  }
  return (
    <DialogHeader className={cn(baseClasses, "gap-1.5 px-6 pb-4 pt-6", className)} {...props}>
      {children}
    </DialogHeader>
  );
}

export interface ResponsiveDialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children: React.ReactNode;
}

export function ResponsiveDialogTitle({ className, children, ...props }: ResponsiveDialogTitleProps) {
  const { variant, isMobile } = useResponsiveDialogContext("Title");
  const design = useShellDesign();
  if (isMobile) return <DrawerTitle className={cn(design.family === "apple" ? "text-[17px] font-semibold" : "text-[20px] font-medium", className)} {...props}>{children}</DrawerTitle>;
  if (variant === "alert") return <AlertDialogTitle className={className} {...props}>{children}</AlertDialogTitle>;
  if (variant === "panel") return <SheetTitle className={className} {...props}>{children}</SheetTitle>;
  return <DialogTitle className={className} {...props}>{children}</DialogTitle>;
}

export interface ResponsiveDialogDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  children: React.ReactNode;
}

export function ResponsiveDialogDescription({ className, children, ...props }: ResponsiveDialogDescriptionProps) {
  const { variant, isMobile } = useResponsiveDialogContext("Description");
  if (isMobile) return <DrawerDescription className={className} {...props}>{children}</DrawerDescription>;
  if (variant === "alert") return <AlertDialogDescription className={className} {...props}>{children}</AlertDialogDescription>;
  if (variant === "panel") return <SheetDescription className={className} {...props}>{children}</SheetDescription>;
  return <DialogDescription className={className} {...props}>{children}</DialogDescription>;
}

export interface ResponsiveDialogBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function ResponsiveDialogBody({ className, children, ...props }: ResponsiveDialogBodyProps) {
  useResponsiveDialogContext("Body");
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 sm:px-6", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export interface ResponsiveDialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function ResponsiveDialogFooter({ className, children, ...props }: ResponsiveDialogFooterProps) {
  const { variant, isMobile } = useResponsiveDialogContext("Footer");
  const design = useShellDesign();
  const baseClasses = "shrink-0 border-t";

  if (isMobile) {
    return (
      <DrawerFooter data-shell-family={design.family} className={cn(
        baseClasses,
        design.family === "apple" ? "flex-col gap-2 px-5 pb-[max(1.25rem,var(--sai-bottom,0px))] pt-3" : "flex-col gap-2 px-5 pb-[max(1rem,var(--sai-bottom,0px))] pt-3",
        className,
      )} {...props}>
        {children}
      </DrawerFooter>
    );
  }
  if (variant === "alert") {
    return (
      <AlertDialogFooter className={cn(baseClasses, "gap-2 px-6 pb-5 pt-4 sm:justify-end", className)} {...props}>
        {children}
      </AlertDialogFooter>
    );
  }
  if (variant === "panel") {
    return (
      <SheetFooter className={cn(baseClasses, "mt-0 flex-row justify-end gap-2 px-6 pb-5 pt-4", className)} {...props}>
        {children}
      </SheetFooter>
    );
  }
  return (
    <DialogFooter className={cn(baseClasses, "gap-2 px-6 pb-5 pt-4 sm:justify-end", className)} {...props}>
      {children}
    </DialogFooter>
  );
}
