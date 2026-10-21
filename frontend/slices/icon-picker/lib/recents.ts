"use client";

import { useSyncExternalStore } from "react";
import {
  getRecentIconsServerSnapshot,
  getRecentIconsSnapshot,
  subscribeRecentIcons,
} from "./recents-core";

export { clearRecents, pushRecent } from "./recents-core";

export function useRecentIcons(): readonly string[] {
  return useSyncExternalStore(
    subscribeRecentIcons,
    getRecentIconsSnapshot,
    getRecentIconsServerSnapshot,
  );
}
