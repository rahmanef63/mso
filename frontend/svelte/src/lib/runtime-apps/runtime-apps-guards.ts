export const ANSI_CSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
export const CTRL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
export const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
export const isNullableStr = (v: unknown): v is string | null => v === null || typeof v === "string";
export const isOptStr = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";
export const isOptBool = (v: unknown): v is boolean | undefined => v === undefined || typeof v === "boolean";
