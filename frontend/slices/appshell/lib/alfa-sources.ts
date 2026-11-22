"use client";

import type { MentionItem } from "./mentions";
import { triggerAlfaLoader } from "./alfa-loader";

export { registerAlfaLoader } from "./alfa-loader";

// Completion sources for the composer's @ and / menus. Same seam as the runner and
// for the same reason: agents live in the assistant slice's localStorage store and
// skills come from /api/skills, neither of which appshell may reach. The consumer
// registers plain GETTERS — called on keystroke, never subscribed to — so typing
// re-renders the popup and nothing else. If nothing is registered the menus are
// simply empty and the composer behaves as it always did.
export type AlfaSources = {
  /** Display name of the agent currently answering, for the thread header. Without
   *  it a switch made from the sheet is global, persistent AND invisible — the user
   *  changes who replies to every future message with no feedback at all. */
  activeAgentName?: () => string | null;
  /** @ — the agents the user can address. */
  agents: () => MentionItem[];
  /** / — skills and executable tools, already merged and labelled by the consumer. */
  commands: () => MentionItem[];
};

const NO_SOURCES: AlfaSources = { agents: () => [], commands: () => [] };
let sources: AlfaSources = NO_SOURCES;

const subs = new Set<() => void>();
let version = 0;

export function registerAlfaSources(next: AlfaSources): void {
  sources = next;
  notifyAlfaSources();
}

/** Call when a getter's data lands asynchronously (the skills fetch). The composer
 *  computes its item list DURING render — deliberately, see chat-composer — so
 *  without this the new rows only appear on the user's next keystroke. */
export function notifyAlfaSources(): void {
  version++;
  for (const cb of subs) cb();
}

export function subscribeAlfaSources(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function alfaSourcesVersion(): number {
  return version;
}

export function alfaSources(): AlfaSources {
  triggerAlfaLoader();
  return sources;
}
