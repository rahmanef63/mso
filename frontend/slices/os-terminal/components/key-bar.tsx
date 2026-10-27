"use client";
// audit-allow-hex: same terminal glass palette as the exec emulator.

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Touch key bar for the live PTY. Soft keyboards have no Esc/Tab/Ctrl/arrows,
// so interactive programs (vim, less, shell history) are unusable on phone.
// Visible for coarse pointers or compact (@max-md container) panes; hidden on
// wide fine-pointer desktops.
//
// Sticky modifiers: tapping Ctrl/Alt arms it (aria-pressed + accent fill). The
// armed modifier applies to the NEXT key-bar press AND — via `interceptRef`,
// consulted by pty-terminal inside xterm's onData — to the next single
// printable character typed on the soft keyboard, then disarms. Ctrl maps
// letters to charCode & 0x1f; Alt prefixes ESC.

export type KeyInterceptor = (data: string) => string;

type KeyDef = { label: string; aria: string; seq: string };

const PRE: KeyDef[] = [
  { label: "Esc", aria: "Escape", seq: "\x1b" },
  { label: "Tab", aria: "Tab", seq: "\t" },
];
const NAV: KeyDef[] = [
  { label: "↑", aria: "Arrow up", seq: "\x1b[A" },
  { label: "↓", aria: "Arrow down", seq: "\x1b[B" },
  { label: "←", aria: "Arrow left", seq: "\x1b[D" },
  { label: "→", aria: "Arrow right", seq: "\x1b[C" },
  { label: "Home", aria: "Home", seq: "\x1b[H" },
  { label: "End", aria: "End", seq: "\x1b[F" },
  { label: "PgUp", aria: "Page up", seq: "\x1b[5~" },
  { label: "PgDn", aria: "Page down", seq: "\x1b[6~" },
];
const CHORDS: KeyDef[] = [
  { label: "^C", aria: "Control C: interrupt", seq: "\x03" },
  { label: "^D", aria: "Control D: end of input", seq: "\x04" },
  { label: "^L", aria: "Control L: clear screen", seq: "\x0c" },
  { label: "^Z", aria: "Control Z: suspend", seq: "\x1a" },
];
const CHARS: KeyDef[] = [
  { label: "|", aria: "Pipe", seq: "|" },
  { label: "~", aria: "Tilde", seq: "~" },
  { label: "/", aria: "Slash", seq: "/" },
  { label: "-", aria: "Dash", seq: "-" },
];

const BTN =
  "h-9 min-w-9 shrink-0 select-none rounded-md bg-white/10 px-2 font-mono text-xs " +
  "leading-none text-[#dfe3ea] transition-colors hover:bg-white/20 active:bg-white/25 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]";

// Apply armed modifiers to one printable char. Ctrl only maps letters (the
// classic & 0x1f trick); Alt is the ESC prefix (meta) and applies to any char.
function applyMods(ch: string, ctrl: boolean, alt: boolean): string {
  let out = ch;
  if (ctrl && /^[a-z]$/i.test(out))
    out = String.fromCharCode(out.toUpperCase().charCodeAt(0) & 0x1f);
  return alt ? `\x1b${out}` : out;
}

const isPrintable = (d: string) => d.length === 1 && d >= " " && d !== "\x7f";

export default function KeyBar({
  sendInput,
  interceptRef,
}: {
  sendInput: (data: string) => void;
  /** pty-terminal pipes xterm onData through this so armed Ctrl/Alt also catch soft-keyboard chars. */
  interceptRef?: React.RefObject<KeyInterceptor | null>;
}) {
  const [ctrl, setCtrl] = useState(false);
  const [alt, setAlt] = useState(false);
  const mods = useRef({ ctrl, alt });
  useEffect(() => {
    mods.current = { ctrl, alt };
  }, [ctrl, alt]);

  useEffect(() => {
    if (!interceptRef) return;
    interceptRef.current = (data) => {
      const m = mods.current;
      if ((!m.ctrl && !m.alt) || !isPrintable(data)) return data;
      setCtrl(false);
      setAlt(false);
      return applyMods(data, m.ctrl, m.alt);
    };
    const ref = interceptRef;
    return () => {
      ref.current = null;
    };
  }, [interceptRef]);

  const press = (seq: string) => {
    sendInput(ctrl || alt ? applyMods(seq, ctrl && isPrintable(seq), alt && isPrintable(seq)) : seq);
    if (ctrl) setCtrl(false);
    if (alt) setAlt(false);
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) sendInput(text);
    } catch {
      /* clipboard permission denied / unavailable — stay silent */
    }
  };

  // preventDefault on pointer/mouse down keeps focus on xterm (soft keyboard
  // stays up); click still fires, so handlers go on onClick.
  const noSteal = (e: { preventDefault(): void }) => e.preventDefault();

  const key = (k: KeyDef) => (
    <button
      key={k.label}
      type="button"
      aria-label={k.aria}
      title={k.aria}
      onPointerDown={noSteal}
      onMouseDown={noSteal}
      onClick={() => press(k.seq)}
      className={BTN}
    >
      {k.label}
    </button>
  );

  const mod = (label: string, armed: boolean, toggle: () => void) => (
    <button
      type="button"
      aria-label={`${label} (sticky: applies to the next key)`}
      aria-pressed={armed}
      onPointerDown={noSteal}
      onMouseDown={noSteal}
      onClick={toggle}
      className={cn(BTN, armed && "bg-[#5be0c8] text-[#0d0e12] hover:bg-[#5be0c8]")}
    >
      {label}
    </button>
  );

  const sep = (k: string) => <span key={k} aria-hidden className="mx-0.5 h-5 w-px shrink-0 self-center bg-white/10" />;

  return (
    <div
      role="toolbar"
      aria-label="Terminal keys"
      className="hidden shrink-0 items-center gap-1 overflow-x-auto border-t border-white/10 px-1.5 py-1.5 [scrollbar-width:none] @max-md:flex [@media(pointer:coarse)]:flex"
    >
      {PRE.map(key)}
      {mod("Ctrl", ctrl, () => setCtrl((v) => !v))}
      {mod("Alt", alt, () => setAlt((v) => !v))}
      {sep("s1")}
      {NAV.map(key)}
      {sep("s2")}
      {CHORDS.map(key)}
      {sep("s3")}
      {CHARS.map(key)}
      {sep("s4")}
      <button
        type="button"
        aria-label="Paste from clipboard"
        title="Paste from clipboard"
        onPointerDown={noSteal}
        onMouseDown={noSteal}
        onClick={() => void paste()}
        className={BTN}
      >
        Paste
      </button>
    </div>
  );
}
