"use client";

import { useCallback, useRef, useState } from "react";
import { History } from "lucide-react";
import { AppFrame, type AppProps } from "@/features/appshell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "./components/tabs";
import { usePublishInspector } from "./lib/host";
import { useAIStore } from "./lib/store";
import type { Agent, Automation, Skill } from "./lib/types";
import { AgentForm } from "./components/agent-form";
import { AgentSwitcher } from "./components/agent-switcher";
import { AutomationForm } from "./components/automation-form";
import { AutomationView } from "./components/automation-view";
import { ChatPanel, type ChatHandle } from "./components/chat-panel";
import { ThreadList } from "./components/thread-list";
import { LibraryGrid } from "./components/library-grid";
import { SkillForm } from "./components/skill-form";
import { McpActivityView } from "./components/mcp-activity-view";
import { assistantRouteFromPayload, type AssistantTab } from "./lib/navigation";

type Tab = AssistantTab;
type FormState =
  | { kind: "skill"; item?: Skill }
  | { kind: "agent"; item?: Agent }
  | { kind: "automation"; item?: Automation }
  | null;

const TABS: [Tab, string][] = [
  ["chat", "Chat"],
  ["agents", "Agents"],
  ["skills", "Skills"],
  ["automations", "Automations"],
  ["mcp", "MCP"],
];

// Alfa: tabbed assistant. Chat keeps the real Claude stream; the other tabs
// manage agents/skills/automations entirely in localStorage (no Convex).
export default function Assistant({ payload }: AppProps) {
  const store = useAIStore();
  const route = assistantRouteFromPayload(payload);
  const [selection, setSelection] = useState<{ key: string; tab: Tab }>(() => route);
  // When the host payload changes, its deep-link tab wins without a synchronizing
  // effect. Once rendered for that route, user tab clicks own the selection until
  // another payload arrives.
  const tab = selection.key === route.key ? selection.tab : route.tab;
  const setTab = useCallback((next: Tab) => setSelection({ key: route.key, tab: next }), [route.key]);
  const [form, setForm] = useState<FormState>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const chatRef = useRef<ChatHandle>(null);

  const runAutomation = useCallback(
    (auto: Automation) => {
      setTab("chat");
      const agent = store.agents.find((a) => a.id === auto.agentId);
      setTimeout(() => chatRef.current?.runSteps(auto, agent), 30);
    },
    [store.agents, setTab],
  );

  // Surface Alfa's own library state to the shell AI Inspector. Called above the
  // early return so it runs unconditionally.
  const agentName = store.activeAgent?.name ?? "—";
  usePublishInspector(
    "assistant",
    {
      subject: agentName,
      props: [
        { label: "Active agent", value: agentName },
        { label: "Agents", value: String(store.agents.length) },
        { label: "Skills", value: String(store.skills.length) },
        { label: "Automations", value: String(store.automations.length) },
      ],
      context: `Alfa assistant, agent ${agentName}`,
      suggestions: ["What can you do?", "List my skills"],
    },
    [agentName, store.agents.length, store.skills.length, store.automations.length],
  );

  if (form) {
    if (form.kind === "skill")
      return <SkillForm skill={form.item} store={store} onClose={() => setForm(null)} />;
    if (form.kind === "agent")
      return <AgentForm agent={form.item} store={store} onClose={() => setForm(null)} />;
    return <AutomationForm auto={form.item} store={store} onClose={() => setForm(null)} />;
  }

  // AppFrame gives the assistant a consistent scaffold: optional toolbar slot
  // for non-chat tabs (the chat tab embeds its own switcher row), and an
  // @container body for child reflow. `safeArea={false}` because each child
  // pane (ChatPanel composer, LibraryGrid/AutomationView padding) already
  // honors --sai-bottom — adding it again at the frame level would double-pad.
  return (
    <AppFrame
      className="bg-background"
      safeArea={false}
      toolbar={
        tab !== "chat" ? (
          <div className="flex items-center overflow-x-auto bg-card/40 px-3 py-2 [scrollbar-width:none]">
            {/* flex-1 spacer, not justify-end: end-aligned overflow in a scroll
                row is unreachable on the start side. The spacer collapses to 0
                when the tabs overflow, so they left-align and stay scrollable. */}
            <div className="flex-1" />
            <TabBar tab={tab} setTab={setTab} />
          </div>
        ) : undefined
      }
      bodyClassName={
        tab === "chat" ? "overflow-hidden" : "flex flex-col overflow-hidden"
      }
    >
      {/* ChatPanel stays MOUNTED across tab switches (hidden via CSS) so the
          live stream + messages survive — unmounting it mid-stream would wipe
          state and orphan the `for await` into a dead component. */}
      <div className={tab === "chat" ? "flex h-full min-h-0 flex-col" : "hidden"}>
        <ChatPanel
          ref={chatRef}
          agent={store.activeAgent}
          switcher={
            <>
              <Button size="sm" variant="ghost" aria-label="Chat history" className="shrink-0 [@media(pointer:coarse)]:min-h-[44px]" onClick={() => setHistoryOpen(true)}>
                <History className="size-4" />
              </Button>
              <AgentSwitcher store={store} onNew={() => setForm({ kind: "agent" })} />
              {/* Spacer instead of ml-auto: collapses when the row overflows so the
                  tab group left-aligns and all tabs stay reachable by scrolling. */}
              <div className="flex-1" />
              <div className="shrink-0">
                <TabBar tab="chat" setTab={setTab} />
              </div>
            </>
          }
        />
      </div>

      <ThreadList
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onResume={(t) => chatRef.current?.loadThread(t)}
        onNew={() => chatRef.current?.newThread()}
      />

      {tab === "agents" ? (
        <LibraryGrid
          kind="agent"
          store={store}
          onNew={() => setForm({ kind: "agent" })}
          onEdit={(it) => setForm({ kind: "agent", item: it as Agent })}
        />
      ) : tab === "skills" ? (
        <LibraryGrid
          kind="skill"
          store={store}
          onNew={() => setForm({ kind: "skill" })}
          onEdit={(it) => setForm({ kind: "skill", item: it as Skill })}
        />
      ) : tab === "automations" ? (
        <AutomationView
          store={store}
          onRun={runAutomation}
          onNew={() => setForm({ kind: "automation" })}
          onEdit={(it) => setForm({ kind: "automation", item: it })}
        />
      ) : tab === "mcp" ? (
        <McpActivityView />
      ) : null}
    </AppFrame>
  );
}

function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <Tabs>
      <TabsList className="shrink-0">
        {TABS.map(([v, l]) => (
          <TabsTrigger key={v} active={tab === v} onClick={() => setTab(v)}>
            {l}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
