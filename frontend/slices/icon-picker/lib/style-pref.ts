"use client";

import { useSyncExternalStore } from "react";
import {
  getIconStyleServerSnapshot,
  getIconStyleSnapshot,
  setIconStyle,
  subscribeIconStyle,
  type Style,
} from "./style-core";

export { readIconStyle, setIconStyle, type Style } from "./style-core";

/** Server snapshot is the default, so hydration never mismatches; the client
 *  snapshot takes over immediately after. No mount flag needed. */
export function useIconStyle(): [Style, (next: Style) => void] {
  const style = useSyncExternalStore(
    subscribeIconStyle,
    getIconStyleSnapshot,
    getIconStyleServerSnapshot,
  );
  return [style, setIconStyle];
}
