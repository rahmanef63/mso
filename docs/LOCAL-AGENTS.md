# Local Agents — native same-host session messaging

MSO 1.9 separates **local session messaging** from **remote A2A v1**.

Local Agents is the host-local transport for live MSO sessions. It does not use Agent Cards, peer registration, public URLs, A2A credentials, or the A2A JSON-RPC protocol. Remote agents still use the standard A2A v1 surface documented in [A2A.md](./A2A.md).

## UX

Open two interactive MSO Agent terminals. No setup step is required:

```text
Terminal A                    Terminal B
[agent-a]                     [agent-b]
```

A manual durable-session rename becomes the primary local identity immediately:

```text
/title zahra                  /title rahman
[zahra]                       [rahman]
```

No other terminal needs a refresh or restart. Directory reads resolve the current durable session title each time, while receive delivery stays attached through a host-local SSE stream.

Useful TUI commands:

```text
/agents
/message rahman please check the latest result
/delegate rahman review this change and report risks
/inbox
```

From the ordinary shell, the same native route has an explicit CLI group for scripting/inspection:

```text
mso agents list
mso agents send <source-session-id> rahman "please check the latest result"
mso agents inbox <session-id>
```

`/message` sends kind `message`. `/delegate` first sends a native local kind `task`; only when there is no matching local target does it fall back to a registered **remote** A2A v1 peer. `/agents` shows local live sessions and remote peers as separate groups.

Incoming terminal events are not stored as user turns. They are rendered distinctly, for example:

```text
[agent-zahra] please check the latest result
[agent-zahra] task review this change and report risks
```

The durable history row keeps role `agent`. When the next model turn needs conversation context, MSO projects that row to a provider-compatible user-role envelope such as `[LOCAL AGENT [zahra] · task] ...`; this preserves provider compatibility without pretending that the human sent the message.

## Presence lifecycle

Local Agents uses a small private lease store rather than rewriting the potentially large durable session JSON on every heartbeat.

| Status | Meaning |
|---|---|
| `ready` | Receiver registered and can accept local events while startup/session binding completes. |
| `idle` | Receiver is live and waiting/available. |
| `busy` | The session is executing a model/tool turn. New messages are stored as `queued`. |
| `offline` | The receive lease expired; this is derived, not written as a permanent state. |
| `ended` | The current receiver explicitly released that session, e.g. clean terminal exit or switching to another durable session. |

Interactive CLI sessions maintain a lightweight lease heartbeat and one SSE receive stream. There is no message polling loop. `/new` and `/resume` release the old receiver and bind the same terminal to the new durable session automatically. `/restart` keeps the exact durable session alive across process replacement and the replacement process renews its lease.

MCP conversation sessions have no persistent terminal socket, so MSO refreshes their lease around bound MCP tool calls. Messages remain durable when that client is not currently connected and can be read with `local_agent_inbox` on a later call.

Only `ready`, `idle`, and `busy` sessions appear in the normal active target list. An explicitly addressed known `offline`/`ended` target can still receive a durable queued message; the sender receives `target_offline` instead of a false delivered status.

## Identity and duplicate names

The first live unnamed session for one principal receives stable alias `agent-a`, then `agent-b`, through `agent-z`, `agent-aa`, and so on. The alias is stored with presence and does not depend on UUID display or list order.

A session title is used as its local label only when the existing rename flow marks it `manual`. Automatic conversation titles do not silently replace `[agent-a]` style identity.

If two active sessions are manually renamed to the same title, internal durable IDs remain unique and the UI adds the alias suffix as a light disambiguator:

```text
[zahra · a]
[zahra · b]
```

A duplicate bare name is rejected as ambiguous. The displayed disambiguated label, stable alias, or exact durable session ID remains addressable.

## Delivery semantics

Local messages use a private durable mailbox plus an in-process event bus for immediate wake-up. The event bus is an optimization; the mailbox is authoritative, so a server/client disconnect does not lose accepted data.

Sender-visible statuses:

| Status | Meaning |
|---|---|
| `delivered` | Persisted and handed to a live local receiver stream. It remains replayable until acknowledged. |
| `accepted` | Persisted for a live non-busy target, but no receive-stream listener was present at that instant. |
| `queued` | Persisted while the target is `busy`; an idle transition flushes the queue. |
| `target_offline` | Target is known but its receiver is offline/ended. The message remains queued for the next receiver. |
| `failed` | Reserved for a delivery/store failure; schema/target errors are returned as request errors instead of fake delivery. |

The receiver acknowledges a message only after it has appended the distinct `agent` history row and persisted the durable session. Reconnecting SSE clients replay unread mailbox entries, so an event marked delivered is not equivalent to "irreversibly consumed".

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
| `local_agents_list` | read | List automatically discovered same-principal live sessions. |
| `local_agent_message_send` | write | Send an explicit `message` or `task`; no hidden context is attached. |
| `local_agent_inbox` | read | Read this exact durable session's mailbox and optionally acknowledge returned items. |

Remote A2A tools retain their existing names (`a2a_agent_*`, `a2a_message_send`, `a2a_handoff`, etc.) and behavior.

## Host-local API

Interactive MSO uses the owner-authenticated API below. It is not a public A2A endpoint:

```text
GET  /api/v1/local-agents?session=<current-session-id>
GET  /api/v1/local-agents?inbox=1&session=<session-id>
GET  /api/v1/local-agents?stream=1&session=<session-id>     # SSE
POST /api/v1/local-agents { action: "send", ... }
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

Older `mso a2a local ...` one-shot delegation/virtual-loopback-card helpers remain for backward compatibility and protocol testing. They are **not** the transport used by `/agents`, `/message`, local `/delegate`, the Local Agents MCP tools, or live inbox delivery in MSO 1.9.

New same-host communication should use Local Agents. Public/remote interoperability should use A2A v1.
