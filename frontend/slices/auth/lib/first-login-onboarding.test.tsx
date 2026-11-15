import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FirstLoginOnboarding } from "../components/first-login-onboarding";
import { ONBOARDING_KEY } from "./onboarding-state";

// Regression: the onboarding dialog opened from a `useState` initializer that
// read localStorage. The server never sees storage, so it rendered closed while
// the client rendered open — a hydration mismatch that React reported against
// the nearest boundary (Next's MetadataOutlet script in app/layout.tsx), which
// is how it reached the browser console. The dialog must be closed on the first
// render on BOTH sides and open from an effect.
function withStorage(value: Record<string, string>) {
  const store = new Map(Object.entries(value));
  const target = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, next: string) => { store.set(key, next); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  } as Storage;
  (globalThis as { localStorage?: Storage }).localStorage = target;
  return target;
}

const original = (globalThis as { localStorage?: Storage }).localStorage;
afterEach(() => {
  if (original) (globalThis as { localStorage?: Storage }).localStorage = original;
  else delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("first-login onboarding server render", () => {
  it("renders closed when storage says the guide was never dismissed", () => {
    withStorage({});
    // No window: this is the server pass. The dialog must not be in the markup,
    // whatever localStorage would have said on the client.
    expect(renderToStaticMarkup(<FirstLoginOnboarding />)).not.toContain("Set up MSO");
  });

  it("renders closed when storage says the guide is done", () => {
    withStorage({ [ONBOARDING_KEY]: "done" });
    expect(renderToStaticMarkup(<FirstLoginOnboarding />)).not.toContain("Set up MSO");
  });
});
