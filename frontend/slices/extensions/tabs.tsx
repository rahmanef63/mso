"use client";
import { useId, useState } from "react";
import { CategoryTabs } from "./category-tabs";
import { McpStorePanel } from "./mcp-panel";
import { SkillStorePanel } from "./skill-panel";
export function ExtensionTabs() {
  const [tab, setTab] = useState("mcp"), id = useId();
  return <div className="min-w-0 space-y-4">
    <CategoryTabs id={id} label="Installed extensions" items={[{ id: "mcp", label: "MCP" }, { id: "skills", label: "Skills" }]} value={tab} onChange={setTab} />
    <section id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>{tab === "mcp" ? <McpStorePanel /> : <SkillStorePanel />}</section>
  </div>;
}
