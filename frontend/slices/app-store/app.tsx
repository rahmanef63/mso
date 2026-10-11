"use client";
import { useId, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CategoryTabs, McpStorePanel, SkillStorePanel } from "@/features/extensions";
import { useAppCatalog, type AppProps } from "@/features/appshell";
import ConnectedAppsPanel from "./components/connected-apps-panel";
import { useShellApps } from "./lib/shell-apps";
import AppsPanel from "./components/apps-panel";
export default function AppStore({ payload }: AppProps) {
  const { active } = useShellApps();
  const catalog = useAppCatalog();
  const requested = (payload as { appId?: unknown } | null)?.appId;
  const query = catalog.find(app => app.id === requested)?.title ?? "";
  const [selection, setSelection] = useState({ tab: "apps", requested }), id = useId();
  const tab = selection.requested === requested ? selection.tab : "apps";
  const setTab = (tab: string) => setSelection({ tab, requested });
  return <div className="flex h-full min-h-0 min-w-0 flex-col">
    <div className="shrink-0 border-b px-3 py-2"><CategoryTabs id={id} label="Store categories" items={[{ id: "apps", label: "Apps" }, ...(active ? [{ id: "connected", label: "Connections" }] : []), { id: "mcp", label: "MCP" }, { id: "skills", label: "Skills" }]} value={tab} onChange={setTab} /></div>
    <section id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="min-h-0 flex-1">
      {tab === "apps" ? <AppsPanel key={query} initialQuery={query} /> : tab === "connected" && active ? <ConnectedAppsPanel /> : <ScrollArea className="h-full"><div className="@container p-4">{tab === "mcp" ? <McpStorePanel /> : <SkillStorePanel />}</div></ScrollArea>}
    </section>
  </div>;
}
