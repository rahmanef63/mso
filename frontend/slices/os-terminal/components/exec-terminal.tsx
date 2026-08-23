"use client";
// audit-allow-hex: terminal glass chrome palette is the slice's design, not themable tokens.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useOsApi, usePublishInspector } from "../lib/host";
import { run, seedFs, NEOFETCH, type Line } from "../lib/commands";

// React-DOM shell emulator (re-authored toward mock-os parity). Maintains a cwd
// + in-memory FS; `ls`/`cat` read live OsApi data and fall back to the model.
// Glass aesthetic: monospace, colored `root@mso:/path$` prompt, red errors,
// arrow-key history. Command logic lives in ./lib/commands to keep this < 200 LOC.
export default function ExecTerminal({ initialCwd }: { initialCwd?: string } = {}) {
  const api = useOsApi();
  const apiRef = useRef(api);
  const fs = useMemo(() => seedFs(), []);

  const [lines, setLines] = useState<Line[]>([
    { t: "sys", v: 'mso shell · type "help" for commands' },
  ]);
  // Live starts at home (~); mock keeps its "/" sandbox root. A live shell at
  // "/" lists outside the host read roots and every `ls` fails — that read as
  // "terminal not working" when the mode was actually fine.
  const [cwd, setCwd] = useState(api.mode === "live" ? (initialCwd ?? "~") : "/");
  const cwdRef = useRef(cwd);
  const modeRef = useRef(api.mode);
  // Latest-ref mirrors for event handlers (post-render, per react-hooks/refs).
  useEffect(() => {
    apiRef.current = api;
    cwdRef.current = cwd;
  });
  // Mode can flip at runtime (Settings → Server) while the terminal is open —
  // reset cwd to the right root and announce it so live actually engages.
  useEffect(() => {
    if (modeRef.current === api.mode) return;
    modeRef.current = api.mode;
    setCwd(api.mode === "live" ? (initialCwd ?? "~") : "/");
    setLines((l) => [
      ...l,
      {
        t: "sys",
        v: api.mode === "live" ? "● switched to LIVE — real shell on this host" : "○ switched to MOCK — demo data",
      },
    ]);
  }, [api.mode, initialCwd]);
  const [input, setInput] = useState("");
  const [hist, setHist] = useState<string[]>([]);
  const [hp, setHp] = useState(-1);

  const bodyRef = useRef<HTMLDivElement>(null);
  const inRef = useRef<HTMLInputElement>(null);

  // Surface live shell state + a Clear action to the shell AI Inspector.
  usePublishInspector(
    "os-terminal",
    {
      subject: cwd,
      props: [
        { label: "Working dir", value: cwd },
        { label: "Commands run", value: String(hist.length) },
        { label: "Mode", value: api.mode },
      ],
      actions: [{ id: "clear", label: "Clear", run: () => setLines([]) }],
      context: `Terminal at ${cwd}, ${api.mode} mode`,
      suggestions: ["What can I run here?", "Explain the last output", "Check disk space"],
    },
    [cwd, hist.length, api.mode],
  );

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const submit = async () => {
    const cmd = input;
    setLines((l) => [...l, { t: "cmd", v: cmd, cwd: cwdRef.current }]);
    setInput("");
    if (cmd.trim()) setHist((h) => [cmd, ...h]);
    setHp(-1);
    const out = await run(cmd, {
      fs,
      cwd: cwdRef.current,
      setCwd,
      api: apiRef.current,
      clear: () => setLines([]),
    });
    if (out.length) setLines((l) => [...l, ...out]);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void submit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const n = Math.min(hist.length - 1, hp + 1);
      if (hist[n] != null) {
        setHp(n);
        setInput(hist[n]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const n = hp - 1;
      if (n < 0) {
        setHp(-1);
        setInput("");
      } else {
        setHp(n);
        setInput(hist[n]);
      }
    }
  };

  return (
    <div
      ref={bodyRef}
      onClick={() => inRef.current?.focus()}
      className="h-full w-full overflow-y-auto bg-[#0d0e12] p-3.5 [padding-bottom:calc(0.875rem+var(--sai-bottom))] font-mono text-[12.5px] leading-relaxed text-[#dfe3ea] [font-family:var(--font-mono-ui)] select-text"
    >
      {/* Always-accurate mode banner. The greeting line looks identical in mock
          and live, so without this the user can't tell live actually engaged. */}
      <div
        className="mb-2 select-none rounded px-2 py-1 text-[11px] font-semibold"
        style={
          api.mode === "live"
            ? { color: "#0d0e12", background: "#5be0c8" }
            : { color: "#0d0e12", background: "#f5c451" }
        }
      >
        {api.mode === "live"
          ? "● LIVE — commands run on this host"
          : "○ MOCK — Settings → Server → This VPS to run real commands"}
      </div>
      {lines.map((l, i) => {
        if (l.t === "fetch") return <Neofetch key={i} rows={l.rows} />;
        if (l.t === "cmd")
          return (
            <div key={i} className="whitespace-pre-wrap">
              <Prompt cwd={l.cwd ?? "/"} />
              {l.v}
            </div>
          );
        return (
          <div
            key={i}
            className="whitespace-pre-wrap"
            style={{ color: l.t === "err" ? "#ff7a7a" : l.t === "sys" ? "#7a8aff" : "#cfd4de" }}
          >
            {l.v}
          </div>
        );
      })}
      <div className="flex whitespace-pre">
        <Prompt cwd={cwd} />
        <input
          ref={inRef}
          autoFocus
          spellCheck={false}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          className="flex-1 border-none bg-transparent font-[inherit] text-[length:inherit] text-white outline-none"
        />
      </div>
    </div>
  );
}

function Prompt({ cwd }: { cwd: string }) {
  return (
    <span style={{ color: "#5be0c8" }}>
      root@mso<span style={{ color: "#7a8aff" }}>:{cwd}</span>${" "}
    </span>
  );
}

// Live stats rows come on the line itself; the mock NEOFETCH rows are the
// demo-mode fallback.
function Neofetch({ rows }: { rows?: [string, string][] }) {
  return (
    <div className="my-1.5 flex gap-[18px]">
      <div className="font-bold leading-tight" style={{ color: "#5be0c8" }}>
        {NEOFETCH.logo}
      </div>
      <div className="leading-relaxed">
        <div style={{ color: "#7a8aff" }}>root@mso</div>
        {(rows ?? NEOFETCH.rows).map(([k, v]) => (
          <div key={k}>
            <span style={{ color: "#5be0c8" }}>{k.padEnd(8, "-")}</span> {v}
          </div>
        ))}
      </div>
    </div>
  );
}
