import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { QuicklinksProvider, useQuicklinks } from "./store";
function Probe() {
  return <output>{JSON.stringify(useQuicklinks().items)}</output>;
}
it("renders a fresh menu without extra website shortcuts", () => {
  expect(renderToStaticMarkup(<QuicklinksProvider><Probe /></QuicklinksProvider>)).toBe("<output>[]</output>");
});
