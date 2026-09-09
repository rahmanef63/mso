"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SettingsBlock } from "@/features/shell-settings";
import {
  BUILT_IN_PLUGINS,
  PLUGIN_MANIFEST_SCHEMA,
  type PluginManifest,
  validatePluginManifest,
} from "@/lib/plugins/manifest";
import { useEffect, useState } from "react";

const STORAGE_KEY = "mso:custom-plugin-registry:v1";

function restoreCustomPlugins(raw: string | null) {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const builtInIds = new Set(BUILT_IN_PLUGINS.map((plugin) => plugin.id));
    const custom: PluginManifest[] = [];
    const seen = new Set<string>();
    for (const candidate of parsed) {
      const result = validatePluginManifest(candidate);
      if (!result.ok || builtInIds.has(result.manifest.id) || seen.has(result.manifest.id)) continue;
      seen.add(result.manifest.id);
      custom.push(result.manifest);
    }
    return custom;
  } catch {
    return [];
  }
}

export function McpPluginRegistry() {
  const [custom, setCustom] = useState<PluginManifest[]>([]);
  const [source, setSource] = useState("");
  const [message, setMessage] = useState(
    "Custom manifests are validated only. Registration never installs or runs plugin code.",
  );

  useEffect(() => {
    const restore = window.setTimeout(() => {
      setCustom(restoreCustomPlugins(window.localStorage.getItem(STORAGE_KEY)));
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  function persist(next: PluginManifest[]) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setCustom(next);
  }

  function add() {
    try {
      const result = validatePluginManifest(JSON.parse(source));
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      if ([...BUILT_IN_PLUGINS, ...custom].some((item) => item.id === result.manifest.id)) {
        setMessage("A plugin with this id is already registered.");
        return;
      }
      persist([...custom, result.manifest]);
      setSource("");
      setMessage(`Registered ${result.manifest.metadata.name}. Activation remains a separate approved action.`);
    } catch {
      setMessage("Enter valid JSON matching portable plugin manifest v1.");
    }
  }

  function remove(id: string) {
    const plugin = custom.find((item) => item.id === id);
    persist(custom.filter((item) => item.id !== id));
    setMessage(plugin ? `Removed ${plugin.metadata.name} from this browser registry.` : "Plugin removed.");
  }

  const plugins = [...BUILT_IN_PLUGINS, ...custom];

  return (
    <div className="space-y-4">
      <SettingsBlock className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">Plugins / Registry</p>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">declarations only</span>
        </div>
        <p className="text-sm text-muted-foreground">
          SI-Coder, Batonly, and custom plugins use the same portable manifest. A declaration may describe Agent Skills and
          MCP surfaces, but never credentials, environment values, headers, or shell commands.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Registered plugins">
          {plugins.map((plugin) => {
            const isCustom = custom.some((item) => item.id === plugin.id);
            return (
              <li key={plugin.id} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{plugin.metadata.name}</p>
                      <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {isCustom ? "Custom" : "Built-in"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{plugin.metadata.description}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {plugin.skills?.length ?? 0} skill{(plugin.skills?.length ?? 0) === 1 ? "" : "s"} · {plugin.mcp?.length ?? 0} MCP
                      {(plugin.mcp?.length ?? 0) === 1 ? "" : "s"}
                    </p>
                  </div>
                  {isCustom ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => remove(plugin.id)} aria-label={`Remove ${plugin.metadata.name}`}>
                      Remove
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </SettingsBlock>

      <SettingsBlock className="space-y-3 py-4">
        <div>
          <label htmlFor="custom-plugin-manifest" className="text-sm font-medium">
            Custom plugin manifest
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            Valid manifests are stored in this browser only. Activation and credentials stay separate from the registry.
          </p>
        </div>
        <Textarea
          id="custom-plugin-manifest"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className="min-h-40 font-mono text-xs"
          placeholder={`{"$schema":"${PLUGIN_MANIFEST_SCHEMA}","schemaVersion":1,"version":"1.0.0","id":"example-plugin","metadata":{"name":"Example","description":"Safe declaration"}}`}
          aria-describedby="custom-plugin-status"
          spellCheck={false}
        />
        <Button type="button" variant="secondary" onClick={add} className="min-h-11">
          Validate and register
        </Button>
        <p id="custom-plugin-status" role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      </SettingsBlock>
    </div>
  );
}
