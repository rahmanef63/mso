// Compatibility path for the original Alfa owner-global memory API.
// New agent/session memory is principal-scoped in lib/agent/memory-store.ts; do
// not merge these identities implicitly.
export { listMemories, addMemory, removeMemory, recall } from "@/lib/agent/legacy-owner-memory";
export type { Memory } from "@/lib/agent/legacy-owner-memory";
