"use client";

import type { ReactNode } from "react";
import type { WorkflowEmbed } from "@/lib/contracts/surface-app";
import { ExternalAppFrame } from "@/components/external-app-frame";

export function N8nEmbedPanel({
  app,
  actions,
}: {
  app: WorkflowEmbed;
  actions?: ReactNode;
}) {
  return <ExternalAppFrame app={app} frameTitle="n8n automation editor" minimal actions={actions} />;
}
