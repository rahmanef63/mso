/** Framework-neutral pick / commit handlers shared by React and Svelte renderers. */

import { lucideValue, phosphorValue, parseIconValue, withColor, type IconValue } from "./parse";
import { pushRecent } from "./recents-core";
import { ALL_EMOJIS } from "./emoji-catalog";
import { ALL_LUCIDE } from "./lucide-catalog";
import { ALL_PHOSPHOR } from "./phosphor-catalog";

export type TopTab = "emoji" | "icon";
export type IconVariant = "lucide" | "phosphor";

export interface PickerHandlerDeps {
  parsed: IconValue;
  tab: TopTab;
  iconVariant: IconVariant;
  currentColor: string | undefined;
  colorEnabled: boolean;
  onChange: (next: string) => void;
  onClear?: () => void;
  onSelect?: () => void;
}

export interface PickerHandlers {
  pickEmoji: (emoji: string) => void;
  pickLucide: (name: string) => void;
  pickPhosphor: (name: string) => void;
  pickRecent: (value: string) => void;
  pickColor: (hex: string) => void;
  pickRandom: () => void;
  handleClear: () => void;
}

export function buildPickerHandlers(
  deps: PickerHandlerDeps & { currentValue: string },
): PickerHandlers {
  const {
    parsed, tab, iconVariant, currentColor, colorEnabled,
    onChange, onClear, onSelect, currentValue,
  } = deps;

  const commit = (nextValue: string) => {
    if (nextValue === currentValue) {
      onSelect?.();
      return;
    }
    onChange(nextValue);
    onSelect?.();
    pushRecent(nextValue);
  };

  return {
    pickEmoji: (emoji) => commit(withColor(emoji, undefined)),
    pickLucide: (name) => commit(lucideValue(name, currentColor)),
    pickPhosphor: (name) => commit(phosphorValue(name, currentColor)),
    pickRecent: (value) => {
      const recent = parseIconValue(value);
      if (recent.kind === "empty") return;
      if (recent.color) return commit(value);
      if (recent.kind === "lucide") return commit(lucideValue(recent.name, currentColor));
      if (recent.kind === "phosphor") return commit(phosphorValue(recent.name, currentColor));
      commit(withColor(recent.emoji, undefined));
    },
    pickColor: (hex) => {
      if (!colorEnabled) return;
      if (parsed.kind === "lucide") onChange(withColor(`lucide:${parsed.name}`, hex || undefined));
      else if (parsed.kind === "phosphor") onChange(withColor(`phosphor:${parsed.name}`, hex || undefined));
    },
    pickRandom: () => {
      if (tab === "icon") {
        const names = iconVariant === "phosphor" ? ALL_PHOSPHOR : ALL_LUCIDE;
        const name = names[Math.floor(Math.random() * names.length)];
        commit(iconVariant === "phosphor" ? phosphorValue(name, currentColor) : lucideValue(name, currentColor));
      } else {
        const emoji = ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)];
        commit(withColor(emoji, undefined));
      }
    },
    handleClear: () => {
      onClear?.();
      onSelect?.();
    },
  };
}

export function getSearchPlaceholder(
  tab: TopTab,
  iconVariant: IconVariant,
  iconStyle: "twemoji" | "native",
): string {
  if (tab === "icon") {
    return iconVariant === "phosphor"
      ? "Search phosphor icons (fill)…"
      : "Search lucide icons (outline)…";
  }
  return iconStyle === "twemoji"
    ? "Search emoji (twemoji)…"
    : "Search emoji (native)…";
}

type KeyboardLike = {
  key: string;
  target: EventTarget | null;
  preventDefault: () => void;
};
type ContainerLike = HTMLElement | { current: HTMLElement | null } | null;

/** Arrow-key navigation over cells carrying `data-icon-cell-index`. */
export function handleGridArrowKey(event: KeyboardLike, containerLike: ContainerLike): void {
  if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  const target = event.target as HTMLElement | null;
  const indexText = target?.getAttribute?.("data-icon-cell-index");
  if (!indexText) return;
  const container = containerLike && "current" in containerLike ? containerLike.current : containerLike;
  const cells = container?.querySelectorAll<HTMLElement>("[data-icon-cell-index]");
  if (!cells?.length) return;
  const index = Number(indexText);
  const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 8 : -8;
  const next = Math.max(0, Math.min(cells.length - 1, index + delta));
  if (next === index) return;
  event.preventDefault();
  cells[next]?.focus();
}
