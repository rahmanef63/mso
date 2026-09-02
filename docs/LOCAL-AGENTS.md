# Local Agents — native same-host session messaging

Since MSO 1.11, **local session messaging** is separate from **remote A2A v1**, with explicit request/reply correlation and mention routing; MSO 1.12 keeps that transport contract and gives Local Agent traffic its own terminal section.

Local Agents is the host-local transport for live MSO sessions. It does not use Agent Cards, peer registration, public URLs, A2A credentials, or the A2A JSON-RPC protocol. Remote agents still use the standard A2A v1 surface documented in [A2A.md](./A2A.md).

## UX

Every durable session has two distinct human-facing fields:

- `name` — a short unique handle such as `milo`, `luna`, or `nara`; this is what `@mention` uses;
- `title` — a longer auto/manual description of what the session is about.

Fresh sessions receive a familiar short name automatically. Open two terminals and they may look like:

```text
Terminal A                    Terminal B
[milo]                        [luna]

Title: Debug auth             Title: Review API
```

Rename the short handle independently from the description:

```text
/rename zahra                 /rename rahman
/title frontend debugging     /title security review
```

`/rename` is immediately durable and does not change the session id/title. `/title` remains the description/topic lifecycle and does not change the `@name`. Names are unique per principal.

Useful TUI commands:

```text
/agents
@rahman please check the latest result and tell me your answer
/message rahman FYI: deploy finished
/delegate rahman review this change and report risks
/inbox
```

In MSO 1.12 terminal output, inbound/outbound peer traffic is rendered under a full-width `Local agent` divider. The bottom composer remains a separate `Input · @name` area, so an async peer event can redraw above an in-progress draft without becoming a user turn or obscuring the current session identity.

A leading `@rahman …` resolves **active agents only**, where active means both a current presence lease and `consumerConnected=true`. If `rahman` is offline/ended or its receiver has disconnected while the lease is still in its grace window, the mention fails clearly and does not silently queue a new request. This prevents a typo/stale handle from becoming a delayed surprise response. The lower-level `local_agent_message_send`/`mso agents send` compatibility surface may still explicitly address a known offline session and retain durable queued delivery.

From the ordinary shell, the same native route has an explicit CLI group for scripting/inspection:

```text
mso agents list
mso agents send <source-session-id> rahman "please check the latest result"
mso agents inbox <session-id>
```

`@rahman …` is an explicit correlated `request` with `requiresUserRelay=true`. The client acknowledges dispatch immediately; it does **not** start an idle target in the background. When that target later performs an explicit turn and answers with `local_agent_reply`, the exact correlated reply is relayed to the originating user-facing conversation without another user prompt or model call. `/message` remains backward-compatible notify-only messaging. `/delegate` creates a correlated local task; only when there is no matching active local name does it fall back to a registered **remote** A2A v1 peer. `/agents` shows local live sessions and remote peers separately.

Incoming peer data is never stored as a human user turn. Notify-only and request events remain visually distinct:

```text
[rahman] FYI: deploy finished
[rahman] task review this change and report risks
```

A correlated reply that matches an outstanding source request renders user-facing immediately:

```text
[rahman] → user Review looks safe; one migration needs a backup.
```

MSO persists both the raw role `agent` row and, only for a valid user-relay correlation, a synthetic `assistant` relay row. No model call rewrites the peer answer. For later model context, raw peer rows are projected as `[LOCAL_AGENT_DATA …]` so their text is explicitly treated as peer data rather than higher-authority user instructions.

### Which local delegation path to use

| Goal | Primitive | Behavior |
|---|---|---|
| Talk to another **currently active** Agent session | `@name …` / correlated mailbox request | Immediate acknowledgement, durable queue, target processes only on its own explicit turn, async reply relays by correlation. |
| Send passive information | `/message` / `local_agent_message_send` | Notify-only by default; no synthetic assistant reply. Explicit low-level callers may queue to known offline sessions. |
| Need a result now from another durable session context | `local_agent_request` | `exec`-gated fresh bounded worker using that saved session context. It does **not** wake/control the original terminal or ChatGPT conversation. |
| Observe one mailbox request without polling forever | `local_agent_request_wait` | Foreground bounded wait/status check (0–30s): `replied`, `target_offline`, `consumer_absent`, or `timeout`. Never resends or starts a background worker. |

## Request/reply correlation

Mailbox messages carry schema-validated metadata instead of relying on text parsing:

- `intent`: `notify | request | reply`; legacy rows normalize to `notify`;
- `correlationId`: generated for requests (`localcorr_<uuid>`);
- `replyToMessageId`: required for replies and points to one exact `localmsg_<uuid>` request;
- `requiresUserRelay`: opt-in source policy. Mentions and local `/delegate` set it; ordinary `/message` does not.

The source session persists a `local_request` ledger row containing the request message ID and correlation ID. An async reply is auto-relayed only when both IDs exactly match that outstanding request and `requiresUserRelay` is true. Stale/mismatched replies remain ordinary peer events; duplicate message IDs are deduped before render.

## Presence lifecycle

Local Agents uses a small private lease store rather than rewriting the potentially large durable session JSON on every heartbeat.

| Status | Meaning |
|---|---|
| `ready` | Receiver registered and can accept local events while startup/session binding completes. |
| `idle` | Receiver is live and waiting/available. |
| `busy` | The session is executing a model/tool turn. New messages are stored as `queued`. |
| `offline` | The receive lease expired; this is derived, not written as a permanent state. |
| `ended` | The current receiver explicitly released that session, e.g. clean terminal exit or switching to another durable session. |

Interactive CLI sessions maintain a lightweight lease heartbeat and one SSE receive stream. There is no message polling loop. **Presence and consumption are separate signals:** `idle` means the lease is current; it does not by itself prove that an SSE receiver is subscribed. Directory rows therefore also expose `consumerConnected` and `consumerCount`. `/new` and `/resume` release the old receiver and bind the same terminal to the new durable session automatically. `/restart` keeps the exact durable session alive across process replacement and the replacement process renews its lease.

MCP conversation sessions have no persistent terminal socket, so MSO refreshes their lease around bound MCP tool calls. Messages remain durable when that client is not currently connected and can be read with `local_agent_inbox` on a later call.

Only `ready`, `idle`, and `busy` sessions appear in the normal lease-active target list. `@mention` is stricter: it resolves only those rows that also have `consumerConnected=true`. An explicit lower-level send to a known `offline`/`ended` target can still retain a durable queued message; the sender receives `target_offline` instead of a false delivered status.

## Session names, titles and legacy aliases

A session's public `name` is deliberately separate from its title. New sessions allocate a familiar, easy-to-type name from a bounded pool (`milo`, `luna`, `nara`, etc.) and serialize only the name-allocation boundary per principal so parallel session creation cannot create duplicate handles.

Names normalize to `^[a-z][a-z0-9-]{1,23}$`, are unique for the same principal, and are changed with `/rename <name>`. Duplicate names are rejected instead of decorated or guessed. The durable session id never changes.

Older persisted sessions that predate the `name` field are read compatibly and receive a deterministic stable fallback such as `luna-a3f2`; they do not need a destructive migration. The old presence alias (`agent-a`, `agent-b`, …) remains internal/backward-compatible for explicit API/CLI targeting, but new human `@mention` UX intentionally resolves only the public session name.

The longer `title` remains the human description/topic, may still auto-title from the first prompt, and can be changed independently with `/title <text>`. It is not an `@mention` identity.

## Delivery semantics

Local messages use a private durable mailbox plus an in-process event bus for immediate wake-up. The event bus is an optimization; the mailbox is authoritative, so a server/client disconnect does not lose accepted data.

Sender-visible statuses:

| Status | Meaning |
|---|---|
| `delivered` | Persisted and handed to a live local receiver stream. It remains replayable until acknowledged. |
| `accepted` | Persisted for a live non-busy lease, but no receive-stream listener was present at that instant. Inspect `consumerConnected=false`; the durable inbox is authoritative. |
| `queued` | Persisted while the target is `busy`; an idle transition flushes the queue. |
| `target_offline` | Target is known but its receiver is offline/ended. The message remains queued for the next receiver. |
| `failed` | Reserved for a delivery/store failure; schema/target errors are returned as request errors instead of fake delivery. |

Transport delivery and processing are separate. A `request` may be marked `delivered` after SSE handoff but remains unread until the target explicitly acknowledges it or sends `local_agent_reply`; successfully replying marks the original request read. `notify` and `reply` events may auto-ack after durable render. Reconnecting SSE clients dedupe by message ID, so at-least-once transport cannot create duplicate user relays.

## Security and isolation

Local messaging is scoped to the exact durable-session principal. A sender can resolve, list, send to, and read inboxes only inside that same principal hash.

For example:

- CLI terminals using the same approved CLI device principal can communicate.
- MCP conversations belonging to the same MCP client principal can communicate.
- another MCP client/device/A2A inbound principal cannot discover or address those sessions through Local Agents.

A message contains only the explicit `message` string plus minimal routing metadata (`senderSessionId`, target ID, labels, kind, timestamps). MSO does **not** copy hidden transcript history, memory snapshots, credentials, authorization headers, tool arguments, file contents, or workflow state into a local message.

Payloads are limited to **16 KiB**, known secret-shaped values are redacted before persistence, terminal control bytes are stripped, and both private stores use owner-only `0700/0600`, no-follow reads, bounded size, security-store locking, and atomic replacement.

Receiving a local message grants no capability. The next model turn still has exactly the session's normal tool catalog, deployment scope, and `ask` / `auto-write` / `yolo` approval behavior.

## MCP tools

Local messaging has explicit tools so it cannot be confused with public A2A peers:

| Tool | Scope | Purpose |
|---|---|---|
| `local_agents_list` | read | List same-principal sessions, including short public names plus lease status and `consumerConnected` / `consumerCount`; optionally include offline/ended targets. |
| `local_agent_message_send` | write | Backward-compatible explicit send. Default `intent=notify`; can create a durable request and may explicitly queue to known offline targets. |
| `local_agent_reply` | write | Reply to one exact request message ID; target, correlation ID, and relay policy are inherited. |
| `local_agent_request_wait` | read | Bounded 0–30s foreground wait/status for one exact sent request; returns replied/offline/no-consumer/timeout without resend. |
| `local_agent_inbox` | read | Read this exact durable session's mailbox with explicit intent/correlation metadata. |
| `local_agent_request` | exec | Run a fresh bounded worker from another same-owner durable session context and return the result even when its terminal receiver is offline; never claims to wake/control that original process. |

Remote A2A tools retain their existing names (`a2a_agent_*`, `a2a_message_send`, `a2a_handoff`, etc.) and behavior.

## Host-local API

Interactive MSO uses the owner-authenticated API below. It is not a public A2A endpoint:

```text
GET  /api/v1/local-agents?session=<current-session-id>
GET  /api/v1/local-agents?inbox=1&session=<session-id>
GET  /api/v1/local-agents?stream=1&session=<session-id>     # SSE
POST /api/v1/local-agents { action: "send", intent: "notify"|"request", ... }
POST /api/v1/local-agents { action: "reply", replyToMessageId: "localmsg_...", ... }
POST /api/v1/local-agents { action: "ack", ... }
POST /api/v1/local-agents { action: "presence", ... }      # client lifecycle
POST /api/v1/local-agents { action: "end", ... }           # client lifecycle
```

The normal owner UI/CLI should use TUI commands or MCP tools rather than manually managing presence. Presence and stream operations exist for the MSO client runtime, not as user setup steps.

## Storage

Defaults:

```text
OS_LOCAL_AGENT_PRESENCE_STORE=~/.mso/private/local-agent-presence.json
OS_LOCAL_AGENT_MESSAGE_STORE=~/.mso/private/local-agent-messages.json
OS_LOCAL_AGENT_LEASE_MS=60000
```

No external broker, database, daemon, or framework is required.

## Relationship to legacy same-host A2A helpers

Older `mso a2a local ...` one-shot delegation/virtual-loopback-card helpers remain for backward compatibility and protocol testing. They are **not** the transport used by `/agents`, `/message`, local `/delegate`, the Local Agents MCP tools, or live inbox delivery in MSO 1.11+ / current MSO.

New same-host communication should use Local Agents. Public/remote interoperability should use A2A v1.
