"use client";

import { Wrench } from "lucide-react";
import { SettingsSection } from "@/features/shell-settings";
import { McpSetupGuide } from "./mcp-setup-guide";
import { McpToolsetCard, type McpToolsetInfo } from "./mcp-toolset-card";

export function McpConnectionSection({
  origin,
  maxScope,
  toolset,
}: {
  origin: string;
  maxScope: string;
  toolset: McpToolsetInfo;
}) {
  return (
    <div className="space-y-4 sm:space-y-5">
      <McpSetupGuide origin={origin} maxScope={maxScope} />
      <SettingsSection icon={<Wrench />} title="Toolset status" bare>
        <McpToolsetCard info={toolset} />
      </SettingsSection>
    </div>
  );
}
