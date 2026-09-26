# Agent security launch contract

> **Current-reference security extension.** [`SECURITY-ASSURANCE.md`](./SECURITY-ASSURANCE.md) remains the evidence authority for current scanners and claim boundaries. This document defines agent-specific abuse cases that must be proven before a stronger public launch label.

## Principle

The model is not an authorization boundary. Downstream tools enforce identity, scope, policy, confirmation and resource bounds on every call.

## Tool risk classes

| Class | Examples | Default control |
|---|---|---|
| Read | bounded status, metadata, project inspection | authenticated scope + rate/bounds + redaction |
| Reversible write | draft/config changes with CAS/revision | write scope + stale-write protection + audit + verify |
| High impact | shell, deploy, delete, credential/provider mutation | exec/owner scope + explicit policy/confirmation + audit + post-action verification |
| Critical/external irreversible | broad destructive actions, identity/security boundary changes | dedicated bounded API, fresh confirmation/human review, deny generic fallback |

## Abuse-case matrix

The release security suite must include repeatable failures for:

1. **Direct/indirect prompt injection** — retrieved web/docs/tool output cannot replace system/developer/tool policy.
2. **Tool misuse** — persuasive model text cannot call a tool outside current scope/allowlist.
3. **Privilege escalation** — Viewer/Operator/read/write identities cannot reach Owner/exec authority.
4. **Data exfiltration** — secret-bearing files, credential stores, cookies and private tool results cannot leak through normal output, logs, artifacts or external tool arguments.
5. **Memory poisoning** — untrusted observations retain provenance and cannot silently become high-authority durable instructions.
6. **Cross-agent identity confusion** — Local Agent/A2A/subagent handoff does not widen the originating principal's authority.
7. **Recursive/cascading failure** — depth, retry, runtime, token/cost and workflow bounds stop runaway delegation.
8. **Stale approval/replay** — revision/CAS/one-time confirmation cannot be reused after target state changes.
9. **Confused deputy** — downstream integrations enforce the intended user/connection/resource rather than accepting model-selected identity by implication.
10. **Audit poisoning** — user/model-provided strings cannot forge successful audit/evidence status.

## Memory admission target

Durable memory should distinguish at minimum:

- user-provided vs system-observed vs verified evidence;
- principal/project scope;
- confidence and provenance;
- superseded/retracted state;
- review/admission status for behavior-shaping procedural memory.

Memory may recommend a route. It may never grant permissions, approve deletion, or override a failed authorization check.

## Launch evidence

A 10/10 agent-security claim requires the abuse matrix to run after material changes to models, prompts/instructions, tools, memory, retrieval, workflow policy or provider integrations. Failure is a release blocker for the affected authority class.
