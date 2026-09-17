"use client";

import { useEffect, useState } from "react";
import { createIntentPrefetch } from "../lib/intent-prefetch";

/** One pending intent per surface; cancel on close, pointer leave, blur or unmount. */
export function useIntentPrefetch(enabled = true) {
  const [prefetch] = useState(() => createIntentPrefetch());
  useEffect(() => {
    if (!enabled) prefetch.cancel();
    return prefetch.cancel;
  }, [enabled, prefetch]);
  return prefetch;
}
