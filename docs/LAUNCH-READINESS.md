# MSO launch readiness contract

> **Target, not a marketing score.** “10/10” means every acceptance gate below has current evidence. A planned feature, old screenshot, historical test, or clean-looking UI does not count. Current code/live state wins.

MSO's launch thesis is intentionally narrow:

> **MSO is a self-hosted control plane where AI agents safely work across your projects, tools, workflows, and infrastructure while preserving context and execution evidence.**

The OS metaphor is presentation. The product is the control plane. Anything that does not strengthen that control plane is secondary.

## Product boundary

**Core:** Projects · Agent Sessions · Tools/MCP/Integrations · Workflows · Execution/Evidence.

**Intelligence:** Memory · Learning/Recipes · Organization · Multi-agent/A2A.

**Operations:** Server · Deployment · Backup/Recovery · Security · Observability.

**Not the promise:** a Linux distribution, a VPS provider, a full enterprise IAM/SSO suite, a replacement for every specialist CI/PaaS/automation product, or a guarantee that an autonomous model is safe by itself.

## 20 gates for a defensible 10/10

| # | Dimension | 10/10 acceptance gate | Required evidence | Current launch blocker |
|---|---|---|---|---|
| 1 | Value proposition | One sentence explains category, user, job and trust boundary; 4/5 fresh technical users can repeat it accurately after 30 seconds. | README hero + 5-user comprehension receipt. | No external comprehension test yet. |
| 2 | Problem clarity | Three primary pains and one end-to-end “killer journey” are explicit; every hero feature maps to one pain. | README/launch copy + demo script. | Feature breadth still competes with the story. |
| 3 | Differentiation | Evidence-backed comparison explains when to use MSO vs specialist tools without claiming universal superiority. | Generated COMPARISON + dated sources. | Keep comparison freshness ≤90 days. |
| 4 | Product scope | Core/Intelligence/Operations are the only top-level product tiers; non-goals are published and feature additions require a tier + user job. | This contract + architecture/docs index. | Existing surfaces still expose historical breadth. |
| 5 | First-time UX | Fresh user reaches first verified useful agent action without editing source/config files; median ≤10 min, p90 ≤20 min on supported Linux baseline. | Fresh-machine timed onboarding runs ≥10. | No measured time-to-first-value cohort. |
| 6 | Installation/onboarding | One supported production path is boring and deterministic: install → doctor → onboard → first action; failures name the broken layer and recovery. | Clean Ubuntu install matrix + screenshots/terminal receipts. | Cross-platform support exists but launch path is not yet measured as one funnel. |
| 7 | Information architecture | A user can distinguish Project, Agent, Session, Workflow, Memory and Organization in one sentence each; primary navigation is task/role shaped. | IA glossary + usability test ≥80% first-try routing. | Concept density remains high. |
| 8 | UI consistency | WCAG AA, no horizontal overflow, token/spacing consistency and no dead loading/error states across desktop, phone portrait and phone landscape/tablet. | Mandatory browser E2E + visual regression/axe receipts. | Coverage is strong but not yet one launch-wide visual baseline. |
| 9 | CLI quality | Every core non-visual operation is discoverable from `mso --help`, uses stable exit semantics, structured output where automation needs it, and never silently widens authority. | CLI contract tests + generated CLI docs. | Keep parity and error UX under release gate. |
| 10 | API/MCP architecture | UI/CLI/MCP delegate to the same domain authority; schemas/scopes/audit/concurrency metadata are stable and tested; no hidden “second implementation.” | Tool-contract, dispatch, API and parity tests. | Provider parity still expands over time. |
| 11 | Agent model | Agent/Local Agent/Subagent/A2A boundaries are explicit; each has identity, scope, lifetime, handoff and cancellation semantics; no implicit authority inheritance. | Architecture + isolation/handoff tests. | Mental model still needs launch-level simplification. |
| 12 | Memory / second brain | Memory has provenance, scope, review/admission, supersession/forget semantics, poisoning tests and visible coverage limits. No memory can authorize destructive cleanup. | Memory lifecycle/adversarial suite + UI coverage receipt. | JEV admission and full learning-coverage review remain incomplete. |
| 13 | Backup / recovery | 3-2-1 posture for critical state: production + independent backup + encrypted offsite copy; restore drill proves RPO/RTO; local snapshot is complete or explicitly partial. | Encrypted offsite backup + isolated restore drill. | Current verified backup is local, partial, not offsite. |
| 14 | Security model | Complete mediation in downstream tools, least privilege, tool risk classes, explicit approvals for high-impact actions, prompt-injection/memory-poisoning/exfiltration/privilege abuse tests. | SECURITY-ASSURANCE + agent abuse-case matrix + current alert inventory. | No third-party audit; some agentic threat gates still need dedicated launch evidence. |
| 15 | Concurrency safety | Automated source mutation never leaves canonical `main` as a shared scratchpad: one task = one isolated worktree; release integration occurs only from clean, proven candidates. | Tool-enforced workspace lease + collision tests + protected main/ruleset evidence. | Current incident proved policy is not yet tool-enforced; GitHub rulesets list is empty. |
| 16 | Release engineering | Exact SHA → full verify → isolated production build → browser E2E → integration queue/canary → rollback → exact live SHA/chunk health. Build/release is repeatable and no unique snowflake. | Release receipt per version. | Existing exact-SHA gates are strong; staged/canary policy still needs formal production evidence. |
| 17 | Operational resilience | Published SLIs/SLOs, error-budget/change-freeze policy, disk/memory thresholds, alerting, restore/runbook ownership, and failure-mode drills. | SLO dashboard + alert/fire-drill receipts. | Disk pressure and capacity policy are not yet a complete product SLO. |
| 18 | Documentation | Docs follow Tutorial / How-to / Reference / Explanation separation; one 10-minute tutorial is the canonical first route. | Docs map + link/check-doc gate + user completion test. | Excellent reference depth, but onboarding is still reference-heavy. |
| 19 | Demoability | A reproducible ≤3-minute demo shows one project → agent/tool action → workflow/evidence → resume/handoff without secrets or hidden manual setup. | Recorded demo + script + clean fixture. | Existing demo is broad rather than one launch narrative. |
| 20 | Launch readiness | Public beta only when all P0 gates are green, every known limitation is published, rollback/recovery is proven, and current main/live evidence matches the release claim. Stable label requires sustained SLO + recovery history. | Signed/dated release readiness receipt. | Public Alpha/Developer Preview remains the accurate label today. |

## P0 before public beta

1. **Enforce source concurrency**, not merely document it: isolated task worktrees, canonical-main mutation guard, clean integration authority, remote protection/ruleset/status checks. See [`SOURCE-CONCURRENCY.md`](./SOURCE-CONCURRENCY.md).
2. **Complete disaster recovery**: complete resumable snapshot, encrypted offsite target, restore drill, explicit RPO/RTO. See [`DISASTER-RECOVERY.md`](./DISASTER-RECOVERY.md).
3. **Agentic security launch suite**: prompt injection, tool misuse, privilege escalation, data exfiltration, memory poisoning, recursive/cascading failure and cross-agent identity tests. See [`AGENT-SECURITY.md`](./AGENT-SECURITY.md).
4. **Measured onboarding**: fresh host, fresh user, no maintainer knowledge; record time-to-first-value and every manual intervention.
5. **One killer journey** across README, Product Hunt, demo and onboarding.
6. **SLO + operational policy**: availability/latency/failed-action/disk-pressure SLIs, error budget, change freeze and rollback policy. See [`RELIABILITY.md`](./RELIABILITY.md).

## P1 before “stable”

- Sustained SLO history across releases rather than one green release.
- Recovery drill repeated from offsite backup.
- Provider-native integrations meet one shared UX/AX/DX contract.
- Memory admission/review is live, explainable and adversarially tested.
- Role/task navigation has external usability evidence.
- Human code-review posture or an explicit public solo-maintainer exception remains documented; do not fabricate review evidence.

## Release decision rule

A launch score is **evidence**, not averaging. One red P0 gate blocks the stronger launch label even if nineteen areas are excellent.

Use separate states:

`IMPLEMENTED → TESTED → INTEGRATED → RELEASED → VERIFIED-LIVE → OPERATED → HUMAN-VALIDATED`

Never collapse them into “done.”
