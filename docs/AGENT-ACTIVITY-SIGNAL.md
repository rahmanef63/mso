# Agent Session Activity Signal Investigation

Investigation into deriving a live session activity signal (`working`, `idle`, `waiting`) from existing MSO session records.

## Decision: Case B (Cannot Be Distinguished Without Server Changes)

A live session activity signal cannot be derived reliably from existing MSO session records or APIs. Deriving `working` from `updatedAt` is not merely a weak heuristic; it is actively misleading for long turns.

## Evidence and Audited Code Paths

### 1. Session Row Fields in List Handler
- **Location:** `app/api/v1/agent-sessions/handler-get.ts:87` calls `ownerSessionSummaries(limit)`.
- **Mapping:** `lib/agent/session-record.ts:10-38` transforms records via `summary(record)` into `AgentSessionSummary` (`lib/agent/session-types.ts:80-102`).
- **Fields returned:** `id`, `source`, `name`, `label`, `title`, `titleSource`, `createdAt`, `updatedAt`, `resumedFrom`, `cwd`, `parentSessionId`, `estimatedTokens`, `lifetimeEstimatedTokens`, `compactThresholdTokens`, `compactionCount`, `archiveCount`, `lastCompactedAt`, `lastArchivedAt`, `eventCount`, `historyTurns`, `artifacts`.
- **Finding:** No `status`, `presence`, `state`, or turn-in-progress indicator exists on the session row.

### 2. CLI-Side Session State Heuristic
- **Location:** `scripts/mso-agent-session-list.mjs:14-51` (`stateOf`).
- **Behavior:** Checks for explicit `row.status` (`working`, `busy`, `running`, `waiting`, `idle`), falling back to `diff = now - updatedAt <= ACTIVITY_THRESHOLD_MS (60_000)` to guess `working` vs `idle`.
- **Finding:** `GET /api/v1/agent-sessions` (`scripts/mso-agent-api.mjs:100`) never populates `row.status`. Every row falls through to the timestamp comparison.

### 3. Existing Runtime Signals
- **Subagent jobs:** `lib/agent/subagent-jobs.ts:12-22` and `scripts/mso-agent-jobs.mjs:35-53` track background jobs in a volatile process Map (`const jobs = new Map<string, SubagentJob>()`), scoped to capability tool invocations (`subagent_job_list`), not interactive sessions.
- **Lock files:** Ephemeral file locks (`lib/agent/session-mutations.ts:25`, `withSecurityStoreLock`) exist only during atomic disk writes, lasting milliseconds. No persistent lock indicates an active turn.
- **Turn progress:** Neither token stream chunks nor tool executions emit observable disk writes, turn counters, or inter-process IPC signals for the session.

### 4. Turn Persistence Path
- **Persistence driver:** `scripts/mso-agent-session-ui.mjs:15` (`persistSession`) saves the session via `saveCliSession` (`POST /api/v1/agent-sessions`).
- **Timestamp mutation:** `lib/agent/session-mutations.ts:47` (and `lib/agent/session-store.ts:133`) sets `record.updatedAt = new Date().toISOString()` when the record is saved.
- **Invocation timing:** In `scripts/mso-agent-turn.mjs:198`, `await persistSession(session)` is called only after `agentRound` completely finishes. Line 207 calls it in the catch block on failure.
- **Finding:** `persistSession` is called strictly at turn completion, never per streamed chunk or during tool execution.

## Why updatedAt Inverts the Real State

Because `updatedAt` records when the last completed turn was written:
1. **False Idle:** While a turn is actively executing (for example, LLM generation streaming for 90 seconds or a long-running tool command), `updatedAt` remains the completion timestamp of the previous turn. A caller inspecting `updatedAt` perceives an active session as idle.
2. **False Working:** Immediately after a turn finishes, `updatedAt` is brand new (`now - updatedAt < 1s`). The agent is completely idle waiting for user input, yet the timestamp heuristic marks it as `working` for the entire 60-second threshold.

## Minimal Server Change to Enable Case A

To make a truthful activity signal possible without guessing:

1. **Schema additions (`lib/agent/session-types.ts`):**
   - Add optional field `turnActive?: boolean` (or `turnStartedAt?: string | null`) to both `AgentSession` and `AgentSessionSummary`.
2. **Turn lifecycle markers (`scripts/mso-agent-turn.mjs` and `app/api/v1/agent-sessions`):**
   - At turn start (inside `runInteractiveRound`, before `agentRound`), send a lightweight action (e.g. `action: "turn-start", id: session.id`) or update `turnStartedAt = new Date().toISOString()`.
   - At turn end (inside the `finally` block of `runInteractiveRound`), clear the marker (`turnStartedAt = null`).
3. **List handler exposure (`lib/agent/session-record.ts:summary`):**
   - Include `turnActive: Boolean(record.turnStartedAt)` in `AgentSessionSummary` so `GET /api/v1/agent-sessions` returns the live state directly in the session list.
