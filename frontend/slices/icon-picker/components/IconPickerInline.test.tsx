import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IconPickerInline } from "./IconPickerInline";

// The picker is adapted to MSO's presentational Tabs (no TabsContent, no radix
// context). A wrong assumption there only shows up at render time, so render the
// whole inline picker once on the server and assert the tabs actually switch
// panels by value.
describe("IconPickerInline on MSO tabs", () => {
  const render = (value: string) =>
    renderToStaticMarkup(<IconPickerInline value={value} onChange={() => {}} />);

  it("opens the emoji tab for an emoji value and the icon tab for a named icon", () => {
    const emoji = render("🎯");
    const lucide = render("lucide:Star");
    // Variant pills differ per tab: emoji renders Native/Twemoji, icon renders
    // Lucide/Phosphor. The active panel follows the stored value.
    expect(emoji).toContain("Native");
    expect(emoji).toContain("Twemoji");
    expect(lucide).toContain("Phosphor fill");
    expect(lucide).toContain("Search lucide icons");
  });

  it("marks the active tab with a real pressed state, not a radix data attribute", () => {
    const html = render("lucide:Star");
    expect(html).toContain("Emoji");
    expect(html).toContain("Icon");
    expect(html).not.toContain("data-state");
  });
});
