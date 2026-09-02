// Compatibility facade. New code imports a capability-specific host API so one
// native/optional dependency cannot pull every host surface into its graph.
export * from "./fs-api";
export * from "./exec-api";
export * from "./projects-api";
export * from "./terminal-api";
export * from "./system-api";
export * from "./screenshot-api";
export * from "./audit-api";
export * from "./temp-share-api";
export * from "./request-api";
export * from "./limits-api";
