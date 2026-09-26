# 3-minute launch demo — one agent job, end to end

> **Marketing/demo collateral, not a runtime contract.** Public recordings use a synthetic project, synthetic provider identities and no production secrets. Do not jump between unrelated apps to prove breadth; demonstrate the control-plane thesis with one complete job.

## The promise to demonstrate

> MSO is a self-hosted control plane where an AI agent can work across a project and its tools while permissions, context and execution evidence remain under the operator's control.

## Demo fixture

Prepare one small repository with:

- a visible failing or incomplete feature that is understandable in one sentence;
- a deterministic test that fails before the change and passes after it;
- no credentials, customer data or production deployment requirement;
- a clean canonical branch plus a task-owned isolated worktree path;
- one connected synthetic/read-safe integration if the story needs an external tool.

The fixture must be reproducible from source. Do not rely on a hidden pre-edited working tree.

## 0:00–0:25 — Project context, not a blank chat

Open MSO and select the demo project. Show the project identity, branch/status and the agent/session surface.

Say:

> “This is not just a chat window. MSO resolves the project, the tools this identity may use, and the durable session that will hold the execution evidence.”

Do not show server dashboards or unrelated apps yet.

## 0:25–0:55 — Read first, authority stays bounded

Give the agent this request:

```text
Inspect this project's current state and explain why the demo test is failing.
Do not modify files, branches, services, deployments, credentials or external systems yet.
```

Show the bounded project/read activity and the diagnosis. The success criterion is that the agent uses the project context without widening authority, not that it produces a clever paragraph.

## 0:55–1:40 — Isolated change with visible diff

Approve the source-changing phase only after the diagnosis is visible.

Show that the work happens in a task-owned isolated worktree rather than treating canonical `main` as shared agent scratch space. Apply one small change and open the diff.

Say:

> “A model suggestion is not a release. This candidate is isolated from canonical source and is still only implemented.”

If the current build does not yet tool-enforce the worktree boundary, do **not** stage this scene as if it does. Use the demo only after the source-concurrency launch gate is implemented and verified.

## 1:40–2:15 — Verification changes the state

Run the deterministic targeted test. Show before/after evidence and the exact candidate SHA.

Make the state transition explicit:

```text
IMPLEMENTED → TESTED
```

Do not call the change “deployed” or “done”.

## 2:15–2:40 — Evidence and handoff survive the chat

Open the session/workflow evidence. Show the relevant action summary, verification receipt and a resumable/handoff reference without exposing hidden chain-of-thought or credentials.

Say:

> “The useful output is not only the code. The next operator or agent can see what was attempted, what was verified and what is still unproven.”

## 2:40–3:00 — The product boundary

Show the three product tiers briefly:

```text
Core          Projects · Sessions · Tools/MCP · Workflows · Evidence
Intelligence  Memory · Learning · Organization · Multi-agent
Operations    Server · Release · Backup · Security · Observability
```

Close with:

```text
MSO
Self-hosted control plane for AI agents.
Your projects. Your tools. Your infrastructure. Verifiable execution.
```

## Optional extended demo

Only after the 3-minute story is complete, demonstrate one deeper capability at a time: native provider setup, Workflow Graph, Organization, A2A, Memory, Camoufox, managed apps, server operations or mobile shells. These are proof of breadth, not the opening narrative.

## Demo acceptance checklist

- The full 3-minute path works from a clean fixture without undocumented manual edits.
- No real secrets, browser profiles, customer data or production write access appear.
- Read-only analysis visibly precedes mutation.
- Source mutation is genuinely isolated, not cosmetically described as isolated.
- The diff and failing→passing test are understandable on screen.
- Evidence distinguishes implemented, tested, integrated, released and live states.
- The demo works at the chosen recording viewport with no overflow/dead loading state.
- A second operator can reproduce the fixture and script from repository instructions.
