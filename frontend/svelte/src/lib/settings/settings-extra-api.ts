// Settings API facade. Domain modules live in ./settings-*-api.ts; this file
// only re-exports so existing imports of "./settings-extra-api.ts" keep working.
export { ApiError } from "../host-api.ts";
export type { ShellBridge } from "../shell-bridge.ts";
export { formatBytes, formatTimestamp } from "./settings-format.ts";
export * from "./settings-ai-api.ts";
export * from "./settings-mcp-api.ts";
export * from "./settings-mem-api.ts";
export * from "./settings-sys-api.ts";
export * from "./settings-about-api.ts";
