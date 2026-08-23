"use client";

import { useRef, useState } from "react";
import { Plus, SquareTerminal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TerminalSession, type TerminalSessionProps } from "./terminal-session";

type Tab = TerminalSessionProps & { id: number; title: string };
const MAX_TABS = 8;

export function TerminalTabs({ initialCommand, initialCwd }: TerminalSessionProps) {
  const nextId = useRef(2);
  const [tabs, setTabs] = useState<Tab[]>(() => [
    { id: 1, title: "Terminal 1", initialCommand, initialCwd },
  ]);
  const [active, setActive] = useState(1);

  const addTab = () => {
    if (tabs.length >= MAX_TABS) return;
    const id = nextId.current++;
    setTabs((current) => [...current, { id, title: `Terminal ${id}`, initialCwd }]);
    setActive(id);
  };

  const closeTab = (id: number) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const next = tabs.filter((tab) => tab.id !== id);
    if (next.length === 0) {
      const freshId = nextId.current++;
      setTabs([{ id: freshId, title: `Terminal ${freshId}`, initialCwd }]);
      setActive(freshId);
      return;
    }
    setTabs(next);
    if (active === id) setActive(next[Math.min(Math.max(index, 0), next.length - 1)].id);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#0d0e12]">
      <div
        role="tablist"
        aria-label="Terminal sessions"
        className="flex min-h-9 shrink-0 items-stretch overflow-x-auto border-b border-white/10 bg-[#15161b] [scrollbar-width:none] [@media(pointer:coarse)]:min-h-[44px]"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <div
              key={tab.id}
              className={cn(
                "flex min-w-[112px] max-w-[180px] shrink-0 items-center border-r border-white/10",
                selected ? "bg-[#0d0e12] text-white" : "text-[#9298a4] hover:bg-white/5",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(tab.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left text-[11px] font-medium [@media(pointer:coarse)]:min-h-[44px]"
              >
                <SquareTerminal className="size-3.5 shrink-0" />
                <span className="truncate">{tab.title}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                onClick={() => closeTab(tab.id)}
                className="grid size-7 shrink-0 place-items-center rounded hover:bg-white/10 [@media(pointer:coarse)]:size-[44px]"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          aria-label="New terminal"
          title={tabs.length >= MAX_TABS ? `Maximum ${MAX_TABS} terminals` : "New terminal"}
          onClick={addTab}
          disabled={tabs.length >= MAX_TABS}
          className="grid w-9 shrink-0 place-items-center text-[#9298a4] hover:bg-white/5 hover:text-white disabled:opacity-35 [@media(pointer:coarse)]:w-[44px]"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            aria-hidden={tab.id !== active}
            className={cn(
              "absolute inset-0 min-h-0",
              tab.id === active ? "visible" : "invisible pointer-events-none",
            )}
          >
            <TerminalSession initialCommand={tab.initialCommand} initialCwd={tab.initialCwd} />
          </div>
        ))}
      </div>
    </div>
  );
}
