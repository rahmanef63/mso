"use client";
import { useId, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CategoryTabs, McpStorePanel, SkillStorePanel } from "@/features/extensions";
import AppsPanel from "./components/apps-panel";
export default function AppStore() {
  const [tab, setTab] = useState("apps"), id = useId();
  return <div className="flex h-full min-h-0 min-w-0 flex-col">
    <div className="shrink-0 border-b px-3 py-2"><CategoryTabs id={id} label="Store categories" items={[{ id: "apps", label: "Apps" }, { id: "mcp", label: "MCP" }, { id: "skills", label: "Skills" }]} value={tab} onChange={setTab} /></div>
    <section id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="min-h-0 flex-1">
      {tab === "apps" ? <AppsPanel /> : <ScrollArea className="h-full"><div className="@container p-4">{tab === "mcp" ? <McpStorePanel /> : <SkillStorePanel />}</div></ScrollArea>}
    </section>
  </div>;
}
