# A2A — Agent-to-Agent interoperability

MSO implements **A2A v1** beside MCP. MCP remains the host tool/data control plane; A2A is the interoperability boundary for delegating an explicit task to another agent or, when the owner opts in, allowing another authenticated agent to delegate a bounded task to MSO.

The implementation has four independent pieces:

1. **Outbound discovery/registry** — discover public HTTPS Agent Cards and keep sanitized peer metadata locally.
2. **Outbound credentials + client** — attach a private API-key, Bearer, or OAuth2 access-token profile to a peer and call it over JSON-RPC or HTTP+JSON.
3. **Streaming** — use A2A v1 `SendStreamingMessage` / SSE and keep task lifetime independent from an individual stream connection.
4. **Authenticated inbound MSO** — optionally publish MSO's Agent Card and JSON-RPC endpoint, guarded by owner-minted `read`, `write`, or `exec` bearer capabilities.

Inbound serving is **disabled by default** and is never enabled merely by installing or upgrading MSO.

## Trust model

A remote agent is a separate trust domain. MSO keeps that boundary explicit:

- Agent discovery uses `/.well-known/agent-card.json` and accepts only public **HTTPS** Agent Card/interface URLs.
- Outbound HTTP reuses MSO's SSRF guard: public-address validation, DNS re-resolution with resolved-IP pinning, redirect refusal, and rejection of loopback/private/link-local/metadata targets.
- Remote JSON responses and SSE events are bounded. Normal message text is limited to 24 KiB.
- `~/.mso/private/a2a-agents.json` stores sanitized public Agent Card metadata and a local credential-profile pointer, never a secret.
- Outbound credential secrets live separately in `~/.mso/private/a2a-credentials.json` under owner-only `0700/0600` storage. List/state APIs return summaries only.
- An inbound bearer is shown **once** when minted. MSO persists only its SHA-256 hash in `~/.mso/private/a2a-inbound-tokens.json` and compares candidates in constant time.
- Inbound task records use `~/.mso/private/a2a-tasks.json`, are bounded/rotated, and store only explicit A2A messages, task metadata, status, and result artifacts.
- One inbound credential cannot read, cancel, subscribe to, or continue a task owned by another credential.
- Each inbound task also has its own MSO workflow actor, so concurrent tasks from the same peer cannot finish/cancel/status each other's active workflow.

### Context and memory isolation

Inbound A2A does **not** call the normal owner Alfa endpoint. Both surfaces share one provider/model transport, but only the owner assistant performs MSO memory recall.

An inbound A2A turn receives:

- the explicit A2A message for that task;
- the exact `read` / `write` / `exec` capability assigned to that bearer;
- results returned by tools visible at that capability.

It does **not** receive owner memory, hidden MSO transcript history, raw owner session IDs, owner tool state, or an implicit user profile. The `agent_session_*` and durable `agent_memory_*` tool families are removed from the inbound model's tool catalog even for an `exec` credential.

Outbound `handoff` follows the same explicit-context rule: objective/context supplied by the caller plus bounded correlation metadata only. Hidden history/memory is not copied to the remote peer.

## Permission semantics

Outbound operations initiated through normal MSO CLI/MCP keep the existing owner permission model: registry writes require `write`; remote execution/cancel/handoff requires `exec` and therefore follows `ask` / `auto-write` / `yolo` exactly as before.

Inbound is different by design: **minting the bearer is the owner's approval boundary**. A remote request cannot pause on an interactive `ask` prompt, so the bearer itself is a delegated capability:

| Inbound scope | Remote agent can use |
|---|---|
| `read` | read-only MSO tools |
| `write` | read + write tools; no exec tools |
| `exec` | read + write + exec tools, except explicitly blocked owner-memory/session families |

Start peers at `read`. Promote to `write` or `exec` only when that remote agent should be allowed to mutate or execute on the host. A scope is enforced both when model-visible tools are selected and again by MCP dispatch.

## Enable the inbound server

Inbound requires **both** an explicit flag and an explicit HTTPS public origin:

```bash
OS_A2A_INBOUND_ENABLED=1
OS_PUBLIC_ORIGIN=https://mso.example.com
```

After rebuild/restart, MSO publishes:

```text
https://mso.example.com/.well-known/agent-card.json
https://mso.example.com/a2a/v1
```

The Agent Card is public discovery metadata. Protocol calls to `/a2a/v1` require HTTP `Authorization: Bearer ...` before any A2A method is dispatched.

Mint a credential:

```bash
mso a2a inbound create research-agent read
```

The raw `mso_a2a_...` token is returned once. Copy it into the remote agent's credential store, then discard the plaintext from terminal notes/history as appropriate. Later:

```bash
mso a2a inbound list
mso a2a inbound rm <tokenId>
```

The Settings → **A2A** panel exposes the same flow, shows the one-time token once, lists/revokes inbound profiles, and surfaces bounded task/audit activity.

## Same-host local A2A between terminal sessions

Local A2A is independent from public inbound A2A. It is **off by default**. Enable it explicitly on the MSO service:

```bash
OS_A2A_ALLOW_LOOPBACK=1
```

Rebuild/restart the service after changing its environment. This flag changes only A2A discovery/register/message/handoff traffic. It does not relax the generic provider HTTP client or any other MSO HTTP surface.

With the flag enabled, A2A accepts HTTP only when the literal destination is exactly `127.0.0.1`, `[::1]`, or `localhost`. It still rejects RFC1918 ranges, carrier/private ranges, link-local, Docker/LAN addresses, wildcard addresses, `.local`/`.lan` style hosts, and any non-loopback hostname whose DNS resolves to a private/loopback/link-local address. Public destinations continue to use HTTPS plus DNS re-resolution, resolved-IP pinning, and redirect refusal.

MSO treats each durable terminal AI session as a local A2A target. A session records its current working directory when created/resumed/updated, so another session can resolve it by:

- explicit session title, e.g. `bece`;
- full or unique session id;
- absolute working directory, e.g. `/home/rahman/projects/mso`;
- unique working-directory basename when unambiguous.

If a title/location matches multiple sessions, resolution fails instead of guessing.

Typical baco → bece flow on one VPS:

```bash
# Terminal A
mso agent
/title baco

# Terminal B
mso agent
/title bece

# From either shell, inspect local durable sessions
mso a2a sessions

# Ask the bece session-context agent to do one delegated task
mso a2a local handoff bece "inspect the current project and report the next safe step"

# Inspect tasks addressed to bece
mso a2a inbox bece
```

Inside interactive `mso agent`, `/agents` shows remote peers plus local sessions. `/delegate bece <objective>` tries a local session name/id/cwd first and falls back to a registered remote A2A peer only when no local session matches. `/spawn [--name <name>] <objective>` creates and runs a child from the current terminal session context, while `/inbox` shows tasks addressed to the current durable session.

A local handoff uses the target session's bounded durable history, memory snapshot, compacted context, and working-directory identity as context. It does **not** inject keystrokes into another TTY or impersonate that live terminal process. This avoids races with a human typing in that terminal.

To spawn a same-host sub-agent from an existing session context without opening another public endpoint:

```bash
mso a2a spawn baco "audit the A2A tests and return only failures" "baco-test-subagent"
# namespaced equivalent:
mso a2a local spawn baco "audit the A2A tests and return only failures" "baco-test-subagent"
```

The child is a durable MSO session with `parentSessionId` and inherited cwd/context snapshot, runs the delegated objective, and returns its A2A task result to the caller. `inbox` is read-only task inspection; it does not inject a new prompt into the terminal. No credential/token needs to be copied between local sessions.

For raw A2A protocol testing, each local session exposes a virtual Agent Card through the same loopback-only MSO service, for example:

```text
http://127.0.0.1:4005/.well-known/agent-card.json?session=<session-id>
```

MSO uses an owner-private internal loopback bearer automatically for this virtual-card path. It is not returned by CLI/state APIs and should not be requested or copied manually.

## Outbound peers and credentials

Discover/register peers:

```bash
mso a2a discover https://agent.example
mso a2a add https://agent.example research
mso a2a list
mso a2a state
```

Anonymous peers continue to work without a credential. For an authenticated peer:

```bash
# interactively prompts for the secret; it is not placed in curl/jq argv
mso a2a auth add research prod bearer
mso a2a auth add research prod-api api-key
mso a2a auth add research oauth-access oauth2

mso a2a auth list research
mso a2a auth use research <credentialId>
mso a2a auth use research none
mso a2a auth rm <credentialId>
```

MSO sanitizes and stores the public Agent Card security-scheme metadata beside the peer, then binds each credential profile to one declared scheme. Header API-key profiles inherit the exact header name from the Agent Card; HTTP Bearer uses `Authorization: Bearer`; OAuth2/OIDC profiles use an already acquired access token. MSO 1.8 fails closed for query/cookie API keys, HTTP Basic or other non-Bearer HTTP auth, mTLS, and requirements that need multiple simultaneous schemes. It also does not silently initiate a third-party browser authorization-code flow; a future release can add per-scheme token acquisition/rotation without changing the private profile model.

Credentials are applied at the HTTP transport layer, never inserted into the A2A message payload or Agent Card registry.

## Messages, tasks, and streaming

```bash
mso a2a send research "Find the latest implementation notes"
mso a2a send research "Do the work" --wait
mso a2a stream research "Do the work and stream progress"
mso a2a task research <taskId>
mso a2a cancel research <taskId>
mso a2a handoff research "Compare the two approaches" "Use these criteria only"
mso a2a rm research
```

Outbound supports A2A v1:

- **JSON-RPC** — `SendMessage`, `SendStreamingMessage`, `GetTask`, `CancelTask`.
- **HTTP+JSON** — `message:send`, `message:stream`, task read/cancel routes.

The inbound MSO JSON-RPC surface implements:

- `SendMessage`
- `SendStreamingMessage`
- `GetTask`
- `ListTasks` with bounded pagination tokens
- `CancelTask`
- `SubscribeToTask`

Streaming responses use `text/event-stream`. A `SendStreamingMessage` begins with the Task, emits status/artifact updates, and ends at a terminal task state. Disconnecting an observer unsubscribes that stream; it does **not** cancel the task. `CancelTask` is the explicit cancellation operation.

Inbound task execution is rate-limited by both source IP and bearer profile, and request bodies/results are bounded.

## Interactive Agent and MCP

Inside interactive MSO Agent:

- `/agents` lists registered A2A peers.
- `/delegate <peer> <objective>` uses the explicit-context handoff boundary.
- A2A/delegate/handoff intent loads A2A tools on demand instead of keeping them in every model turn.

The provider-neutral MCP catalog remains intentionally generic:

| Tool | Scope | Purpose |
|---|---|---|
| `a2a_agents_list` | read | List registered public peers |
| `a2a_agent_discover` | read | Validate/discover a public v1 Agent Card |
| `a2a_agent_register` | write | Register/refresh public Agent Card metadata |
| `a2a_agent_remove` | write | Remove local registry metadata |
| `a2a_message_send` | exec | Send one explicit A2A message |
| `a2a_task_get` | read | Read a remote A2A task |
| `a2a_task_cancel` | exec | Request remote task cancellation |
| `a2a_handoff` | exec | Delegate an explicit objective/context |

Registering a peer does not create dynamic MCP tool names. The target stays data (`alias`/id/Agent Card URL), keeping the tool schema stable as the peer set changes.

## Storage and environment overrides

Defaults:

```text
OS_A2A_STORE=~/.mso/private/a2a-agents.json
OS_A2A_CREDENTIAL_STORE=~/.mso/private/a2a-credentials.json
OS_A2A_INBOUND_TOKEN_STORE=~/.mso/private/a2a-inbound-tokens.json
OS_A2A_TASK_STORE=~/.mso/private/a2a-tasks.json
```

Private A2A state uses owner-only directories/files, no-follow reads, ownership checks, bounded file size, security-store locking, and atomic replacement.

## Deliberately not implicit

This release does **not**:

- enable inbound serving by default;
- derive an inbound public origin from an untrusted request host;
- expose an unauthenticated execution endpoint;
- copy owner memory/session state into inbound or outbound handoffs;
- let `write` credentials call `exec` tools;
- automatically run a remote OAuth browser flow;
- emulate unsupported query/cookie API keys, HTTP Basic, or mTLS;
- enable A2A push callbacks or gRPC.

Those surfaces should be added only with explicit callback validation, credential rotation/revocation UX, and equivalent regression coverage.

Official protocol reference: <https://a2a-protocol.org/latest/>.
