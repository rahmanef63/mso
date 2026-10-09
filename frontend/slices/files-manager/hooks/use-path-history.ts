"use client";

import { useCallback, useState } from "react";

// Browser-style navigation history for the current directory: `navigate`
// pushes (truncating any forward stack), back/forward just move the cursor.
export function usePathHistory(start: string) {
  const [path, setPath] = useState(start);
  const [history, setHistory] = useState<string[]>([start]);
  const [cursor, setCursor] = useState(0);

  const replaceCurrent = useCallback((next: string) => {
    setPath(next);
    setHistory((items) => items.map((item, index) => index === cursor ? next : item));
  }, [cursor]);

  const navigate = useCallback(
    (next: string) => {
      setHistory((h) => {
        const trimmed = h.slice(0, cursor + 1);
        setCursor(trimmed.length);
        return [...trimmed, next];
      });
      setPath(next);
    },
    [cursor],
  );
  const goBack = useCallback(() => {
    if (cursor === 0) return;
    setCursor(cursor - 1);
    setPath(history[cursor - 1]);
  }, [cursor, history]);
  const goForward = useCallback(() => {
    if (cursor >= history.length - 1) return;
    setCursor(cursor + 1);
    setPath(history[cursor + 1]);
  }, [cursor, history]);

  return {
    path,
    navigate,
    replaceCurrent,
    goBack,
    goForward,
    canBack: cursor > 0,
    canForward: cursor < history.length - 1,
  };
}
