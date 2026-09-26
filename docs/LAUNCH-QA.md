# MSO launch Q&A

> Concise answers for launch conversations. Keep these aligned with current code and [`LAUNCH-READINESS.md`](./LAUNCH-READINESS.md). Do not upgrade a limitation into a promise.

### 1. What is MSO?

A self-hosted control plane where AI agents can work across your projects, tools, workflows and infrastructure while MSO keeps permissions, context and execution evidence under your control.

### 2. Who is it for?

Developers, technical operators and small trusted teams who run their own projects/servers and want agentic automation without handing the entire control plane to a hosted black box.

### 3. What problem does it solve?

Agent work is usually fragmented across chat history, terminals, repos, MCP tools, workflow products, provider credentials and deployment consoles. MSO gives those surfaces one identity, execution and evidence layer.

### 4. Why is this not just n8n?

n8n is a specialist workflow-automation product. MSO includes server-native workflows, but its primary boundary is broader: project-aware agent sessions, MCP/tools, host operations, memory/evidence and workflow execution share one permission/runtime model. MSO should not try to beat every n8n integration or editor feature.

### 5. Why not just use a coding agent such as Codex or Claude Code?

A coding agent is one reasoning/execution client. MSO is the self-hosted control plane it can connect to: projects, scoped tools, durable sessions, integrations, workflows, host operations and evidence survive beyond one model/client conversation.

### 6. Is MSO actually an operating system?

No. The OS metaphor is the workspace UI. MSO runs on an existing host and does not replace Linux, your VPS provider or the host's security model.

### 7. Does MSO require one AI provider?

No. The architecture is provider-neutral and supports configurable model/provider paths. A particular provider may expose different capabilities, costs or authentication methods.

### 8. What is the difference between Project, Agent, Session and Workflow?

- **Project:** the bounded code/work context.
- **Agent:** a configured actor that can reason and use permitted capabilities.
- **Session:** one durable conversation/execution history for an actor.
- **Workflow:** an explicit reusable execution graph/process.

Memory stores reusable knowledge/evidence; Organization maps people/agent seats and routing, rather than replacing those four concepts.

### 9. What does MSO remember?

MSO can preserve durable sessions, project memory, typed agent memory, workflow/recipe evidence and related knowledge. Retention and retrieval are bounded. “Stored” does not mean “automatically trusted”; provenance, review and poisoning resistance remain part of the memory-safety contract.

### 10. Can an agent delete my server?

Owner/exec authority is intentionally powerful, so MSO must be treated like SSH-equivalent automation for the service user. The product uses role/scope checks, path bounds, audit, confirmations and tool-specific policies, but no model should be treated as a security boundary. High-impact operations require system-enforced mediation and appropriate human approval.

### 11. Where are credentials stored?

Credentials use private server-side configuration/integration stores and private setup flows. They are not supposed to be pasted into prompts or emitted in normal metadata, logs or portable public source.

### 12. Can two agents work at the same time?

Yes, but source-changing tasks must use isolated worktrees and explicit ownership. Canonical `main` is the release/integration surface, not shared scratch space. The launch gate requires this to become tool-enforced, not merely documented.

### 13. What happens if an agent crashes halfway through?

Sessions/workflows keep durable state and evidence so work can be inspected or resumed. Side effects still depend on the external system involved, so idempotency, revision/CAS checks and explicit verification matter.

### 14. Can I see exactly what an agent did?

MSO records bounded workflow/session/action evidence and audits privileged actions. Sensitive values are intentionally redacted or excluded; an audit trail is evidence of actions, not unrestricted transcript/secret storage.

### 15. If my VPS dies, can I recover everything?

Not yet as a stable-product claim. MSO has local memory snapshots and isolated restore verification, but the current launch blocker is complete resumable coverage plus encrypted offsite recovery and a disaster-recovery drill.

### 16. How secure is MSO?

It has substantial first-party security gates and explicit privilege boundaries, but it has not established “100% secure” or third-party-audited status. Current public claims must distinguish tested controls from remaining posture gaps.

### 17. How is a release proven?

The intended chain is exact source SHA → type/lint/test/security checks → isolated production build → mandatory browser journeys → controlled integration/release → exact live SHA and asset/health verification. A push or successful unit test alone is not deployment proof.

### 18. Is MSO production-ready?

For the maintainer's own/internal technical use, many core paths are heavily exercised. The honest public label remains **Public Alpha / Developer Preview** until P0 concurrency, disaster recovery, measured onboarding, agentic-security and operational-SLO gates are satisfied.

### 19. What is the killer demo?

Pick one real project, let an agent inspect it with bounded reads, perform one isolated verified change using the project's tools/workflow, show the execution evidence, then resume/handoff the session. Do not demo every app in the shell.

### 20. Why should I trust a self-hosted project with infrastructure access?

You should not trust it blindly. Evaluate the boundaries and evidence: source is inspectable, credentials stay private, privileged actions are scoped/audited, releases are exact-SHA verified, and current limitations are published. The launch goal is verifiable control, not “trust the AI.”
