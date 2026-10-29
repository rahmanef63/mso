# PTY for the agent: design note

Item 5 in `docs/AGENT-CODING-PLAN.md`. Written before implementation because this is the
highest-blast-radius tool in the catalog: a PTY is an interactive shell, and an agent driving
one can do anything the owner's shell can do, including things `exec_run` cannot (answer a
prompt, run a REPL, hold a lock, keep a server up).

## What exists

- `app/api/v1/term/{open,input,resize,stream,close}` routes.
- `lib/host/pty.ts` via `lib/host/terminal-api.ts`: `openPty`, `attachPty`, `writePty`,
  `resizePty`, `closePty`, `hasPty`.
- A rate limit of 20 opens per window per actor in `term-service.ts`, and `term.open`
  already writes to the audit trail.
- The CLI exposes it as `mso term open|input|resize|stream|close`.

No MCP tool exposes any of it. So an agent cannot drive a long build, a REPL, or any
program that needs stdin to stay open. `exec_run` is one-shot with a 30s budget and
`exec_job_start` is fire-and-forget with a status read, which is genuinely different.

## Why this is dangerous, stated plainly

- `exec_run` is bounded: one command, captured output, one exit code. A PTY is unbounded
  in time and interaction.
- A PTY can hold a lock, a watcher, or a server. Left open it outlives the turn.
- A PTY can sit at an interactive password prompt. An agent typing into it is one bad
  guess from a lockout.
- Output is a stream, not a value. Returning an unbounded stream into a model context is
  how a session gets poisoned.

## Design, chosen to keep the blast radius equal to `exec_run` rather than larger

1. **One tool, not five.** `pty_session` with an `action` field: `open`, `write`, `read`,
   `close`, `list`. Five separate tools would tempt a model to call them independently and
   lose the correlation; one tool with an explicit action makes the session id the subject
   of every call.
2. **Every call is bounded.** `read` takes `max_bytes` (default 8 KiB, hard cap 32 KiB) and
   `since_offset`, returning `{ output, nextOffset, truncated }`. It never returns an
   unbounded stream, so a chatty process cannot flood the context.
3. **Sessions expire.** A session that nobody reads or writes for N minutes is closed and
   reaped, so an abandoned PTY cannot hold a lock forever. The tool reports `expired`
   rather than pretending the session still exists.
4. **Owner-scoped.** A session belongs to the principal that opened it. Another principal
   gets not-found, never forbidden, so existence does not leak. This mirrors the
   background-subagent rule just added.
5. **No environment widening.** The PTY inherits exactly the environment the existing
   `exec_run` path gives a command. No extra secrets.
6. **Audit every action.** `term.open`, `term.write`, `term.close` already exist as audit
   actions for the CLI; reuse them rather than inventing a parallel trail.
7. **Scope `exec`.** Opening a shell is exec-class authority. It is never available at read
   or write scope, and it respects the same `max_scope` ceiling a subagent inherits.

## What I will NOT do

- No `stream` tool. Streaming into a model is not a bounded operation. Polling `read` with
  an offset is the honest version.
- No auto-answer of password or sudo prompts. If the read output looks like a credential
  prompt, the tool says so and stops; it does not guess.
- No PTY for a subagent unless the parent already has `exec` scope.

## Gate

Same as before: bounded tools, split files to hold the ratchet, targeted tests that use a
real PTY, then the 12-gate runner, then a PR. If the real-PTY tests are flaky on the CI
image, say so and gate them on an environment check rather than letting them become noise.
