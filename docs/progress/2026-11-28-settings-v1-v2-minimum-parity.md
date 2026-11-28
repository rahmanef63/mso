# MSO Settings: minimum upgrade parity

Baseline: known-good Next.js checkpoint `32878c4d`. Svelte/Rust comparison:
`77589db4`, plus the manual updater candidate in this branch. This is a source audit,
not a claim that every journey has passed on a deployed build.

| v1 Settings capability | v2 source status | Upgrade acceptance |
| --- | --- | --- |
| Update MSO: local & remote versions, manual check, update/restart, rebuild, outcome and build log | Manual write paths missing on baseline; restored in this branch using the existing updater. Auto-update & channel already live under System & Storage. Changelog remains under About. | Owner confirms the exact operation; viewers and demo must not be able to start it. Test refusal, polling through a restart, failure, and final build readback with an isolated fixture. Existing CLI recovery stays available. |
| Account name/password and Devices/pairing | Account & Device and device management surfaces exist. | Paired/Owner access survives; test pairing/revoking a disposable device and password flow on a disposable instance. |
| Appearance, Theme, Quicklinks, AI providers, MCP, Cleanup, About | Corresponding Svelte screens exist. Presence is not verified parity of each action. | Verify preferences persist after reload, integration connection and read-only MCP operation still work, cleanup preview is non-destructive, and build/changelog match. |
| Browser backup import/export | No equivalent found in v2 Settings. Memory snapshots back up server memory, not v1 browser layout/apps/icons/wallpapers/playbooks/agents/automations. | Preserve old browser state. Before clearing or migrating it, verify import/export round trip on a disposable browser profile. Never copy device approval. |
| A2A peers, inbound policy and activity | No equivalent found in v2 Settings. System federation status is not peer management. | Trace each v1 operation onto the current backend and verify peer list, inbound policy and activity on test fixtures. |

Do not call v1 parity shipped until the protections, the settings journeys above, and the
upgrade smoke from the previous release pass. On production verify build health and
read-only journeys first; do not exercise a real update, restore or password rotation
as a smoke check.
