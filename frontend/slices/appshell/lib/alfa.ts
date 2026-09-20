"use client";

import { useSyncExternalStore } from "react";

// THE Alfa conversation. One store, one conversation, many windows onto it — the
// Assistant app and the per-app Alfa sheet are two views of this, not two chats.
//
// Why a module-level store rather than context: this is the same shape the other
// ~20 stores here use (subscribe + getSnapshot + useSyncExternalStore), and it is
// the CHEAPER option. Before this, the Assistant app held one messages array and
// every mounted Inspector held another that was thrown away on each app switch
// (`key={appId}` remount). One array shared by every surface is strictly less
// memory than N arrays, and a surface that is not mounted costs nothing at all.
//
// RAM discipline, because this runs on a small VPS:
//  • MAX_MESSAGES caps what is held in memory. The server file keeps more (200,
//    app/api/threads/route.ts) — scrollback lives on disk, not in the tab.
//  • ONE run in flight, enforced here. Opening the sheet in five apps cannot
//    start five streams; the second caller is refused, not queued.
//  • The agent engine (tools, approvals, the whole assistant bundle) is NOT
//    imported here. It is registered as a lazy loader and pulled on the FIRST
//    send, so a session that never talks to Alfa never pays for it.
//  • No polling, no second socket, no new dependency.

export type AlfaRole = "user" | "assistant" | "tool";

export type AlfaMessage = {
  id: string;
  /** Local creation time of this display message. */
  createdAt: number;
  role: AlfaRole;
  text?: string;
  /** Which app this turn happened in — the cross-feature trail. */
  appId?: string;
  /** Opaque to this store; the assistant slice owns its shape (tool cards). */
  tool?: unknown;
};

/** What a surface hands the engine so a reply is grounded in what the user sees. */
export type AlfaContext = { appId?: string; subject?: string; context?: string };

/** The real agent, supplied by the consumer. Streams into the store itself. */
export type AlfaRunner = (text: string, ctx: AlfaContext) => Promise<void>;

const MAX_MESSAGES = 60;

let messages: AlfaMessage[] = [];
let busy = false;
let runner: (() => Promise<AlfaRunner>) | null = null;
let loaded: AlfaRunner | null = null;

const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

// Stable snapshots: useSyncExternalStore compares by reference, so these must not
// be rebuilt per call or every subscriber re-renders forever.
const getMessages = () => messages;
const getBusy = () => busy;
const EMPTY: AlfaMessage[] = [];

export function useAlfaMessages(): AlfaMessage[] {
  return useSyncExternalStore(subscribe, getMessages, () => EMPTY);
}

export function useAlfaBusy(): boolean {
  return useSyncExternalStore(subscribe, getBusy, () => false);
}

function cap(list: AlfaMessage[]): AlfaMessage[] {
  return list.length > MAX_MESSAGES ? list.slice(-MAX_MESSAGES) : list;
}

/** Functional update, so a caller already written against a React setter (the
 *  Assistant's chat panel) can drive this store with the code it already has. */
export function updateAlfa(fn: (prev: AlfaMessage[]) => AlfaMessage[]): void {
  messages = cap(fn(messages));
  emit();
}

export function setAlfaBusy(v: boolean): void {
  if (busy === v) return;
  busy = v;
  emit();
}

// Aborting a run. The AbortController lives in the engine (the assistant panel), so
// like the runner it is registered rather than owned here — without this the Stop
// button in the dock and the mobile sheet was wired to an empty function.
let stopper: (() => void) | null = null;

export function registerAlfaStop(fn: () => void): void {
  stopper = fn;
}

export function stopAlfa(): void {
  stopper?.();
  setAlfaBusy(false);
}

/**
 * Install the real agent, as a LOADER rather than the thing itself.
 *
 * The engine lives in the assistant slice (tool catalog, approval cards, abort
 * plumbing) and appshell must not import a project slice — and should not want
 * to: eagerly pulling that bundle would cost every session, including the ones
 * that never open Alfa. os-shell registers a `() => import(...)` here, and the
 * chunk is fetched on the first send.
 */
export function registerAlfaRunner(loader: () => Promise<AlfaRunner>): void {
  runner = loader;
  // MUST clear the resolved engine too. `loaded` is memoised on first send, and
  // without this a remounted panel registers a fresh loader while sends keep going
  // to the FIRST instance's closure — writes land in the store but its setState is
  // dead, so no approval card renders and Stop does nothing.
  loaded = null;
}

/** Clear the engine entirely — the unmount counterpart of registerAlfaRunner.
 *  Installing a no-op loader instead was worse than useless: a mount, unmount, then
 *  first-ever send would MEMOISE the no-op, after which every send resolved silently
 *  and sendToAlfa still returned true. */
export function unregisterAlfaRunner(): void {
  runner = null;
  loaded = null;
  stopper = null;
}

export function alfaReady(): boolean {
  return runner !== null;
}

/**
 * Send from ANY surface. Single-flight: a second send while one is running is
 * refused rather than queued, so two open views cannot double-spend the model.
 * Returns false when it was refused or no engine is registered.
 */
export async function sendToAlfa(text: string, ctx: AlfaContext = {}): Promise<boolean> {
  const body = text.trim();
  if (!body || busy || !runner) return false;
  setAlfaBusy(true);
  try {
    loaded = loaded ?? (await runner());
    await loaded(body, ctx);
    return true;
  } catch {
    // The engine owns its own error rows; this only guarantees the lock is freed.
    return false;
  } finally {
    setAlfaBusy(false);
  }
}
