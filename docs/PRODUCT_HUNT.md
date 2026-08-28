# Product Hunt copy draft

> **Marketing collateral, not technical authority.** Keep claims aligned with
> `README.md`, `SECURITY.md` and current reference docs before publishing.

## Product name

MSO — Manef Shell OS

## Tagline

Manage your Linux server from any browser.

## Description

MSO is an open-source, mobile-friendly visual shell for a Linux server you own. It combines
Files, real PTY Terminal, Code with an integrated terminal, live metrics, a safe Service Center,
cached package-update visibility, a remote Camoufox browser, device-scoped roles, media tools,
optional BYOK Alfa AI, and managed Hermes/OpenClaw controls
inside one private browser workspace.

## First comment draft

I built MSO because managing a personal Linux server from a phone is still more awkward than
it should be. SSH is powerful, but on mobile I kept jumping between terminal tabs, file
transfer tools, metrics dashboards, docs and AI chat.

MSO is not a Linux distribution, desktop environment or VPS provider. "OS" is the interface
metaphor: a responsive workspace over a server you already own.

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
