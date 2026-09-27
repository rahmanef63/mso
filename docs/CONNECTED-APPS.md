# Connected applications

MSO is the shell and control surface. Connected applications run in their own services; adding or disconnecting a shell entry does not install, stop, or delete a service or its data. This implementation has no dependency on manef-ui or manef-db.

## Owner journey

Open App Store → Apps. Managed applications use the existing reviewed Hermes, OpenClaw and 9Router setup panels and their host preflight checks. For an already running external or custom tool, select Connect app, enter its name, stable ID and address, and choose an embedded window or separate tab. Entries persist on the server and appear in the shell without a rebuild. Edit updates the connection; Disconnect removes only the shell entry.

A subdomain is optional. HTTPS addresses can be embedded when the application permits framing. HTTP addresses open in a separate tab. Applications retain their own login. Addresses sharing the MSO session-cookie scope are rejected, including the same hostname on another port. Query strings, URL credentials and fragments are rejected; enter secrets only through the application's trusted setup flow.

## Current API and lifecycle

Owner-only `GET /api/v1/shell-apps` returns schemaVersion 1, a revision, configurability and app views. `POST` accepts schemaVersion 1, action add/update/remove, expectedRevision, confirm true, and app metadata or the removed ID. App metadata contains id, title, description, url and mode (embed/tab). Concurrent updates return conflict and require a fresh review. The CLI exposes `mso mapp shell-list` and `mso mapp shell-save @request.json`.

Entries share the surface registry, its atomic locking, 16-entry/16-KiB limits and environment-managed read-only mode. Shell placement never grants MCP Page access. New shell entries cannot overwrite Workflow or Page entries. Legacy local HTML manifests must resolve to a reviewed shell connection before rendering. The shared iframe renderer is also used by n8n.

## Remaining migration

This is the first implemented registry path, not the complete [external feature target contract](./EXTERNAL-FEATURE-CONTRACT.md). Native shell features still ship with MSO. The remote manef.dev catalog, generic install recipes, generic domain provisioning, feature extraction and independent package releases remain future work. Connecting an arbitrary URL does not imply an installer, health check, SSO or AI tool grant. Existing Managed Apps retain their separate reviewed runtime and proxy boundaries.
