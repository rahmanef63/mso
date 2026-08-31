---
name: mso-project-deploy
description: Deploy through MSO with bounded Dokploy setup, project-owned deployment functions, and approval-gated Cloudflare or Hostinger DNS; never request provider secrets in chat.
metadata:
  mso:
    risk: high
    policy: inspect-plan-approve-verify
---

# /mso-project-deploy — provider-aware project deployment

Use this flow when the owner asks MSO Agent to publish, redeploy, attach a domain, or finish infrastructure setup for an application. It is adapted from the proven provider separation in `rahmanef63/si-coder-agent`, but the MSO implementation uses its own private provider store and MCP approval boundary.

## Credential boundary

Never ask the user to paste a Dokploy, Cloudflare, Hostinger, GitHub, Convex, or Vercel credential into chat or a command string. Call `infra_providers_list` first. If a required provider is missing, tell the user exactly which interactive command to run, e.g. `mso provider set dokploy` or `mso provider set cloudflare`, then re-check with `infra_provider_doctor`.

Provider secrets live under MSO's owner-only private state and are loaded server-side. They must not appear in tool arguments, shell argv, logs, git remotes, build args, or generated documentation.

## Deployment flow

1. Start one workflow with `workflow_start` for any multi-step deployment and preserve its id.
2. Resolve the target project with `projects_list`, then inspect its package/build/runtime contract and `project_capabilities` before changing infrastructure. Do not guess framework, port, build output, or environment variables.
3. Check providers with `infra_providers_list`, followed by a live `infra_provider_doctor` for every provider you will use.
4. Prefer bounded infrastructure tools. `dokploy_projects_list` and `dokploy_project_ensure` are preferred over raw API curl or `exec_run`. The current generic Dokploy surface intentionally stops at project setup; application/compose-specific deployment must use a validated project `.mso/functions.json` via `project_function_call`, or an explicitly approved host operation when no bounded project function exists.
5. DNS is always a separate phase after the application target exists and its intended origin is known. For Cloudflare, use `cloudflare_dns_upsert`: it performs only exact per-record POST/PATCH and refuses bulk writes or ambiguous records. Proxying defaults off and must be explicitly requested. For Hostinger, use `hostinger_dns_upsert` only after approval. MSO verifies the current zone for ambiguity/conflicts, then sends exactly one requested name/type RR-set with provider-scoped overwrite semantics; unrelated zone rows never enter the mutation payload.
6. Never derive a public DNS A target from a loopback/local Dokploy API URL. Use an explicit verified public origin/IP from the deployment context.
7. Verify the application directly at its origin before and after DNS, then verify the final HTTPS hostname. Check redirects, health, and the expected app identity rather than treating a generic HTTP 200 as proof.
8. If any step fails, preserve the first concrete error and repair the smallest failing layer. Do not delete/recreate projects, DNS records, or provider state as a first response.
9. Finish the workflow only after runtime and domain verification pass. Cancel the workflow if the deployment is abandoned.

## Extending providers

The provider registry is intentionally modular. New providers must define validated fields, secret classification, a live doctor probe, bounded clients, and tests before they are exposed to the agent. A new provider is not complete merely because a token can be stored.
