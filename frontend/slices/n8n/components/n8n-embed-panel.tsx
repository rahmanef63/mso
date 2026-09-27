"use client";
import type { WorkflowEmbed } from "@/lib/contracts/surface-app";
import { ExternalAppFrame } from "@/components/external-app-frame";
export function N8nEmbedPanel({ app }: { app: WorkflowEmbed }) {
  return <ExternalAppFrame app={app} frameTitle="n8n automation editor" />;
}
