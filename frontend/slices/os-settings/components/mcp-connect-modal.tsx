"use client";

import { AlertTriangle, Key } from "lucide-react";
import { useState } from "react";
import { ResponsiveDialog } from "@/features/appshell";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { McpCopyField } from "./mcp-copy-field";

interface McpConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  origin: string;
  token?: string;
  label?: string;
}

export function McpConnectModal({
  open,
  onOpenChange,
  origin,
  token,
  label,
}: McpConnectModalProps) {
  const [activeTab, setActiveTab] = useState<"antigravity" | "gemini" | "cursor" | "claude">("antigravity");
  const cleanOrigin = origin.replace(/\/+$/, "");
  const mcpUrl = `${cleanOrigin}/mcp`;
  const tokenValue = token || "<YOUR_TOKEN>";

  const antigravitySnippet = JSON.stringify(
    {
      mso: {
        url: mcpUrl,
        headers: {
          Authorization: `Bearer ${tokenValue}`,
        },
      },
    },
    null,
    2
  );

  const cursorSnippet = JSON.stringify(
    {
      mcpServers: {
        mso: {
          url: mcpUrl,
          headers: {
            Authorization: `Bearer ${tokenValue}`,
          },
        },
      },
    },
    null,
    2
  );

  const claudeDesktopSnippet = JSON.stringify(
    {
      mcpServers: {
        mso: {
          url: mcpUrl,
          headers: {
            Authorization: `Bearer ${tokenValue}`,
          },
        },
      },
    },
    null,
    2
  );

  const geminiCliCommand = `gemini mcp add --transport http --scope user -H "Authorization: Bearer ${tokenValue}" mso ${mcpUrl}`;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} size="lg" mobileVariant="drawer-bottom">
      <ResponsiveDialog.Header>
          <ResponsiveDialog.Title className="flex items-center gap-2 text-xl">
            <Key className="size-5 text-primary" />
            Connect MCP to Your AI Agent
          </ResponsiveDialog.Title>
          <ResponsiveDialog.Description>
            {label ? `Credentials for “${label}”. ` : ""}
            Configure your AI assistant or IDE to control MSO using Streamable HTTP.
          </ResponsiveDialog.Description>
      </ResponsiveDialog.Header>
      <ResponsiveDialog.Body className="space-y-4">

        {token && (
          <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm text-amber-600 dark:text-amber-400">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4 shrink-0" />
              <span>Simpan token ini sekarang</span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Token rahasia ini hanya ditampilkan sekali saat pembuatan. Jika hilang, Anda harus membuat token baru.
            </p>
            <div className="mt-2">
              <McpCopyField label="Raw Token" value={token} />
            </div>
          </div>
        )}

        <div className="space-y-4">
          <Tabs>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger
                active={activeTab === "antigravity"}
                onClick={() => setActiveTab("antigravity")}
              >
                Antigravity
              </TabsTrigger>
              <TabsTrigger
                active={activeTab === "gemini"}
                onClick={() => setActiveTab("gemini")}
              >
                Gemini CLI
              </TabsTrigger>
              <TabsTrigger
                active={activeTab === "cursor"}
                onClick={() => setActiveTab("cursor")}
              >
                Cursor
              </TabsTrigger>
              <TabsTrigger
                active={activeTab === "claude"}
                onClick={() => setActiveTab("claude")}
              >
                Claude
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {activeTab === "antigravity" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Tambahkan ke file konfigurasi Antigravity di{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  ~/.gemini/config/mcp_config.json
                </code>{" "}
                di bawah key <code className="font-mono text-[11px]">mcpServers</code>:
              </p>
              <McpCopyField
                label="Antigravity mcp_config.json"
                value={antigravitySnippet}
                multiline
              />
            </div>
          )}

          {activeTab === "gemini" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Jalankan perintah ini di terminal Anda untuk mendaftarkan MCP MSO ke Gemini CLI:
              </p>
              <McpCopyField
                label="Gemini CLI Command"
                value={geminiCliCommand}
                multiline
              />
            </div>
          )}

          {activeTab === "cursor" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Buka Cursor Settings → MCP atau edit langsung file{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  ~/.cursor/mcp.json
                </code>:
              </p>
              <McpCopyField
                label="Cursor mcp.json"
                value={cursorSnippet}
                multiline
              />
            </div>
          )}

          {activeTab === "claude" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Tambahkan ke file{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  claude_desktop_config.json
                </code>:
              </p>
              <McpCopyField
                label="Claude Desktop Config"
                value={claudeDesktopSnippet}
                multiline
              />
            </div>
          )}
        </div>
      </ResponsiveDialog.Body>
    </ResponsiveDialog>
  );
}
