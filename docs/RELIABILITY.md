# Reliability and launch SLO contract

> **Targets, not current SLO claims.** The reference installation needs measured history before MSO can claim these objectives are achieved.

## Initial SLIs

Track at least:

- public and loopback `/api/health` success rate and latency;
- authenticated core-route success rate for project/session/tool/workflow reads;
- privileged action success/refusal/error classification;
- deployment success, rollback and exact-live-SHA convergence;
- disk, memory and process saturation;
- backup freshness/completeness/restore-drill age;
- agent/workflow queue age and bounded failure/retry counts.

## SLO targets

For the maintainer reference production used as public evidence:

- **Public-beta availability target:** 99.5% successful health checks per rolling 30 days.
- **Stable availability target:** 99.9% per rolling 30 days, excluding documented planned maintenance only when users can distinguish it.
- **Health latency target:** p95 <500 ms from the selected probe region under normal load.
- **Release convergence:** supported release path reaches exact healthy live SHA or rolls back/fails closed; no ambiguous half-deployed success.
- **Backup freshness:** within the configured RPO and no overdue restore drill.

100% uptime is not the goal. The goal is explicit reliability that controls change velocity.

## Error-budget/change policy

- When the rolling error budget is healthy, normal feature releases may proceed after gates.
- When exhausted, freeze nonessential feature releases and prioritize reliability/security/recovery work until exit criteria are met.
- Security emergency fixes may proceed through an explicitly recorded exception with rollback evidence.

## Capacity policy

Disk pressure is a correctness concern because sessions, evidence, builds and Docker caches compete for the same host.

- **<75%:** normal.
- **75–85%:** warning; forecast growth and identify reclaimable caches.
- **85–90%:** high; freeze nonessential cache growth/build churn and prepare reviewed cleanup/backup action.
- **≥90%:** critical; alert Owner, preserve primary evidence, require previewed category-specific cleanup or capacity expansion. Never use age alone as proof that session/memory evidence is disposable.

Thresholds are initial operator policy and should be calibrated from measured workload.

## Release strategy

Prefer reproducible automated builds, small isolated changes, exact-SHA evidence, staged/canary exposure when practical, and an explicit rollback path. A test pass, push, merge, deployment start and verified-live state are separate events.
