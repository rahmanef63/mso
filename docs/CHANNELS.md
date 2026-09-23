# Channels

MSO Channels is the provider-neutral messaging boundary between external conversation systems and native MSO Workflows.

The first adapters are **Telegram** and **Discord**. The domain is intentionally split from Integrations:

- **Integrations** owns credential users, named provider connections, bot tokens, webhook secrets, Discord application IDs and public keys.
- **Channels** owns non-secret routing configuration: display name, provider, exact Integration reference, enabled state, default target and optional workflow binding.
- **Workflows** owns automation topology and execution. Channels does not create a second automation engine.

## Architecture

```text
Telegram / Discord
       |
       | verified provider-native inbound request
       v
/api/v1/channels/<provider>/<channel-id>
       |
       v
lib/channels
  ├─ provider registry
  ├─ metadata-only channel store
  ├─ Telegram adapter
  ├─ Discord adapter
  └─ workflow dispatcher
       |
       v
native Workflow Graph
  Channel Trigger -> ... -> Channel Send
```

The private channel store lives under `~/.mso/private/channels.json` by default. It contains no credential values.

## Telegram

A Telegram Integration connection stores:

- `botToken` — secret, required.
- `webhookSecret` — secret, optional for outbound-only usage and required by MSO before accepting inbound webhook events.

Credential verification calls Bot API `getMe`. Outbound text uses `sendMessage`.

Inbound URL:

```text
https://<mso-host>/api/v1/channels/telegram/<channel-id>
```

Configure Telegram to send the exact configured webhook secret through `X-Telegram-Bot-Api-Secret-Token`. MSO refuses inbound Telegram delivery when no webhook secret is configured.

## Discord

A Discord Integration connection stores:

- `botToken` — secret, required for REST sends.
- `applicationId` — non-secret, optional for outbound-only usage and recommended for inbound binding.
- `publicKey` — non-secret Ed25519 Interactions public key, required for inbound Interactions.

Credential verification calls Discord REST `/api/v10/users/@me` with Bot authorization. Outbound text posts to `/api/v10/channels/<channel-id>/messages`.

Inbound Interactions URL:

```text
https://<mso-host>/api/v1/channels/discord/<channel-id>
```

MSO verifies `X-Signature-Ed25519` over `X-Signature-Timestamp + rawBody`, supports Discord PING/PONG, and normalizes supported interaction payloads into the shared inbound event contract.

**Discord Gateway message ingestion is not implemented or claimed.** Channels currently supports Discord REST sending plus signed HTTP Interactions.

## Workflow integration

Native Workflow Graph exposes two provider-neutral node types:

- **Channel Trigger** — root trigger for a channel-bound workflow.
- **Channel Send** — sends text through an existing Channel record.

A Channel may reference one active workflow. The workflow must contain a Channel Trigger that either names that Channel ID or leaves `channelId` empty as the workflow's fallback Channel Trigger.

Inbound events enter Workflow input as:

```json
{
  "channel": {
    "id": "<channel-id>",
    "name": "<display-name>",
    "provider": "telegram | discord"
  },
  "event": {
    "provider": "telegram | discord",
    "eventId": "<provider-event-id>",
    "kind": "<normalized-kind>",
    "target": "<optional-target>",
    "sender": "<optional-sender>",
    "text": "<optional-text>",
    "receivedAt": "<iso-time>"
  }
}
```

Raw provider payloads are not copied into the workflow input receipt.

## Security boundaries

- No bot token or webhook secret is accepted by the Channels CRUD API or stored in channel state.
- Channel creation/update resolves the exact existing direct Integration connection before saving.
- Owner session is required for Channels list/create/update/delete/test/send.
- Public inbound endpoints are provider-authenticated instead of owner-session authenticated.
- Inbound routes apply untrusted rate limits before expensive payload verification.
- Channel activity and health checks do not advance configuration revision, so inbound traffic cannot invalidate an owner's pending edit.
- Provider response bodies and credentials are not returned by doctor/test responses.
