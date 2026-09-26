# Memory preservation and second-brain visibility

## Source protection

Age is not proof that a session was learned. The current preservation policy
fails closed: unreviewed, pinned and reviewed session source files remain
protected from automatic archive/artifact/action-index deletion. Review alone
is not authorization to destroy source evidence. The record model supports
review provenance, but there is no owner UI for releasing sources yet.

Compaction still archives sanitized raw context. Evicted action-index records
are stored in bounded immutable segments before leaving the hot index. Lookup
is bounded; persisted history is not a promise of an unlimited single response.

This deliberately grows storage until explicit release criteria and verified
backup coverage are available. It is not a disk reclamation mechanism.

## Cleanup

Settings > Cleanup requires an Owner session, a fresh five-minute server preview,
explicit category selection and confirmation. No category is preselected.
Broad `/tmp` age-only cleanup is blocked by the owner API. Trash and old logs
remain irreversible, and displayed estimates are not guaranteed freed bytes.
Primary session records, memory stores and volumes are not cleanup targets.

The underlying legacy Docker category still combines image and build-cache
pruning. It must not be described as build-cache-only. CLI/raw API mutations
must include the fresh `preview_id`, selected `ids`, and `confirm: true`.

## Local server-memory backup

Settings > Backup separates **Server memory backup** from **Browser backup**.
The server endpoint is owner-only. It accepts no arbitrary client source or
destination paths and never returns backed-up contents.

```bash
mso memory-backup preview
mso memory-backup history
mso memory-backup history <offset> <revision>
mso memory-backup create --confirm
mso memory-backup verify <id> <manifest-sha256> --confirm
```

The allowlist covers configured typed memory, session archives, recipes,
organization data, canonical project `.agent`/knowledge sources, and sessions.
Core memory/project evidence precede the larger session inventory. Credential
stores, browser profiles, known config/lock/temp paths are excluded. Skill
catalogs, databases and every other VPS directory are not covered by this scope.

Snapshots are private local copies under `~/.mso/backups/memory/<id>` with
compressed per-file checksums and a manifest checksum. Verification restores
into a NEW isolated directory and checks the bytes again; it never overwrites
originals. Missing sources, exclusions, rejected files and truncation are
reported. A partial snapshot remains partial after an integrity-successful
restore. Concurrent input files can change; this is a per-file verified copy,
not a transactional point-in-time snapshot, and it is not offsite protection.

Limits: 10,000 files, 40,000 scan entries, 1 GiB input, 32 MiB/file and a 45-second
scan budget. Full resumable inventory/backup remains open. History pagination
continues the saved-snapshot listing only; it does not resume backup copying.

Settings > Backup > Load saved server snapshots reads metadata in bounded pages
of 12 snapshots, at most 200 directory entries and five seconds per request.
Continuation uses a directory revision; changes require refreshing the first page.
The listing is directory order, not a promise of chronological ordering. Corrupt
metadata is shown as unreadable rather than hidden as empty. Manifest validation
requires file and byte totals to match its entries before accepting coverage.

New successful restore rehearsals write an immutable receipt bound to the manifest
checksum. History reports integrity at that recorded time, not a fresh integrity
check. Older snapshots without receipts remain "not recorded"; they are not
silently promoted or invalidated. A partial snapshot stays partial after a passing
restore. Selecting history metadata never starts restore automatically. Receipt
write failures surface as errors and preserve the isolated restore evidence.
No backup result grants deletion permission.

## Visibility and access

Workflows > Sources is owner-only discovery across graph principals. Metadata
retains origin; existing client/MCP graph reads remain principal-private. A
foreign workflow can only be copied explicitly into an inactive review draft
with action nodes disabled and its source digest preserved. Source mutations
and copying stale revisions are refused.

Session details > Self-improve fetches linked active/archived recipes, filters
best/latest-run provenance before pagination, and distinguishes errors from
empty results. Graph-cap/persistence warnings have durable receipts when the
receipt store is writable. This is not proof that every historical session was
learned or that every procedural-memory write succeeded.

Memory is pinned on the first home page. The owner projection includes bounded
Organization, workflow, recipe and typed-agent metadata, source navigation and
honest truncation notices. Private agent values are omitted. This does not
widen retrieval grants for agents, operators or MCP clients.

## Remaining integrations and release gates

Jev currently remains a Workflow Optimizer adapter, not a memory-admission
selector. Real endpoint/token verification and a separate review-first memory
admission design are required. No model may authorize evidence deletion.

New source behavior becomes active only after the normal verified build and
release process. Passing unit/type/architecture tests alone is not production
or browser acceptance. Keep tested, merged, deployed and live-verified distinct.
