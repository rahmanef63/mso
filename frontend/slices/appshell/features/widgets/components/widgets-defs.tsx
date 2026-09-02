"use client";

import { useEffect, useState } from "react";
import { Clock as ClockIcon, Cpu, HardDrive, Link2, MemoryStick, Network, StickyNote, Timer } from "lucide-react";
import { QuicklinkIcon } from "../../../components/quicklink-icon";
import { useQuickLinks, useSystemStats } from "../../../registry/capabilities";
import { Bar, Card, Row, Sparkline, gb } from "./widget-cards";
import { CalendarWidget, TasksWidget } from "./widgets-defs-apps";
import { VPS_WIDGETS } from "./widgets-defs-vps";

const NOTES_KEY = "mso:widget:notes";

// Inlined (appshell is brand-free — can't import @/lib/os-api/format).
function fmtUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

// Individual desktop-widget render components, keyed by id. Glanceable + non-
// interactive (the desktop stack is pointer-events-none, behind windows). Each
// reuses the shared Card/Row/Bar primitives. System widgets read the real host
// telemetry capability — the whole point of VPS-native widgets.

function CpuWidget() {
  const s = useSystemStats();
  return (
    <Card>
      <Row icon={Cpu} label="CPU" value={s ? `${s.cpu.pct}%` : "—"} sub={s ? `${s.cpu.cores} cores` : ""} />
      <Sparkline data={s?.cpuHistory ?? []} max={100} />
    </Card>
  );
}

function MemWidget() {
  const s = useSystemStats();
  return (
    <Card>
      <Row icon={MemoryStick} label="Memory" value={s ? gb(s.mem.used) : "—"} sub={s ? `of ${gb(s.mem.total)}` : ""} />
      <Bar pct={s ? (s.mem.used / s.mem.total) * 100 : 0} />
    </Card>
  );
}

function DiskWidget() {
  const s = useSystemStats();
  return (
    <Card>
      <Row icon={HardDrive} label="Storage" value={s ? gb(s.disk.used) : "—"} sub={s ? `of ${gb(s.disk.total)}` : ""} />
      <Bar pct={s ? (s.disk.used / s.disk.total) * 100 : 0} />
    </Card>
  );
}

function ClockWidget() {
  // The desktop stack renders client-only (its parent returns null on the
  // server), so ClockWidget never SSRs — a lazy-init `new Date()` is safe (no
  // hydration mismatch) and keeps the effect free of a synchronous setState.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return (
    <Card>
      <Row icon={ClockIcon} label="Clock" value={time} sub={date} />
    </Card>
  );
}

// Interactive widgets opt back into pointer events (the desktop stack is
// pointer-events-none) so they can be typed in / clicked.
function NotesWidget() {
  const [text, setText] = useState(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem(NOTES_KEY) ?? "" : "",
  );
  return (
    <Card surface="clear" className="pointer-events-auto px-1 py-2">
      <div className="mb-2 flex items-center gap-2">
        <StickyNote className="size-4 text-muted-foreground" />
        <span className="text-[12.5px] font-semibold">Notes</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            localStorage.setItem(NOTES_KEY, e.target.value);
          } catch {
            /* quota */
          }
        }}
        placeholder="Jot something…"
        className="h-24 w-full resize-none rounded-lg border border-white/10 bg-black/10 p-2 text-xs outline-none placeholder:text-muted-foreground"
      />
    </Card>
  );
}

function QuicklinksWidget() {
  const { items, open } = useQuickLinks();
  if (!items.length) return null;
  return (
    <Card className="pointer-events-auto">
      <div className="mb-2 flex items-center gap-2">
        <Link2 className="size-4 text-muted-foreground" />
        <span className="text-[12.5px] font-semibold">Quicklinks</span>
      </div>
      <div data-slot="quicklinks-widget-grid" className="grid min-w-0 max-w-full grid-cols-4 gap-2 overflow-x-clip">
        {items.slice(0, 8).map((link) => (
          <button
            key={link.id}
            type="button"
            onClick={() => open(link)}
            className="flex min-w-0 max-w-full flex-col items-center gap-1 overflow-hidden rounded-md p-1 hover:bg-white/10"
          >
            <span className="size-8">
              <QuicklinkIcon link={link} />
            </span>
            <span className="w-full max-w-[52px] truncate text-center text-[9px] font-medium">{link.title}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function UptimeWidget() {
  const s = useSystemStats();
  return (
    <Card>
      <Row icon={Timer} label="Uptime" value={s?.uptime != null ? fmtUptime(s.uptime) : "—"} sub="" />
    </Card>
  );
}

function NetworkWidget() {
  const s = useSystemStats();
  return (
    <Card>
      <Row
        icon={Network}
        label="Network"
        value={s?.net ? `↓ ${s.net.rx.toFixed(1)}` : "—"}
        sub={s?.net ? `↑ ${s.net.tx.toFixed(1)} MB/s` : ""}
      />
      <Sparkline data={s?.netHistory ?? []} />
    </Card>
  );
}

export const WIDGET_RENDER: Record<string, () => React.ReactNode> = {
  cpu: CpuWidget,
  mem: MemWidget,
  disk: DiskWidget,
  clock: ClockWidget,
  net: NetworkWidget,
  uptime: UptimeWidget,
  calendar: CalendarWidget,
  tasks: TasksWidget,
  notes: NotesWidget,
  quicklinks: QuicklinksWidget,
  ...VPS_WIDGETS,
};
