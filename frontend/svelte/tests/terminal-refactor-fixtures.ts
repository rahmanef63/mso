// Fixtures for terminal-refactor.test.ts. Kept out of the test file so
// the suite stays under the repository's file-length ratchet.

import type { EventSourceLike } from "../src/lib/terminal/term-controller.ts";

export const DIR = new URL("../src/lib/terminal/", import.meta.url);

export const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

export class FakeEventSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  emitOpen() { this.readyState = 1; this.onopen?.(new Event("open")); }
  emitEvent(type: string, data: string) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data } as MessageEvent<string>);
  }
  close() { this.closed = true; this.readyState = 2; }
}
