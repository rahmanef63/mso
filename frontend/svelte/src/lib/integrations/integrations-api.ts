import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";
import {
  canonicalProviderId, validateChannelsSnapshot, validateChannelTestResult, validateIntegrationsSnapshot,
  type ChannelCheckInfo, type ChannelItem, type ChannelProviderId, type ChannelProviderInfo,
  type ChannelsSnapshot, type ChannelTestResult, type IntegrationConnectionSource,
  type IntegrationConnectionSummary, type IntegrationsSnapshot, type IntegrationUserProfile,
} from "./integrations-schema.ts";

export { ApiError, canonicalProviderId };
export type {
  ChannelCheckInfo, ChannelItem, ChannelProviderId, ChannelProviderInfo, ChannelsSnapshot,
  ChannelTestResult, IntegrationConnectionSource, IntegrationConnectionSummary,
  IntegrationsSnapshot, IntegrationUserProfile, ShellBridge,
};

export type IntegrationsState =
  | { kind: "loading" }
  | { kind: "ready"; snapshot: IntegrationsSnapshot }
  | { kind: "error"; message: string; forbidden?: boolean };

export type ChannelTestFeedback = { status: "testing" | "ok" | "error"; message: string; checkedAt: string | null };

export type ChannelsState =
  | { kind: "loading" }
  | { kind: "ready"; snapshot: ChannelsSnapshot; tests: Record<string, ChannelTestFeedback> }
  | { kind: "error"; message: string; forbidden?: boolean };

function statusMessage(status: number, label: string): string {
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return `Owner role is required to access ${label.toLowerCase()}.`;
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 502 || status === 503) return `${label} service is temporarily unavailable. Retry when ready.`;
  return `${label} request failed (${status}).`;
}

async function requestJson(
  path: string, options: { method: "GET" | "POST"; label: string; body?: Record<string, unknown> },
  signal: AbortSignal, fetcher: typeof fetch, bridge: ShellBridge,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let bodyText: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyText = JSON.stringify(options.body);
  }
  const response = await fetcher(resolveApiUrl(path, bridge), {
    method: options.method, credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers,
    ...(bodyText !== undefined ? { body: bodyText } : {}),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status, options.label), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status, options.label), response.status);
  try { return await response.json(); } catch {
    throw new ApiError(`The MSO ${options.label.toLowerCase()} response is invalid.`, 502);
  }
}

export async function readIntegrations(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<IntegrationsSnapshot> {
  return validateIntegrationsSnapshot(
    await requestJson("/api/v1/integrations", { method: "GET", label: "Integrations" }, signal, fetcher, bridge),
  );
}

export async function readChannels(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<ChannelsSnapshot> {
  return validateChannelsSnapshot(
    await requestJson("/api/v1/channels", { method: "GET", label: "Channels" }, signal, fetcher, bridge),
  );
}

export async function testChannel(
  id: string, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<ChannelTestResult> {
  const trimmed = id.trim();
  if (!trimmed) throw new ApiError("Channel ID is required.", 400);
  return validateChannelTestResult(
    await requestJson("/api/v1/channels", { method: "POST", label: "Channel test", body: { action: "test", id: trimmed } }, signal, fetcher, bridge),
  );
}

export function createIntegrationsController(
  update: (state: IntegrationsState) => void, fetcher = fetch, bridge?: ShellBridge,
) {
  let generation = 0; let active: AbortController | undefined; let disposed = false;
  return {
    async refresh() {
      if (disposed) return;
      const run = ++generation;
      active?.abort();
      const controller = (active = new AbortController());
      update({ kind: "loading" });
      try {
        const snapshot = await readIntegrations(controller.signal, fetcher, bridge);
        if (!disposed && run === generation) update({ kind: "ready", snapshot });
      } catch (error) {
        if (!disposed && run === generation && !controller.signal.aborted) {
          const forbidden = error instanceof ApiError && error.status === 403;
          update({
            kind: "error",
            message: error instanceof ApiError ? error.message : "Could not load integrations. Check the backend and retry.",
            ...(forbidden ? { forbidden: true } : {}),
          });
        }
      }
    },
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}

export function createChannelsController(
  update: (state: ChannelsState) => void, fetcher = fetch, bridge?: ShellBridge,
) {
  let generation = 0; let active: AbortController | undefined; let disposed = false;
  let current: ChannelsSnapshot | null = null;
  let tests: Record<string, ChannelTestFeedback> = {};
  const testAborts = new Map<string, AbortController>();

  function emitReady() {
    if (!disposed && current) update({ kind: "ready", snapshot: current, tests: { ...tests } });
  }

  return {
    async refresh() {
      if (disposed) return;
      const run = ++generation;
      active?.abort();
      const controller = (active = new AbortController());
      update({ kind: "loading" });
      try {
        const snapshot = await readChannels(controller.signal, fetcher, bridge);
        if (!disposed && run === generation) { current = snapshot; emitReady(); }
      } catch (error) {
        if (!disposed && run === generation && !controller.signal.aborted) {
          const forbidden = error instanceof ApiError && error.status === 403;
          update({
            kind: "error",
            message: error instanceof ApiError ? error.message : "Could not load channels. Check the backend and retry.",
            ...(forbidden ? { forbidden: true } : {}),
          });
        }
      }
    },
    async runTest(id: string): Promise<boolean> {
      if (disposed || !current) return false;
      testAborts.get(id)?.abort();
      const controller = new AbortController();
      testAborts.set(id, controller);
      tests = { ...tests, [id]: { status: "testing", message: "Testing connectivity...", checkedAt: null } };
      emitReady();
      try {
        const result = await testChannel(id, controller.signal, fetcher, bridge);
        if (disposed || testAborts.get(id) !== controller) return false;
        const checkedAt = result.checkedAt ?? new Date().toISOString();
        const detail = result.detail.trim() || (result.ok ? "Connectivity verified." : "Verification failed.");
        tests = { ...tests, [id]: { status: result.ok ? "ok" : "error", message: detail, checkedAt } };
        current = {
          ...current,
          channels: current.channels.map((ch) => (ch.id === id ? { ...ch, lastCheck: { at: checkedAt, ok: result.ok, detail } } : ch)),
        };
        emitReady();
        return result.ok;
      } catch (error) {
        if (disposed || testAborts.get(id) !== controller || controller.signal.aborted) return false;
        tests = {
          ...tests,
          [id]: { status: "error", message: error instanceof ApiError ? error.message : "Could not test channel connectivity.", checkedAt: null },
        };
        emitReady();
        return false;
      } finally {
        if (testAborts.get(id) === controller) testAborts.delete(id);
      }
    },
    dispose() {
      disposed = true; generation++; active?.abort();
      for (const ctrl of testAborts.values()) ctrl.abort();
      testAborts.clear();
    },
  };
}
