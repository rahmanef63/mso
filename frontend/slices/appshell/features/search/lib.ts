import type { AppDescriptor } from "../../lib/types";

export type Command = {
  id: string;
  label: string;
  hint: string;
  run: () => void;
  app?: AppDescriptor;
  /** Extra match terms beyond the label (dynamic commands). */
  keywords?: string;
};

// Subsequence match (typing "cdr" hits "Code Editor"). Cheap, no fuzzy lib.
export function matches(q: string, text: string): boolean {
  if (!q) return true;
  const s = text.toLowerCase();
  let i = 0;
  for (const c of q.toLowerCase()) {
    i = s.indexOf(c, i);
    if (i === -1) return false;
    i++;
  }
  return true;
}
