"use client";

import { Compass, Heart, Leaf, Shield, Sparkles, Star, UserRound, Zap, type LucideIcon } from "lucide-react";
import type { AccountIcon, AccountPreset } from "@/lib/auth/account-profile-model";
import { cn } from "@/lib/utils";

const PRESET_ICON: Record<AccountPreset, LucideIcon> = {
  user: UserRound,
  spark: Sparkles,
  shield: Shield,
  star: Star,
  heart: Heart,
  zap: Zap,
  leaf: Leaf,
  compass: Compass,
};

export function AccountAvatar({ icon, className }: { icon: AccountIcon; className?: string }) {
  if (icon.type === "image") {
    // Owner-uploaded data URLs are authenticated bytes, not optimizer inputs.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={icon.src} alt="" className={cn("size-16 rounded-full object-cover", className)} />
    );
  }
  const Icon = PRESET_ICON[icon.id];
  return (
    <span className={cn("grid size-16 place-items-center rounded-full bg-primary text-primary-foreground", className)}>
      <Icon className="size-8" aria-hidden />
    </span>
  );
}

export function AccountPresetButton({
  id,
  pressed,
  disabled,
  onSelect,
}: {
  id: AccountPreset;
  pressed: boolean;
  disabled: boolean;
  onSelect: (id: AccountPreset) => void;
}) {
  const Icon = PRESET_ICON[id];
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={`Use ${id} icon`}
      disabled={disabled}
      onClick={() => onSelect(id)}
      className={cn(
        "grid min-h-11 place-items-center rounded-lg border",
        pressed ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary text-foreground",
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
