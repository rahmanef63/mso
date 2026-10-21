import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DynamicIcon } from "./DynamicIcon";

// AccountAvatar renders a stored `library` icon on the server (settings page),
// so DynamicIcon must produce markup without a browser. Each branch is checked
// because a silent fallback would show the wrong glyph with no error.
describe("DynamicIcon (used by the account avatar)", () => {
  it("renders a lucide icon", () => {
    const html = renderToStaticMarkup(<DynamicIcon value="lucide:Star" size={32} />);
    expect(html).toContain("svg");
    expect(html).toContain('width="35"'); // 32 / 0.92 fill ratio
  });

  it("renders a phosphor fill icon", () => {
    const html = renderToStaticMarkup(<DynamicIcon value="phosphor:ShieldCheck" size={32} />);
    expect(html).toContain("svg");
  });

  it("renders an emoji glyph as text in native mode", () => {
    const html = renderToStaticMarkup(<DynamicIcon value="🎯?c=0b6e99" size={32} forceNative />);
    expect(html).toContain("🎯");
    // The tint suffix is parsed but not painted on a native glyph — it only
    // affects twemoji framing. Asserting that keeps the behaviour honest.
    expect(html).not.toContain("#0b6e99");
  });

  it("twemoji mode (the default) hot-links the glyph asset, which is why the avatar forces native", () => {
    const html = renderToStaticMarkup(<DynamicIcon value="🎯" size={32} />);
    expect(html).toContain("cdn.jsdelivr.net");
  });

  it("falls back instead of throwing on an unknown name or empty value", () => {
    expect(() => renderToStaticMarkup(<DynamicIcon value="lucide:NotARealIcon" />)).not.toThrow();
    expect(() => renderToStaticMarkup(<DynamicIcon value="" fallback="lucide:FileText" />)).not.toThrow();
  });
});
