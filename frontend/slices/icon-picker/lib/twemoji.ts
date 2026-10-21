/** Twemoji codepoint converter + CDN URL builder.
 *
 *  Twemoji = Twitter's open-source SVG emoji set. Notion uses the same
 *  set as their default emoji renderer. Licensed MIT (code) + CC-BY 4.0
 *  (assets), so safe to hot-link without copyright issue.
 *
 *  We hot-link to jsDelivr's mirror of jdecked/twemoji (the actively
 *  maintained fork after Twitter open-sourced and abandoned the repo).
 *  No npm dep — keeps bundle small. */

const TWEMOJI_VERSION = "15.1.0";
const TWEMOJI_BASE = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@${TWEMOJI_VERSION}/assets/svg`;

const VS16 = /️/g;
const ZWJ = "‍";

/** Twemoji's official codepoint conversion. Strips variation selector
 *  (U+FE0F) for sequences without ZWJ — matches the asset filename. */
function toCodePoint(input: string, sep = "-"): string {
  const cleaned = input.indexOf(ZWJ) < 0 ? input.replace(VS16, "") : input;
  const out: string[] = [];
  let pending = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned.charCodeAt(i);
    if (pending) {
      out.push((0x10000 + ((pending - 0xd800) << 10) + (c - 0xdc00)).toString(16));
      pending = 0;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      pending = c;
    } else {
      out.push(c.toString(16));
    }
  }
  return out.join(sep);
}

/** SVG URL on jsDelivr CDN. Returns null for empty input. */
export function twemojiUrl(emoji: string | null | undefined): string | null {
  if (!emoji) return null;
  const cp = toCodePoint(emoji);
  if (!cp) return null;
  return `${TWEMOJI_BASE}/${cp}.svg`;
}
