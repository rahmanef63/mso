# n8n-io/n8n

| | |
|---|---|
| License | **Sustainable Use License (fair-code)**, not an OSI license |
| Relation | capability map against native Workflows; optional embedded editor |
| Code copied | none |

## What MSO uses

A capability map, not an implementation: [`../N8N-PARITY.md`](../N8N-PARITY.md)
lists 31 n8n capability areas against MSO-native surfaces. The dedicated n8n
window (`frontend/slices/n8n/`, 28 lines) renders an operator-supplied instance
inside `ExternalAppFrame`; MSO does not proxy or re-serve n8n content.

## Why the license matters here

The Sustainable Use License forbids offering the software to third parties as a
hosted service without a commercial agreement. MSO bundles no n8n code, ships no
n8n image, and only points an iframe at an instance the operator already runs.
Any future bundling, redistribution, or multi-tenant resale of n8n inside MSO
requires a commercial license from n8n GmbH.

## What MSO does not use

No n8n source, node definitions, workflow JSON schema, icons, or container image.
The Workflow Graph engine in `lib/workflow/` is MSO-native.
