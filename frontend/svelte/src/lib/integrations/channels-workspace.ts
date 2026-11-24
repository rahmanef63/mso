import { ApiError } from "../host-api.ts";
import type { ShellBridge } from "../shell-bridge.ts";
import {
  createChannel, deleteChannel, sendChannelMessage, setChannelEnabled, testChannelConnection, updateChannel,
} from "./channels-actions.ts";
import {
  readChannelsWorkspace, type ChannelDraft, type ChannelsWorkspace,
} from "./channels-api.ts";
import type { ChannelTestFeedback } from "./integrations-api.ts";

export type ChannelsWorkspaceState =
  | { kind: "loading" }
  | { kind: "ready"; workspace: ChannelsWorkspace; tests: Record<string, ChannelTestFeedback> }
  | { kind: "error"; message: string; forbidden?: boolean };

/** Owner-only state owner for the Channels window: one workspace read, one write lane,
 *  one test lane. Reference lists degrade to empty instead of blocking the list. */
export function createChannelsWorkspaceController(
  update: (state: ChannelsWorkspaceState) => void, fetcher = fetch, bridge?: ShellBridge,
) {
  let generation = 0; let active: AbortController | undefined; let disposed = false;
  let workspace: ChannelsWorkspace | null = null;
  let tests: Record<string, ChannelTestFeedback> = {};
  const testAborts = new Map<string, AbortController>();

  const emit = () => {
    if (!disposed && workspace) update({ kind: "ready", workspace, tests: { ...tests } });
  };

  async function refresh() {
    if (disposed) return;
    const run = ++generation;
    active?.abort();
    const controller = (active = new AbortController());
    update({ kind: "loading" });
    try {
      const next = await readChannelsWorkspace(controller.signal, fetcher, bridge);
      if (disposed || run !== generation) return;
      workspace = next;
      emit();
    } catch (error) {
      if (disposed || run !== generation || controller.signal.aborted) return;
      const forbidden = error instanceof ApiError && error.status === 403;
      update({
        kind: "error",
        message: error instanceof ApiError ? error.message : "Could not load channels. Check the backend and retry.",
        ...(forbidden ? { forbidden } : {}),
      });
    }
  }

  /** Every write funnels here: revision-guarded, then a canonical re-read so the card
   *  never shows a locally-invented state. A failed write keeps the draft and the error. */
  async function write(action: (revision: number) => Promise<void>): Promise<boolean> {
    if (disposed || !workspace) return false;
    try {
      await action(workspace.revision);
      await refresh();
      return true;
    } catch (error) {
      if (!disposed) {
        update({
          kind: "error",
          message: error instanceof ApiError ? error.message : "The channel action failed. Reload and retry.",
        });
        workspace = null;
      }
      return false;
    }
  }

  return {
    refresh,
    async save(row: { id: string } | null, draft: ChannelDraft): Promise<boolean> {
      return write((revision) => (row
        ? updateChannel(row.id, revision, draft, new AbortController().signal, fetcher, bridge)
        : createChannel(draft, new AbortController().signal, fetcher, bridge)));
    },
    async toggle(id: string, enabled: boolean): Promise<boolean> {
      return write((revision) => setChannelEnabled(id, revision, enabled, new AbortController().signal, fetcher, bridge));
    },
    async remove(id: string): Promise<boolean> {
      return write((revision) => deleteChannel(id, revision, new AbortController().signal, fetcher, bridge));
    },
    async send(id: string, target: string, text: string): Promise<boolean> {
      if (disposed) return false;
      try {
        const result = await sendChannelMessage(id, target, text, new AbortController().signal, fetcher, bridge);
        if (!disposed) {
          tests = { ...tests, [id]: { status: "ok", message: `Message sent to ${result.target}.`, checkedAt: new Date().toISOString() } };
          emit();
        }
        return true;
      } catch (error) {
        if (!disposed) {
          tests = {
            ...tests,
            [id]: { status: "error", message: error instanceof ApiError ? error.message : "Could not send the message.", checkedAt: null },
          };
          emit();
        }
        return false;
      }
    },
    async runTest(id: string): Promise<boolean> {
      if (disposed || !workspace) return false;
      testAborts.get(id)?.abort();
      const controller = new AbortController();
      testAborts.set(id, controller);
      tests = { ...tests, [id]: { status: "testing", message: "Testing connectivity...", checkedAt: null } };
      emit();
      try {
        const result = await testChannelConnection(id, controller.signal, fetcher, bridge);
        if (disposed || testAborts.get(id) !== controller) return false;
        tests = { ...tests, [id]: { status: result.ok ? "ok" : "error", message: result.detail, checkedAt: result.checkedAt } };
        if (result.ok) await refresh();
        else emit();
        return result.ok;
      } catch (error) {
        if (disposed || testAborts.get(id) !== controller || controller.signal.aborted) return false;
        tests = {
          ...tests,
          [id]: { status: "error", message: error instanceof ApiError ? error.message : "Could not test connectivity.", checkedAt: null },
        };
        emit();
        return false;
      } finally {
        if (testAborts.get(id) === controller) testAborts.delete(id);
      }
    },
    dispose() {
      disposed = true; generation++; active?.abort();
      for (const controller of testAborts.values()) controller.abort();
      testAborts.clear();
    },
  };
}
