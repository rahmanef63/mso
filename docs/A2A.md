# A2A — Agent-to-Agent interoperability

MSO implements **A2A v1** as the agent-to-agent layer beside MCP. MCP remains the
agent-to-tools/data control plane for this host; A2A is for delegating explicit work to
another agent that publishes an A2A Agent Card.

The current MSO release is an **outbound A2A client**. It can discover a peer, register its
public Agent Card, send a message, hand off an objective, read task state, and request task
cancellation. MSO does **not** publish an unauthenticated inbound A2A endpoint in this phase.

## Security boundary

A remote agent is a separate trust domain. MSO therefore keeps the A2A boundary deliberately
narrow:

- Agent discovery follows the standard `/.well-known/agent-card.json` path.
- Only public **HTTPS** Agent Card and interface URLs are accepted.
- MSO reuses the host SSRF guard, including public-address validation, DNS re-resolution,
  connect-time IP pinning, and redirect refusal. Loopback/private/link-local/metadata targets
  are rejected.
- The local registry stores only sanitized public Agent Card metadata plus a local alias in
  `~/.mso/private/a2a-agents.json` (`0700` parent / `0600` file, atomic writes).
- Security requirements from an Agent Card are persisted only as scheme names. A card never
  supplies usable credentials.
- This phase intentionally supports anonymous peers only. If a card requires OAuth/API-key
  authentication, MSO detects that and fails closed instead of putting credentials in an A2A
  message or guessing an auth flow.
- Normal `send` transmits only the explicit message and optional A2A `contextId` / `taskId`.
- `handoff` transmits only the explicit objective and optional context supplied by the caller.
  MSO does not copy hidden transcript history, durable memory, Skills, tool state, or raw MSO
  session/workflow identifiers. Internal identifiers may be represented only by one-way opaque
  hashes in metadata.
- A2A registry writes use `write`; remote send/handoff/cancel use `exec` scope, exact-call approval,
  audit trail, and per-operation rate limits. `yolo` bypasses the human prompt only; it does not
  bypass exact-payload binding or server authorization.

## Supported A2A v1 transport surface

MSO currently supports the v1 Agent Card `supportedInterfaces` entries for:

- `JSONRPC` — `SendMessage`, `GetTask`, `CancelTask`.
- `HTTP+JSON` — `POST message:send`, `GET tasks/{id}`, `POST tasks/{id}:cancel`.

An advertised interface must use protocol version `1.x`. The selected interface's optional
`tenant` is preserved according to the binding. Responses are bounded to 1 MiB at the core
transport and model-visible MCP results are compacted further when necessary.

Not yet exposed: authenticated peer credential profiles, extended authenticated Agent Cards,
streaming/SSE, push notifications, gRPC, or an inbound MSO A2A server. These belong to the next
phase because they expand the network/auth boundary and should not be silently enabled merely
by installing the CLI.

## CLI

```bash
# inspect a public peer without persisting it
mso a2a discover https://agent.example

# register/refresh a public Agent Card under a local alias
mso a2a add https://agent.example research
mso a2a list

# explicit peer message; returns quickly by default when the peer creates a task
mso a2a send research "Find the latest implementation notes"

# read/cancel an A2A task returned by that peer
mso a2a task research <taskId>
mso a2a cancel research <taskId>

# delegate an explicit objective; optional third argument is explicit context only
mso a2a handoff research "Compare the two approaches" "Use only these acceptance criteria..."

# ask a peer to wait for completion instead of returning immediately
mso a2a send research "Do the work" --wait
mso a2a handoff research "Do the work" --wait

# forget local registry metadata (does not modify the peer)
mso a2a rm research
```

Inside interactive MSO Agent:

- `/agents` lists registered A2A peers.
- `/delegate <peer> <objective>` uses the same explicit-context handoff boundary.
- Natural prompts containing A2A/delegate/handoff intent cause the per-turn tool router to load
  the relevant A2A tools plus their discovery/status companions; A2A tools are not kept in every
  model turn by default.

## MCP tools

The provider-neutral MCP catalog exposes:

| Tool | Scope | Purpose |
|---|---|---|
| `a2a_agents_list` | read | List registered public peers |
| `a2a_agent_discover` | read | Validate/discover a public v1 Agent Card |
| `a2a_agent_register` | write | Register or refresh public Agent Card metadata |
| `a2a_agent_remove` | write | Remove local registry metadata |
| `a2a_message_send` | exec | Send one explicit A2A message |
| `a2a_task_get` | read | Read remote A2A task state/history |
| `a2a_task_cancel` | exec | Request remote task cancellation |
| `a2a_handoff` | exec | Delegate an explicit objective/context |

This is intentionally a stable generic catalog. Registering another remote agent does not add
new dynamic MCP tool names; the target is data (`alias`/id/Agent Card URL), just as project
functions remain data behind `project_function_call`.

## Next phase

The safe next expansion is a dedicated private A2A credential-profile store and explicit
per-peer auth configuration, followed by authenticated inbound MSO Agent Card/endpoint support.
Streaming and push should be added only after task ownership, callback validation, credential
rotation, and inbound rate/authorization policy are defined and tested.

Official protocol reference: <https://a2a-protocol.org/latest/>.
