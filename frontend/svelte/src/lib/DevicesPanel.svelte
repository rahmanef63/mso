<script lang="ts">
  import { onMount } from "svelte";
  import { createDevicesController, type DevicesState } from "./devices-controller";
  import type { DeviceRole } from "./host-api";

  let { currentDeviceId }: { currentDeviceId: string | null } = $props();

  let view = $state<DevicesState>({ kind: "loading" });
  let pendingRoles = $state<Record<string, DeviceRole>>({});
  let confirmRevokeId = $state<string | null>(null);
  let controller: ReturnType<typeof createDevicesController> | undefined;

  onMount(() => {
    controller = createDevicesController((next) => { view = next; });
    void controller.refresh();
    return () => controller?.dispose();
  });

  function chosenRole(id: string): DeviceRole {
    return pendingRoles[id] ?? "viewer";
  }

  function formatTime(ms: number): string {
    if (!ms) return "Unknown";
    return new Date(ms).toLocaleString();
  }
</script>

<section aria-labelledby="devices-title" aria-busy={view.kind === "loading"} data-devices-state={view.kind}>
  <header class="feature-header">
    <h2 id="devices-title">Devices &amp; Approvals</h2>
    <button disabled={view.kind === "loading"} onclick={() => void controller?.refresh()}>
      {view.kind === "loading" ? "Loading..." : "Refresh devices"}
    </button>
  </header>

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Loading approved and pending devices...</p>
    {:else if view.kind === "error"}
      <p class="feedback error">{view.message}</p>
    {:else}
      {#if view.notice}
        <p class="feedback ok">{view.notice}</p>
      {/if}
      {#if view.error}
        <p class="feedback error" role="alert">{view.error}</p>
      {/if}

      {@const pendingList = Object.entries(view.inventory.pending)}
      {@const approvedList = Object.entries(view.inventory.approved)}

      <div class="device-group">
        <h3>Pending requests ({pendingList.length})</h3>
        {#if pendingList.length === 0}
          <p>No devices waiting for approval.</p>
        {:else}
          <ul class="device-list">
            {#each pendingList as [id, item] (id)}
              <li class="device-row">
                <div class="device-info">
                  <strong>{item.label}</strong>
                  <span><code>{id.slice(0, 12)}</code> · {item.ip} · {item.attempts} attempt(s)</span>
                </div>
                <div class="device-controls">
                  <label class="sr-only" for={`pending-role-${id}`}>Role for {item.label}</label>
                  <select
                    id={`pending-role-${id}`}
                    value={chosenRole(id)}
                    disabled={view.busyId === id}
                    onchange={(e) => { pendingRoles = { ...pendingRoles, [id]: (e.currentTarget as HTMLSelectElement).value as DeviceRole }; }}
                  >
                    <option value="viewer">viewer</option>
                    <option value="operator">operator</option>
                    <option value="owner">owner</option>
                  </select>
                  <button
                    class="primary"
                    disabled={view.busyId === id}
                    onclick={() => void controller?.approve(id, item.label, chosenRole(id))}
                  >
                    Approve
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="device-group">
        <h3>Approved devices ({approvedList.length})</h3>
        {#if approvedList.length === 0}
          <p>No approved devices recorded.</p>
        {:else}
          <ul class="device-list">
            {#each approvedList as [id, item] (id)}
              {@const isSelf = id === currentDeviceId}
              <li class="device-row">
                <div class="device-info">
                  <strong>{item.label}{#if isSelf} (This device){/if}</strong>
                  <span><code>{id.slice(0, 12)}</code> · approved {formatTime(item.approvedAt)}</span>
                </div>
                <div class="device-controls">
                  <label class="sr-only" for={`approved-role-${id}`}>Role for {item.label}</label>
                  <select
                    id={`approved-role-${id}`}
                    value={item.role}
                    disabled={isSelf || view.busyId === id}
                    title={isSelf ? "Use another owner device or CLI to change this device" : "Change device role"}
                    onchange={(e) => void controller?.setRole(id, (e.currentTarget as HTMLSelectElement).value as DeviceRole)}
                  >
                    <option value="viewer">viewer</option>
                    <option value="operator">operator</option>
                    <option value="owner">owner</option>
                  </select>
                  {#if !isSelf}
                    {#if confirmRevokeId === id}
                      <button
                        class="danger"
                        disabled={view.busyId === id}
                        onclick={() => { confirmRevokeId = null; void controller?.revoke(id); }}
                      >
                        Confirm revoke
                      </button>
                      <button disabled={view.busyId === id} onclick={() => { confirmRevokeId = null; }}>
                        Cancel
                      </button>
                    {:else}
                      <button disabled={view.busyId === id} onclick={() => { confirmRevokeId = id; }}>
                        Revoke
                      </button>
                    {/if}
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
</section>
