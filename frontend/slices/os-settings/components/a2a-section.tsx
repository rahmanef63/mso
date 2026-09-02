"use client";

import { useCallback, useEffect, useState } from "react";
import { Network } from "lucide-react";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import { toast } from "@/features/appshell";
import { IS_DEMO } from "@/lib/demo";
import { A2AActivitySettings } from "./a2a-activity-settings";
import { A2AInboundSettings } from "./a2a-inbound-settings";
import { A2APeerSettings } from "./a2a-peer-settings";
import {
  postA2A,
  type A2AAction,
  type A2ASettingsState,
} from "./a2a-section-model";

export function A2ASection() {
  const [state, setState] = useState<A2ASettingsState | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    if (IS_DEMO) return;
    fetch("/api/v1/a2a?action=state", { cache: "no-store" })
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error(`HTTP ${response.status}`)),
      )
      .then((next: A2ASettingsState) => setState(next))
      .catch(() => toast("Couldn't load A2A state", { tone: "error" }));
  }, []);
  useEffect(load, [load]);

  const act: A2AAction = useCallback(
    async (body, success) => {
      setBusy(true);
      try {
        const data = await postA2A(body);
        toast(success);
        load();
        return data;
      } catch (error) {
        toast(error instanceof Error ? error.message : "A2A action failed", {
          tone: "error",
        });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (IS_DEMO) {
    return (
      <SettingsSection icon={<Network />} title="Agent-to-Agent">
        <SettingsBlock className="py-4 text-xs text-muted-foreground">
          A2A is unavailable in demo mode.
        </SettingsBlock>
      </SettingsSection>
    );
  }
  if (!state) {
    return (
      <SettingsSection icon={<Network />} title="Agent-to-Agent">
        <SettingsBlock>
          <div className="h-4 w-48 animate-pulse rounded bg-secondary" />
        </SettingsBlock>
      </SettingsSection>
    );
  }
  return (
    <div className="space-y-4 sm:space-y-5">
      <A2AInboundSettings state={state} busy={busy} act={act} />
      <A2APeerSettings state={state} busy={busy} act={act} />
      <A2AActivitySettings state={state} />
    </div>
  );
}
