# Svelte T3 Code workspace

The Svelte shell had a T3 entry in Managed Apps but no workspace launcher.
This change adds a Dock/launcher/command/deep-link entry for Operator and Owner.
It does not provision an environment and leaves the managed adapter unchanged.

The official T3 Connect iframe is opt-in and uses a fixed HTTPS URL and sandbox.
A direct browser link remains available when T3 or the browser refuses embedded
sign-in. The separate managed dashboard link uses only the existing read API and
appears for a running app with an HTTPS dashboard URL.

Verification uses a synthetic T3 document and a denied-frame fixture, plus
Viewer deep-link denial and the mobile managed-API unavailable state.
Production sign-in and existing T3 environment connectivity require a normal
owner browser session and are not established by the fixture.
