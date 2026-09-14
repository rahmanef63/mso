"use client";

import { AppFrame } from "@/features/appshell";

/**
 * Shell window for the canonical owner Integrations workbench.
 * The iframe reuses /integrations so browser, MCP Page, CLI and the desktop app
 * continue to share one credential-management implementation and policy surface.
 */
export default function IntegrationsApp() {
  return (
    <AppFrame safeArea={false} bodyClassName="overflow-hidden bg-background">
      <iframe
        src="/integrations?embed=shell"
        title="MSO Integrations"
        className="h-full w-full border-0 bg-background"
        referrerPolicy="same-origin"
      />
    </AppFrame>
  );
}
