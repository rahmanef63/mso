# Competitive execution roadmap

Status: active product strategy · updated 2026-08-29

## Goal

Make MSO the strongest **mobile-first, AI-native private Linux workspace for an owner or small trusted team**. “Strongest” is measured against the documented comparison criteria, not claimed as a universal replacement for specialist tools.

## Executed in this release

| Phase | Deliverable | Status | Verification contract |
|---|---|---:|---|
| P0 | Versioned comparison data, official-source links, generated README/detail docs, 90-day freshness gate | Done | `node scripts/gen-comparison.mjs --check` |
| P1 | Device-scoped Viewer / Operator / Owner roles, live demotion/revocation, role-aware shell and server authorization | Done | auth, route, proxy, CLI, and policy tests |
| P1 | System Monitor Service Center: system/user service inventory, bounded journal, exact allowlisted lifecycle | Done | parser, policy, route, typecheck, and build tests |
| P1 | Package-update visibility from existing local cache; no refresh/install/upgrade action | Done | multi-manager parser tests and API/CLI parity |
| P1 | CLI parity for roles, services, logs, lifecycle, and package visibility | Done | CLI documentation and route-coverage tests |
| P1 | Current documentation synchronized across architecture, security, installation, FAQ, Product Hunt, and contributor guidance | Done | docs/comparison/CLI checks plus repository verify |

## Deliberate boundaries

The following are **not** silently represented as complete:

1. **Full Linux administration.** Cockpit remains deeper for network, firewall, storage, users, SELinux, VM, and multi-host administration. MSO should integrate these only through bounded, typed modules—not by adding arbitrary privileged buttons.
2. **General PaaS delivery.** Coolify remains stronger for Git push/PR deployments, broad service templates, databases, SSL automation, and multi-server delivery. MSO currently manages a curated app set.
3. **Container orchestration.** Portainer remains stronger for Docker/Swarm/Kubernetes/Podman stacks, resource governance, and GitOps.
4. **Long-term observability.** Netdata remains stronger for per-second history, alerting, anomaly detection, correlation, and incident RCA. MSO has live host telemetry and a short in-window history.
5. **Identity network and SSO.** Tailscale/Cockpit remain stronger for external identity, ACLs, Linux-user mapping, SSO, and recorded access. MSO roles are approved-device roles under one Unix account.
6. **Large app ecosystem.** CasaOS/Runtipi remain stronger for broad consumer one-click app catalogs and per-app self-hosting workflows.

## Next measurable investments

These are ordered by value to MSO’s chosen category, not by copying competitors feature-for-feature:

1. **Persistent alerts and history:** bounded local time-series retention, thresholds, notification adapters, and incident timeline export.
2. **Typed deployment recipes:** Git source, build, health check, rollback, secret references, and preview environments without exposing arbitrary shell templates.
3. **Identity upgrade:** named people, role assignment per identity, optional OIDC, session inventory, and audit attribution while preserving device approval.
4. **Host modules:** network, storage, firewall, and user administration as separate typed capabilities with independent permissions and tests.
5. **Ecosystem contract:** signed managed-app recipes, compatibility metadata, backup/restore conformance, and community review workflow.

A future phase may only change a comparison rating after implementation evidence exists and the generator accepts it.
