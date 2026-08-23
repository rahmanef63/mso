# Product Hunt copy draft

> **Marketing collateral, not technical authority.** Keep claims aligned with
> `README.md`, `SECURITY.md` and current reference docs before publishing.

## Product name

MSO — Manef Shell OS

## Tagline

Manage your Linux server from any browser.

## Description

MSO is an open-source, mobile-friendly visual shell for a Linux server you own. It combines
Files, real PTY Terminal, Code with an integrated terminal, live system metrics, a remote
Camoufox browser, media tools, optional BYOK Alfa AI, and managed Hermes/OpenClaw controls
inside one private browser workspace.

## First comment draft

I built MSO because managing a personal Linux server from a phone is still more awkward than
it should be. SSH is powerful, but on mobile I kept jumping between terminal tabs, file
transfer tools, metrics dashboards, docs and AI chat.

MSO is not a Linux distribution, desktop environment or VPS provider. "OS" is the interface
metaphor: a responsive workspace over a server you already own.

It is deliberately single-owner. An authenticated session can access files and run commands
as the Linux user that owns the process, so the recommended deployment is behind Tailscale
or another tightly controlled HTTPS path. The public demo uses mock data only.

The project is Public Alpha / Developer Preview and has not had a third-party security
audit. I am looking for feedback on the core workflow before widening scope.

## Feedback questions

1. Which server task would you most want to do comfortably from your phone?
2. Is the OS-style workspace useful, or would you prefer a simpler admin dashboard?
3. Which security/deployment concern would stop you from trying it?
4. Which Linux distributions should be tested next?

## Known limitations to disclose

- Public Alpha / Developer Preview
- Single-owner, no multi-user RBAC
- No third-party security audit
- Private-network/TLS deployment strongly recommended
- Some integrations (Camoufox, Hermes/OpenClaw, MCP, model providers) are optional
