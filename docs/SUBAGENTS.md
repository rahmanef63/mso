# Subagents — isolated workers inside one MSO Agent session

MSO **subagents** are foreground child runs inside one parent durable Agent session. They are intentionally different from [Local Agents](./LOCAL-AGENTS.md) and [remote A2A](./A2A.md).

| Primitive | Identity/lifetime | Transport | Best use |
|---|---|---|---|
| Subagent | transient child of the current session | in-process model/tool run | isolated research, review, independent workstream |
| Local Agent | another durable MSO session on this host | private mailbox + presence + SSE | collaboration between live sessions |
| Remote A2A | external agent/service | A2A v1 over authenticated network transport | interoperability across agent systems/hosts |

## UX

Interactive Agent:

```text
/spawn review the auth boundary
/spawn --name reviewer --scope read review auth and return only risks
/spawn --name implementer --scope write --turns 8 make the bounded requested edit
```

The default child scope is `read`. `/spawn` is foreground: the parent waits for the bounded worker run, receives its final result, stores a compact `subagent` result row, then continues. No subagent process or autonomous loop remains after the call returns.

The model-visible equivalent is:

```text
agent_subagent_run
```

A model may choose this tool for a focused independent workstream. It should not spawn a child for simple sequential work that fits cleanly in the parent context.

## Context contract

A child starts with a fresh model context containing only:

- its explicit objective;
- parent working-directory identity;
- an optional explicit `context` string supplied by the caller;
- the selected bounded tool schemas.

MSO does **not** automatically copy the parent hidden transcript, memory ledger, Local Agent inbox, A2A state, tool arguments, credentials, or reasoning. Intermediate child tool calls/results stay inside the child run. The parent receives only the final text plus bounded execution metadata (`subagentId`, name, status, rounds, tool names + success flags, delegated scope).

This mirrors the useful Claude Code subagent property: context isolation with final-result return, without turning every worker into another durable peer session.

## Authority

`agent_subagent_run` is an `exec`-scope tool even when its child is read-only. That top-level exact-payload approval is the **delegation boundary**. The approved payload includes the objective and requested `max_scope`.

Inside the child:

- default `max_scope` is `read`;
- requested scope cannot exceed the parent caller scope;
- max model/tool rounds default to 6; the server policy `OS_SUBAGENT_MAX_TURNS` defaults to 12 and may be raised up to the absolute cap of 48;
- timeout defaults to 60 seconds and caps at 120 seconds;
- result text is bounded to 64 KiB;
- recursive `agent_subagent_run` is unavailable;
- `agent_session_*`, `agent_memory_*`, `local_agent_*`, and `a2a_*` tools are unavailable.

The last rule prevents a child from silently becoming a session orchestrator, leaking parent/session context, or creating an unbounded agent tree. If a worker needs another agent, the parent should make that delegation explicitly.

## Failure semantics

A child returns one of:

- `completed` — final response produced before limits;
- `partial` — turn limit reached; bounded latest result is returned;
- `timeout` — foreground deadline expired.

There is no implicit retry. The parent/user decides whether to retry, narrow the objective, raise limits, or do the task directly.

## When to use subagents

Good candidates:

- independent repository research while the parent keeps its main context clean;
- code/security review that benefits from a fresh perspective;
- a bounded implementation workstream with deliberately delegated write scope;
- comparing several independent approaches (run separate foreground workers, then synthesize in the parent).

Poor candidates:

- one small sequential edit;
- work where every step depends on the immediately previous parent result;
- tasks that need continuous user interaction;
- unattended/background automation. Use an explicit workflow/job or another durable Local Agent session instead.

## Legacy A2A local spawn

`mso a2a spawn` and `mso a2a local spawn` remain compatibility/protocol-testing commands. They create a durable child session and execute the old local-A2A path. Interactive `/spawn` no longer uses that mechanism.
