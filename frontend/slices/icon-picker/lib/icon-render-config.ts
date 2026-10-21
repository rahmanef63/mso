/**
 * SSOT for cross-kind visual sizing.
 *
 * Different icon sources fill their render box at different ratios:
 *   - Native emoji  → glyph hits ~75% of font-size
 *   - Twemoji <img> → SVG asset, padding inside the canvas, ~85% fill
 *   - Lucide outline → stroke marks fill ~92% of viewBox (24×24)
 *   - Phosphor fill → solid marks fill ~85% of viewBox (256×256)
 *
 * Without compensation, `size={72}` on all four produces visually
 * UNEQUAL icons — lucide looks biggest, emoji smallest. To make the
 * visible mark equal across kinds, we treat the `size` prop as the
 * TARGET MARK size and back-compute the render-box size each
 * primitive needs.
 *
 * Tuned for Notion visual cadence. Consumers can override by
 * re-exporting `ICON_FILL_RATIO` from a wrapper.
 */
export type IconRenderKind = "emoji" | "twemoji" | "lucide" | "phosphor";

export const ICON_FILL_RATIO: Record<IconRenderKind, number> = {
  emoji: 0.75,
  twemoji: 0.85,
  lucide: 0.92,
  phosphor: 0.85,
};

/**
 * Returns the size we should hand to the underlying primitive
 * (font-size for emoji, `<Cmp size>` for lucide/phosphor, `width`
 * attr for twemoji `<img>`) so the visible mark hits `targetMark`
 * pixels regardless of kind.
 */
export function renderSizeFor(kind: IconRenderKind, targetMark: number): number {
  return Math.round(targetMark / ICON_FILL_RATIO[kind]);
}
