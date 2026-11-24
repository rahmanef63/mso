import { ApiError } from "../host-api.ts";
import type {
  CamoufoxSession, CamoufoxStatus, DesktopContainerItem, DesktopLifecycleResult,
} from "./runtime-apps-types.ts";
import { isNonEmpty, isNullableStr, isOptBool, isOptStr, isRecord } from "./runtime-apps-guards.ts";

export function validateCamoufoxStatus(value: unknown): CamoufoxStatus {
  if (!isRecord(value) || typeof value.running !== "boolean" || !isOptBool(value.enabled)
      || !isOptBool(value.installed) || !isOptBool(value.viewerReady)
      || !isOptStr(value.activeState) || !isOptStr(value.unit) || !isOptStr(value.detail)) {
    throw new ApiError("The MSO Camoufox status response is invalid.", 502);
  }
  return {
    running: value.running,
    ...(value.enabled !== undefined ? { enabled: value.enabled } : {}),
    ...(value.installed !== undefined ? { installed: value.installed } : {}),
    ...(value.viewerReady !== undefined ? { viewerReady: value.viewerReady } : {}),
    ...(value.activeState !== undefined ? { activeState: value.activeState } : {}),
    ...(value.unit !== undefined ? { unit: value.unit } : {}),
    ...(value.detail !== undefined ? { detail: value.detail } : {}),
  };
}

export function validateCamoufoxSession(value: unknown): CamoufoxSession {
  if (!isRecord(value)) throw new ApiError("The MSO Camoufox session response is invalid.", 502);
  const rawOrigin = value.viewerOrigin;
  const rawPrefix = value.viewerPathPrefix;
  if ((rawOrigin !== undefined && !isNullableStr(rawOrigin))
      || (rawPrefix !== undefined && !isNullableStr(rawPrefix))
      || (value.password !== undefined && !isNullableStr(value.password))) {
    throw new ApiError("The MSO Camoufox session response is invalid.", 502);
  }
  return {
    hasPassword: typeof value.password === "string" && value.password.trim().length > 0,
    viewerOrigin: typeof rawOrigin === "string" && rawOrigin.trim() ? rawOrigin.trim() : null,
    viewerPathPrefix: typeof rawPrefix === "string" && rawPrefix.trim() ? rawPrefix.trim() : null,
  };
}

export function validateContainer(item: unknown): DesktopContainerItem {
  if (!isRecord(item) || !isNonEmpty(item.id) || typeof item.name !== "string"
      || typeof item.state !== "string" || typeof item.status !== "string"
      || typeof item.created !== "string" || typeof item.ports !== "string"
      || !isRecord(item.labels) || !isNullableStr(item.labels.user) || !isNullableStr(item.labels.bot)) {
    throw new ApiError("The MSO desktop containers response is invalid.", 502);
  }
  return {
    id: item.id, name: item.name, state: item.state, status: item.status,
    labels: { user: item.labels.user, bot: item.labels.bot }, created: item.created, ports: item.ports,
  };
}
