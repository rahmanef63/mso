"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { parseIconValue, type IconValue } from "../lib/parse";
import { twemojiUrl } from "../lib/twemoji";
import { useIconStyle, type Style } from "../lib/style-pref";
import { LUCIDE_ICONS, FallbackLucideIcon } from "../lib/lucide-icons";
import { PHOSPHOR_ICONS, FallbackPhosphorIcon } from "../lib/phosphor-icons";
import { renderSizeFor, type IconRenderKind } from "../lib/icon-render-config";

interface CommonProps {
  value: string | null | undefined;
  /** Extra Tailwind classes for the wrapping span. Layout only — use
   *  the `size` prop for icon sizing, not className `text-*`. */
  className?: string;
  /** Fallback emoji or `lucide:Name` shown when value is empty. */
  fallback?: string;
  /** Title for tooltip (a11y). */
  title?: string;
  /**
   * Target VISIBLE mark size in pixels. The wrapper box stays exactly
   * this size; the inner primitive is up-scaled per kind via
   * `ICON_FILL_RATIO` so the visible mark hits the same target across
   * emoji, twemoji, lucide, and phosphor. See `lib/icon-render-config`.
   *
   * Legacy callers can omit this prop — the inner primitive falls
   * back to `h-[1em]` cascade from the parent font-size.
   */
  size?: number;
}

/** Recommended hero-icon size (page covers, profile, …). */
export const DEFAULT_ICON_SIZE = 72;

const WRAPPER_BASE = "inline-flex items-center justify-center leading-none";

function wrapperStyle(size: number | undefined, color: string | undefined): React.CSSProperties | undefined {
  if (size === undefined) return color ? { color } : undefined;
  return { width: size, height: size, ...(color ? { color } : null) };
}

function resolveValue(value: string | null | undefined, fallback: string): IconValue {
  const primary = parseIconValue(value);
  if (primary.kind === "emoji" && !primary.emoji) return parseIconValue(fallback);
  return primary;
}

interface RawIconProps extends CommonProps {
  /** Explicit render style. When provided, RawIcon does NOT subscribe to
   *  the global style store — caller is responsible for the value. */
  style: Style;
}

function RawIconImpl({ value, style, className, fallback = "📄", title, size }: RawIconProps) {
  const parsed = React.useMemo(() => resolveValue(value, fallback), [value, fallback]);

  if (parsed.kind === "lucide") {
    const Cmp = LUCIDE_ICONS[parsed.name] ?? FallbackLucideIcon;
    if (Cmp === FallbackLucideIcon && process.env.NODE_ENV !== "production") {
      console.warn(`[DynamicIcon] Unknown lucide icon: "${parsed.name}". Falling back to FileText.`);
    }
    return renderWithKind("lucide", size, parsed.color, className, title, (renderSize) =>
      renderSize !== undefined
        ? <Cmp size={renderSize} style={{ width: renderSize, height: renderSize }} />
        : <Cmp style={{ width: "1em", height: "1em" }} />,
    );
  }

  if (parsed.kind === "phosphor") {
    const Cmp = PHOSPHOR_ICONS[parsed.name] ?? FallbackPhosphorIcon;
    if (Cmp === FallbackPhosphorIcon && process.env.NODE_ENV !== "production") {
      console.warn(`[DynamicIcon] Unknown phosphor icon: "${parsed.name}". Falling back to FileText.`);
    }
    return renderWithKind("phosphor", size, parsed.color, className, title, (renderSize) =>
      renderSize !== undefined
        ? <Cmp weight="fill" size={renderSize} style={{ width: renderSize, height: renderSize }} />
        : <Cmp weight="fill" style={{ width: "1em", height: "1em" }} />,
    );
  }

  const glyph = parsed.kind === "emoji" ? parsed.emoji : "";
  if (style === "twemoji" && glyph) {
    const url = twemojiUrl(glyph);
    if (url) return <TwemojiImg url={url} glyph={glyph} className={className} title={title} size={size} />;
  }
  // Native emoji branch — render-size drives font-size; wrapper box stays `size`.
  return renderWithKind("emoji", size, undefined, className, title, (renderSize) => (
    <span style={renderSize !== undefined ? { fontSize: renderSize, lineHeight: 1 } : undefined}>
      {glyph}
    </span>
  ));
}

/** Single render path for lucide / phosphor / emoji native. Wrapper
 *  box = caller's `size`; inner primitive is up-scaled per kind via
 *  `renderSizeFor`. `overflow-visible` lets up-scaled SVGs spill
 *  outside the box cleanly. */
function renderWithKind(
  kind: IconRenderKind,
  size: number | undefined,
  color: string | undefined,
  className: string | undefined,
  title: string | undefined,
  inner: (renderSize: number | undefined) => React.ReactNode,
) {
  const renderSize = size !== undefined ? renderSizeFor(kind, size) : undefined;
  return (
    <span className={cn(WRAPPER_BASE, className)} title={title} style={{ overflow: "visible", ...wrapperStyle(size, color) }}>
      {inner(renderSize)}
    </span>
  );
}

export const RawIcon = React.memo(RawIconImpl);

interface DynamicIconProps extends CommonProps {
  /** Force native emoji rendering even when twemoji preference is on. */
  forceNative?: boolean;
}

function DynamicIconImpl({ value, className, fallback, title, forceNative, size }: DynamicIconProps) {
  const [style] = useIconStyle();
  const effective: Style = forceNative ? "native" : style;
  return <RawIcon value={value} style={effective} className={className} fallback={fallback} title={title} size={size} />;
}

export const DynamicIcon = React.memo(DynamicIconImpl);

function TwemojiImgImpl({
  url, glyph, className, title, size,
}: { url: string; glyph: string; className?: string; title?: string; size?: number }) {
  const [failed, setFailed] = React.useState(false);
  const renderSize = size !== undefined ? renderSizeFor("twemoji", size) : undefined;
  if (failed) {
    return renderWithKind("emoji", size, undefined, className, title ?? glyph, (rs) => (
      <span style={rs !== undefined ? { fontSize: rs, lineHeight: 1 } : undefined}>{glyph}</span>
    ));
  }
  return (
    <span className={cn(WRAPPER_BASE, className)} style={wrapperStyle(size, undefined)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- external SVG CDN; next/image can't optimize without custom loader */}
      <img
        src={url}
        alt={glyph}
        title={title ?? glyph}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        width={renderSize}
        height={renderSize}
        className="select-none object-contain"
        style={renderSize !== undefined ? { width: renderSize, height: renderSize } : undefined}
      />
    </span>
  );
}

const TwemojiImg = React.memo(TwemojiImgImpl);
