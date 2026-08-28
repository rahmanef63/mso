# 60-second demo script

> **Marketing/demo collateral, not a runtime contract.** Use a separate
> `NEXT_PUBLIC_OS_DEMO=1` build unless recording a private owner-only walkthrough.

## 0–6 sec — phone home

Open MSO on a phone and show the iOS/Android shell adapting to the viewport.

## 6–14 sec — system health

Open System Monitor: show Overview metrics, then Services status/log affordances and the read-only Updates cache. In a public demo these use mock data; in a private recording show that non-allowlisted services have no lifecycle controls.

## 14–26 sec — project files

Open Files and browse a sample project. Show one real file preview without exposing secrets.

## 26–36 sec — role boundary + Code

Briefly show Settings → Devices with Viewer / Operator / Owner, then open Code and its integrated
Terminal as Owner. Run a harmless mock/read-only command so the demo does not imply public host access.

## 36–46 sec — Alfa

Ask Alfa a simple mock diagnosis question and show a read tool/activity row. If demonstrating
a mutation in a private build, show the human Approve/Deny card rather than auto-approving.

## 46–54 sec — Browser / managed app

Show the Camoufox Browser power surface or a Hermes/OpenClaw Details panel. In a public demo,
do not expose a real logged-in browser profile or vendor credentials.

## 54–60 sec — responsive switch + CTA

Switch to desktop/landscape, then show:

```text
Open source.
Self-hosted.
Your Linux server, from any browser.
```
