# decolua/9router

| | |
|---|---|
| License | MIT |
| Pin | image digest `decolua/9router@sha256:f00fe389ef41a1999dd0d0275ad0c2955d13d176f7c4c5cb844b2f88c293c471` |
| Relation | managed model-router application |
| Code copied | none |

## What MSO uses

A lifecycle adapter, not the upstream CLI. [`../../scripts/managed-app-9router`](../../scripts/managed-app-9router)
refuses any image reference that is not an immutable `@sha256:` digest, binds to
loopback unless explicitly exposed, and speaks the documented
`--version` / `check` / `update` / `uninstall` contract. The digest lives in
`security/managed-app-artifacts.env`.

[`../9ROUTER-INTEGRATION.md`](../9ROUTER-INTEGRATION.md) and
[`../9ROUTER-MSO-APPHOST-RFC.md`](../9ROUTER-MSO-APPHOST-RFC.md) record the dashboard
boundary and the conditions under which MSO may skip a separate 9Router login.

## Evidence

No 9Router source or image is committed here. MSO installs from the pinned digest at
the operator's request. The public endpoint, when enabled, exposes only `/v1` through
the gateway; the dashboard is not internet-exposed by default.
