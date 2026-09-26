# Product Hunt copy draft

> **Marketing collateral, not technical authority.** Keep claims aligned with
> `README.md`, `SECURITY.md` and current reference docs before publishing.

## Product name

MSO — Manef Shell OS

## Tagline

Self-hosted control plane for AI agents

## Description

MSO is an open-source, self-hosted control plane for AI agents working across projects, tools, workflows and infrastructure. It combines project-aware agent sessions, scoped MCP/tools, native integrations, server-native workflows, files/terminal/service operations, memory and execution evidence behind one responsive browser/CLI/MCP runtime.

The OS-style interface is the workspace metaphor, not the product boundary. MSO runs on a server you control and keeps provider credentials and privileged operations behind server-side identity, scope and approval rules.

## First comment draft

I built MSO because useful agent work kept fragmenting across chat history, repositories, terminals, MCP tools, workflow apps, credentials and deployment consoles. I wanted one self-hosted control plane that could keep the project context, tool authority and execution evidence together.

MSO is not a Linux distribution, VPS provider or a claim to replace every specialist automation product. "OS" is the interface metaphor; the product boundary is the agent control plane over infrastructure you already own.

It is owner-first, with live Viewer, Operator, and Owner roles assigned per approved device.
Owner remains shell-equivalent to the Linux service account; Operator is limited to bounded,
owner-allowlisted operations; Viewer is read-oriented. This is not enterprise identity or SSO,
so the recommended deployment is still behind Tailscale or another tightly controlled HTTPS path.
The public demo uses mock data only.

The project is Public Alpha / Developer Preview and has not had a third-party security
audit. I am looking for feedback on the core workflow before widening scope.

## Feedback questions

1. Which server task would you most want to do comfortably from your phone?
2. Is the OS-style workspace useful, or would you prefer a simpler admin dashboard?
3. Which security/deployment concern would stop you from trying it?
4. Which Linux distributions should be tested next?

## Known limitations to disclose

- Public Alpha / Developer Preview
- Device-scoped roles, but no named-user directory, OIDC/SSO, Linux-account mapping, or tenant isolation
- No third-party security audit
- Private-network/TLS deployment strongly recommended
- Service actions are disabled until exact units are owner-allowlisted; package updates are visibility-only
- Some integrations (Camoufox, Hermes/OpenClaw, MCP, model providers) are optional
