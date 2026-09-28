# Connected applications

MSO is the shell and control surface. Connected applications run in their own services; adding or disconnecting a shell entry does not install, stop, or delete a service or its data. This implementation has no dependency on manef-ui or manef-db.

## Owner journey

Open App Store → Apps. Managed applications use the existing reviewed Hermes, OpenClaw and 9Router setup panels and their host preflight checks. For an already running external or custom tool, select Connect app, enter its name, stable ID and address, and choose an embedded window or separate tab. Entries persist on the server and appear in the shell without a rebuild. Edit updates the connection; Disconnect removes only the shell entry.

A subdomain is optional. HTTPS addresses can be embedded when the application permits framing. HTTP addresses open in a separate tab. Applications retain their own login. Addresses sharing the MSO session-cookie scope are rejected, including the same hostname on another port. Query strings, URL credentials and fragments are rejected; enter secrets only through the application's trusted setup flow.

## Current API and lifecycle

Owner-only `GET /api/v1/shell-apps` returns schemaVersion 1, a revision, configurability and app views. `POST` accepts schemaVersion 1, action add/update/remove/import, expectedRevision, confirm true, and app metadata or the removed ID. App metadata contains id, title, description, url and mode (embed/tab). Concurrent updates return conflict and require a fresh review. The CLI exposes `mso mapp shell-list` and `mso mapp shell-save @request.json`.

Entries share the surface registry, its atomic locking, 16-entry/16-KiB limits and environment-managed read-only mode. Shell placement never grants MCP Page access. New shell entries cannot overwrite Workflow or Page entries. Legacy local HTML manifests must resolve to a reviewed shell connection before rendering. The shared iframe renderer is also used by n8n.

## Portable manifest import

App Store → Apps → Import manifest accepts a local JSON file or pasted JSON, up to 8 KiB. The next form shows publisher/version and asks for the instance ID and URL. Review and Connect applies the server mutation; selecting or reviewing a file has no side effect. A manifest can be reused for several installations with different instance IDs. Publisher names are self-declared, not verified provenance. Original manifest metadata is retained separately from editable connection metadata and shown after reload.

The implemented connected-app profile is `urn:mso:connected-app:v1`. It is intentionally smaller than the proposed general feature definition: schemaVersion 1, id, semantic version, title, description, publisher and presentation (`embed`/`tab`). All fields are required; unknown fields and schema versions are rejected. IDs are at most 64 lowercase letters/digits/hyphens; title/publisher are at most 120 characters, description 240, version 128. Metadata is plain text. The starter file is [`templates/connected-app/manifest.json`](../templates/connected-app/manifest.json); the shared browser/server validator is `lib/contracts/connected-app-manifest.ts`.

Endpoints belong to bindings and never to this portable manifest. It cannot declare commands, imports, environment variables, secrets, MCP grants, native components or shell slots. Schema v1 identifies the supported connection API; the manifest's semantic version identifies developer metadata, not the running service version. Imports do not fetch remote documents or verify package signatures, dependencies or application health.

The existing Owner-only POST and `mso mapp shell-save @request.json` also accept:

```json
{
  "schemaVersion": 1,
  "action": "import",
  "expectedRevision": "revision-from-shell-list",
  "confirm": true,
  "manifest": {
    "schema": "urn:mso:connected-app:v1",
    "schemaVersion": 1,
    "id": "custom-editor",
    "version": "1.0.0",
    "title": "Custom editor",
    "description": "Open a running editor",
    "publisher": "Your project",
    "presentation": "embed"
  },
  "binding": { "id": "editor-home", "url": "https://editor.example.test/", "mode": "embed" }
}
```

Binding mode is explicit: the UI initializes it from presentation and lets the Owner choose a separate tab. Import reuses the same revision lock, duplicate-ID checks, cookie isolation, capacity limits and explicit confirmation as manual connections. Edits preserve the original manifest while changing instance metadata. Disconnect removes the binding and its manifest copy, leaving the external service untouched. Existing entries require no migration.

## Remaining migration

This is the first implemented registry path, not the complete [external feature target contract](./EXTERNAL-FEATURE-CONTRACT.md). Native shell features still ship with MSO. The remote manef.dev catalog, generic install recipes, generic domain provisioning, feature extraction and independent package releases remain future work. Connecting an arbitrary URL does not imply an installer, health check, SSO or AI tool grant. Existing Managed Apps retain their separate reviewed runtime and proxy boundaries.
