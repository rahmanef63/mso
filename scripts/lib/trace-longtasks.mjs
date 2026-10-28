// Pure trace analysis: turn a raw DevTools trace into "which script owned which long
// task". No browser, no CDP, no filesystem — so it can be tested against a recorded
// trace without a running instance.
//
// Why attribution at all: "TBT is 146 ms" is a symptom. Without naming the chunk that
// owns the time, the only available fix is "rewrite everything", which is what
// docs/MSO-MIGRATION.md exists to avoid.

const CANDIDATE_NAMES = new Set(["FunctionCall", "EvaluateScript", "v8.compile"]);
const ANCESTOR_NAMES = new Set(["ParseScriptOnBackground", "v8.run", "EvaluateScript", "FunctionCall", "v8.compile"]);

export function getBasename(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : new URL(url).hostname;
  } catch {
    return String(url).split("/").pop() || String(url);
  }
}

function urlOf(event) {
  const direct = event.args?.data?.url || event.args?.url || event.args?.fileName;
  return typeof direct === "string" && direct.trim() !== "" ? direct.trim() : null;
}

export function resolveScriptUrl(candidate, allEvents) {
  const own = urlOf(candidate);
  if (own) return own;

  const ancestors = allEvents
    .filter((e) => e !== candidate && e.ts <= candidate.ts && e.ts + (e.dur || 0) >= candidate.ts + (candidate.dur || 0))
    // Nearest enclosing event first, then the tightest one.
    .sort((a, b) => b.ts - a.ts || (a.dur || 0) - (b.dur || 0));

  for (const ancestor of ancestors) {
    if (ANCESTOR_NAMES.has(ancestor.name)) {
      const url = urlOf(ancestor);
      if (url) return url;
    }
  }
  for (const ancestor of ancestors) {
    const url = urlOf(ancestor);
    if (url) return url;
  }
  return null;
}

// Renderer main thread only: a task on another thread did not block input, so charging
// it to TBT would overstate the page.
function mainThreadEvents(events) {
  const thread = events.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain");
  const process = events.find((e) => e.name === "process_name" && e.args?.name === "Renderer");
  const pid = thread?.pid ?? process?.pid;
  const tid = thread?.tid ?? pid;
  if (pid === undefined || tid === undefined) return events;
  return events.filter((e) => e.pid === pid && e.tid === tid);
}

function navigationOrigin(events) {
  const starts = events.filter((e) => e.name === "navigationStart" && e.args?.data?.isLoadingMainFrame);
  const target =
    starts.find((n) => typeof n.args?.data?.documentLoaderURL === "string" && n.args.data.documentLoaderURL.startsWith("http")) ||
    starts[starts.length - 1];
  return target ? target.ts : (events[0]?.ts ?? 0);
}

const isTask = (e) => (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask") && typeof e.dur === "number";

function outermost(tasks) {
  return tasks.filter(
    (task) =>
      !tasks.some((other) => other !== task && other.ts <= task.ts && other.ts + other.dur >= task.ts + task.dur),
  );
}

// Self time = duration minus the duration of its direct children. That is the number
// that tells you which script is expensive, as opposed to which script merely calls.
function selfTime(candidate, candidates) {
  const inside = candidates.filter(
    (child) => child !== candidate && child.ts >= candidate.ts && child.ts + child.dur <= candidate.ts + candidate.dur,
  );
  const direct = inside.filter(
    (child) => !inside.some((other) => other !== child && other.ts <= child.ts && other.ts + other.dur >= child.ts + child.dur),
  );
  return Math.max(0, candidate.dur - direct.reduce((sum, child) => sum + child.dur, 0));
}

export function attributeLongTasks(rawEvents, { minMs = 40 } = {}) {
  const events = Array.isArray(rawEvents) ? rawEvents : (rawEvents?.traceEvents ?? []);
  const main = mainThreadEvents(events);
  const originTs = navigationOrigin(events);
  const minUs = minMs * 1000;

  const tasks = outermost(main.filter(isTask))
    .filter((task) => task.dur >= minUs && (originTs === 0 || task.ts >= originTs))
    .sort((a, b) => a.ts - b.ts)
    .map((task) => {
      const candidates = main.filter(
        (e) =>
          CANDIDATE_NAMES.has(e.name) &&
          e.ph === "X" &&
          typeof e.dur === "number" &&
          e.dur > 0 &&
          e.ts >= task.ts &&
          e.ts + e.dur <= task.ts + task.dur,
      );

      const byUrl = new Map();
      for (const candidate of candidates) {
        const url = resolveScriptUrl(candidate, main);
        const selfDur = selfTime(candidate, candidates);
        const key = url || "(unattributed)";
        const entry = byUrl.get(key) ?? { url, totalSelfDur: 0, topItem: null };
        entry.totalSelfDur += selfDur;
        if (!entry.topItem || selfDur > entry.topItem.selfDur) {
          entry.topItem = { selfDur, functionName: candidate.args?.data?.functionName };
        }
        byUrl.set(key, entry);
      }

      let winner = null;
      for (const entry of byUrl.values()) if (!winner || entry.totalSelfDur > winner.totalSelfDur) winner = entry;

      const durationMs = Math.round(task.dur / 1000);
      if (!winner) return { startMs: Math.round((task.ts - originTs) / 1000), durationMs, selfMs: durationMs, scriptFrame: "(unattributed)" };

      const fnHint = winner.topItem?.functionName?.trim();
      return {
        startMs: Math.round((task.ts - originTs) / 1000),
        durationMs,
        selfMs: Math.round(winner.totalSelfDur / 1000),
        scriptFrame: winner.url ? (fnHint && fnHint !== "anonymous" ? `${getBasename(winner.url)} (${fnHint})` : getBasename(winner.url)) : "(unattributed)",
      };
    });

  const grouped = new Map();
  for (const row of tasks) {
    const entry = grouped.get(row.scriptFrame) ?? { scriptFrame: row.scriptFrame, selfMs: 0, tasks: 0 };
    entry.selfMs += row.selfMs;
    entry.tasks += 1;
    grouped.set(row.scriptFrame, entry);
  }

  return { tasks, byScript: [...grouped.values()].sort((a, b) => b.selfMs - a.selfMs || b.tasks - a.tasks) };
}

function table(headers, rows, rightAlign) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const pad = (s, w) => (rightAlign ? String(s).padStart(w) : String(s).padEnd(w));
  return [
    headers.map((h, i) => pad(h, widths[i])).join("  "),
    widths.map((w) => "-".repeat(w)).join("  "),
    ...rows.map((row) => row.map((cell, i) => pad(cell, widths[i])).join("  ")),
  ];
}

export function formatLongTasks({ tasks, byScript }, minMs) {
  if (tasks.length === 0) return `No long tasks found (>= ${minMs} ms).`;
  const lines = table(["startMs", "durationMs", "selfMs", "scriptFrame"], tasks.map((t) => [t.startMs, t.durationMs, t.selfMs, t.scriptFrame]), false);
  if (byScript.length) {
    lines.push("", "Summary by script frame (descending selfMs):");
    lines.push(...table(["scriptFrame", "selfMs", "tasks"], byScript.map((b) => [b.scriptFrame, b.selfMs, b.tasks]), true));
  }
  return lines.join("\n");
}
