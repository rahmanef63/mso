// Terminal capability reality: the only universal alert mechanism a plain terminal possesses
// is the BEL control character (\x07). Standard terminals do not support volume control, and
// desktop notifications via escape sequences (such as OSC 777 or OSC 9) risk spitting unparsed
// escape garbage that corrupts the line-rendered TUI frame. Therefore, attention notification
// only supports "off" and "bell", with "off" as the safe default.

import process from "node:process";
import { needsAttention } from "./mso-agent-session-list.mjs";

export const BEL = "\x07";
export const ATTENTION_SETTING_KEY = "attention";
export const ATTENTION_SETTING_PATH = "attention.notifications";
export const ATTENTION_MODES = Object.freeze(["off", "bell"]);

function getSessionId(row) {
  if (!row || typeof row !== "object") return null;
  const id = row.id ?? row.agentSession?.id;
  if (id != null && String(id).length > 0) return String(id);
  const name = row.name ?? row.agentSession?.name;
  if (name != null && String(name).length > 0) return String(name);
  return null;
}

function isSessionActive(row, activeId) {
  if (activeId == null) return false;
  const id = String(row?.id ?? row?.agentSession?.id ?? "");
  const name = String(row?.name ?? row?.agentSession?.name ?? "").replace(/^@/, "").trim();
  const target = String(activeId).replace(/^@/, "").trim();
  return (id !== "" && id === String(activeId)) || (name !== "" && name === target);
}

// Pure function calculating attention transitions without performing side effects.
// Screen loop wiring can consume this pure transition evaluator directly.
export function evaluateAttention(sessions, knownAttention = new Set(), options = {}) {
  const activeId = options.activeId ?? null;
  const mode = options.mode ?? "off";
  const isSuspended = Boolean(options.isSuspended);

  const nextAttention = new Set();
  const transitions = [];

  if (Array.isArray(sessions)) {
    for (const row of sessions) {
      const id = getSessionId(row);
      if (!id) continue;
      const needs = needsAttention(row);
      if (needs) {
        nextAttention.add(id);
        const active = isSessionActive(row, activeId);
        // Hysteresis: ring at most once per attention transition per session.
        // The active session never rings because the user is already focused on it
        // (for instance, typing a prompt in that session).
        if (!active && !knownAttention.has(id)) {
          transitions.push(id);
        }
      }
    }
  }

  // Bell only rings when enabled, not suspended, and at least one background session transitioned.
  const shouldRing = mode === "bell" && !isSuspended && transitions.length > 0;

  return {
    shouldRing,
    transitions,
    nextAttention,
  };
}

// Stateful notifier tracking session transitions across repaint cycles and suspension.
export function createAttentionNotifier(options = {}) {
  const output = options.output ?? process.stdout;
  let knownAttention = new Set(options.initialAttention || []);
  let suspended = Boolean(options.isSuspended);
  let wasSuspended = suspended;
  let justResumed = false;

  const getMode = typeof options.getMode === "function"
    ? options.getMode
    : () => (options.mode ?? "off");

  const getActiveId = typeof options.getActiveId === "function"
    ? options.getActiveId
    : () => (options.activeId ?? null);

  const getIsSuspended = typeof options.isSuspended === "function"
    ? options.isSuspended
    : () => suspended;

  function suspend() {
    suspended = true;
  }

  function resume() {
    if (!suspended) return;
    suspended = false;
    // Mark justResumed so that the repaint triggered upon resuming never fires the bell.
    justResumed = true;
  }

  function notify(sessions, callOptions = {}) {
    const mode = callOptions.mode ?? getMode();
    const activeId = callOptions.activeId ?? getActiveId();
    const isSusp = callOptions.isSuspended ?? getIsSuspended();

    // Detect external resume transitions when isSuspended flips from true to false
    if (wasSuspended && !isSusp) {
      justResumed = true;
    }
    wasSuspended = isSusp;

    // Default off means zero writes to stdout: byte-for-byte nothing is emitted.
    if (mode !== "bell") {
      const { nextAttention } = evaluateAttention(sessions, knownAttention, {
        activeId,
        mode: "off",
        isSuspended: true,
      });
      knownAttention = nextAttention;
      return { shouldRing: false, transitions: [], nextAttention };
    }

    // Suppress bell while suspended or during the repaint of a suspend/resume cycle.
    const suppress = isSusp || justResumed;
    if (justResumed) {
      justResumed = false;
    }

    const result = evaluateAttention(sessions, knownAttention, {
      activeId,
      mode: suppress ? "off" : "bell",
      isSuspended: suppress,
    });

    knownAttention = result.nextAttention;

    if (result.shouldRing && output && typeof output.write === "function") {
      output.write(BEL);
    }

    return result;
  }

  function reset() {
    knownAttention.clear();
    suspended = false;
    wasSuspended = false;
    justResumed = false;
  }

  return {
    notify,
    suspend,
    resume,
    reset,
    isSuspended: () => suspended,
    getKnownAttention: () => new Set(knownAttention),
  };
}
