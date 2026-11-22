import { afterEach, expect, it, vi } from "vitest";
import { defaultComposition } from "./mock-timeline";

const hooks = vi.hoisted(() => ({ refs: [] as Array<{ current: unknown }>, states: [] as unknown[], effects: [] as Array<() => void | (() => void)>, cursor: 0, stateCursor: 0 }));
vi.mock("react", () => ({
  useRef: (value: unknown) => hooks.refs[hooks.cursor++] ?? (hooks.refs[hooks.cursor - 1] = { current: value }),
  useState: (value: unknown) => {
    const i = hooks.stateCursor++;
    if (!(i in hooks.states)) hooks.states[i] = value;
    return [hooks.states[i], (next: unknown) => { hooks.states[i] = next; }];
  },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
vi.mock("@/features/appshell", () => ({ setCloseGuard: vi.fn() }));
vi.mock("./settings", () => ({ getSettings: () => ({ autosave: true }) }));
import { useDraftAutosave } from "./use-draft-autosave";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("preserves a newer recovery draft written between load and effect", () => {
  vi.useFakeTimers();
  hooks.refs = []; hooks.states = [];
  const original = defaultComposition();
  const oldRaw = JSON.stringify(original);
  let stored = JSON.stringify({ ...original, w: 1280 });
  vi.stubGlobal("localStorage", { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const baseline = { snapshot: oldRaw, available: true };
  const useFixture = (comp: typeof original) => {
    hooks.cursor = 0; hooks.stateCursor = 0; hooks.effects = [];
    useDraftAutosave(comp, baseline);
    return hooks.effects.map((effect) => effect());
  };
  useFixture(original);
  useFixture({ ...original, h: 720 });
  vi.advanceTimersByTime(800);
  expect(JSON.parse(stored).w).toBe(1280);
  expect(hooks.states[1]).toContain("Another tab changed");
});
