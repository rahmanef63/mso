"use client";

import { useState } from "react";
import { toast, useFeatureState } from "@/features/appshell";
import { useSettingsWindow } from "../lib/window-context";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsBlock } from "@/features/shell-settings";
import { CustomProviderForm } from "./custom-provider-form";
import { OAuthConnect } from "./oauth-connect";
import { ProviderList, type ConnectedProvider } from "./provider-list";
import { ProviderModelsDialog } from "./provider-models-dialog";

// The provider-management block below the active-provider config: OAuth sign-in,
// add-a-custom-endpoint, the connected-provider list with per-provider model
// management, and delete. `reload` re-fetches /api/config in the parent after
// any change.
export function ProviderManage({
  providers,
  selected,
  reload,
}: {
  providers: ConnectedProvider[];
  selected: string;
  reload: () => void;
}) {
  const { winId, setSensitiveDirty } = useSettingsWindow();
  const [showAdd, setShowAdd] = useFeatureState(winId, "provider-form-open", false);
  const [key, setKey] = useFeatureState(winId, "provider-key", "", { sensitive: true });
  const [json, setJson] = useFeatureState(winId, "provider-json", "", { sensitive: true });
  const [submitting] = useFeatureState(winId, "provider-submitting", false);
  const [managing, setManaging] = useState<ConnectedProvider | null>(null);
  const toggleForm = () => {
    if (showAdd && submitting) return void toast("Wait for the provider request to finish before closing the form.");
    if (showAdd && (key || json) && !window.confirm("Discard the unsaved API key or JSON?")) return;
    if (showAdd) { setKey(""); setJson(""); setSensitiveDirty(false); }
    setShowAdd(!showAdd);
  };
  return (
    <>
      <SettingsBlock>
        <OAuthConnect onConnected={reload} />
      </SettingsBlock>

      <SettingsBlock>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={showAdd}
          aria-controls="custom-provider-form"
          className="text-muted-foreground [@media(pointer:coarse)]:min-h-[44px]"
          onClick={toggleForm}
        >
          <Plus className={`size-3.5 transition-transform ${showAdd ? "rotate-45" : ""}`} />
          {showAdd ? "Close custom provider form" : "Add custom provider"}
        </Button>
        {showAdd ? (
          <div id="custom-provider-form" className="mt-2">
            <CustomProviderForm
              onAdded={() => {
                setShowAdd(false);
                reload();
              }}
            />
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Any OpenAI-compatible or Anthropic-Messages endpoint: paste its base URL and key,
            then Discover to pull in the model ids it serves.
          </p>
        )}
      </SettingsBlock>

      {providers.length > 0 && (
        <SettingsBlock>
          <ProviderList
            providers={providers}
            selected={selected}
            onChanged={reload}
            onManageModels={(provider) => setManaging(provider)}
          />
        </SettingsBlock>
      )}

      <ProviderModelsDialog
        provider={managing}
        open={managing !== null}
        onOpenChange={(open) => { if (!open) setManaging(null); }}
        onSaved={reload}
      />
    </>
  );
}
