import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppRegistryProvider, useApps, useAppCatalog, useApp } from "./registry";
import { ActiveShellProvider } from "../registry/shells";
import { WindowContent } from "../components/window-content";
import type { AppDescriptor } from "./types";

const load = () => { throw new Error("An uninstalled app must not load"); };
const apps: AppDescriptor[] = [
  { id: "core", title: "Files", shellTitles: { macos: "Finder" }, icon: () => null, gradient: "gray", load },
  { id: "optional", title: "Optional", icon: () => null, gradient: "gray", installed: false, install: () => undefined, load },
];
function Probe() {
  return <p>{JSON.stringify({ menu: useApps().map(app => app.title), catalog: useAppCatalog().map(app => app.id), optional: useApp("optional")?.id })}</p>;
}
describe("shared catalog and installed menus", () => {
  it.each(["macos", "windows", "dashboard", "ios", "android"] as const)("filters installed menus while keeping %s catalog addressable", shell => {
    const html = renderToStaticMarkup(<AppRegistryProvider apps={apps}><ActiveShellProvider id={shell} surface={shell === "ios" || shell === "android" ? "mobile" : "desktop"}><Probe /></ActiveShellProvider></AppRegistryProvider>);
    expect(html).toContain(shell === "macos" ? "Finder" : "Files");
    expect(html).toContain('optional'); expect(html).not.toContain('Optional');
  });
  it("offers the store without mounting an uninstalled app", () => {
    const html = renderToStaticMarkup(<AppRegistryProvider apps={apps}><WindowContent app="optional" /></AppRegistryProvider>);
    expect(html).toContain("Optional is not installed."); expect(html).toContain("Open App Store"); expect(html).not.toContain("animate-spin");
  });
});
