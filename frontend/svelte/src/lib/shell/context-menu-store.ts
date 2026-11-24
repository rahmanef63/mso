export type ContextMenuItem =
  | { type: "sep" }
  | {
      type?: "item";
      id: string;
      label: string;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      onSelect: () => void;
    };

export type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  title?: string;
  items: ContextMenuItem[];
};

const EDGE_PAD = 8;

const CLOSED_STATE: ContextMenuState = {
  open: false,
  x: 0,
  y: 0,
  items: [],
};

export function clampMenuPosition(
  x: number,
  y: number,
  menuW: number,
  menuH: number,
  vw: number,
  vh: number,
): { x: number; y: number } {
  const safeX = Number.isFinite(x) ? x : EDGE_PAD;
  const safeY = Number.isFinite(y) ? y : EDGE_PAD;
  const safeW = Number.isFinite(menuW) && menuW > 0 ? menuW : 0;
  const safeH = Number.isFinite(menuH) && menuH > 0 ? menuH : 0;
  const safeVw = Number.isFinite(vw) && vw > 0 ? vw : safeW + EDGE_PAD * 2;
  const safeVh = Number.isFinite(vh) && vh > 0 ? vh : safeH + EDGE_PAD * 2;

  const maxX = Math.max(EDGE_PAD, safeVw - safeW - EDGE_PAD);
  const maxY = Math.max(EDGE_PAD, safeVh - safeH - EDGE_PAD);

  return {
    x: Math.round(Math.max(EDGE_PAD, Math.min(safeX, maxX))),
    y: Math.round(Math.max(EDGE_PAD, Math.min(safeY, maxY))),
  };
}

export function createContextMenuStore() {
  let state: ContextMenuState = CLOSED_STATE;
  const listeners = new Set<(next: ContextMenuState) => void>();
  const emit = () => {
    for (const fn of listeners) fn(state);
  };

  function open(x: number, y: number, items: ContextMenuItem[], title?: string) {
    if (!Array.isArray(items) || items.length === 0) {
      close();
      return;
    }
    state = {
      open: true,
      x: Number.isFinite(x) ? x : EDGE_PAD,
      y: Number.isFinite(y) ? y : EDGE_PAD,
      ...(title ? { title } : {}),
      items: [...items],
    };
    emit();
  }

  function close() {
    if (!state.open) return;
    state = CLOSED_STATE;
    emit();
  }

  return {
    open,
    close,
    getState: () => state,
    subscribe(listener: (next: ContextMenuState) => void) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
