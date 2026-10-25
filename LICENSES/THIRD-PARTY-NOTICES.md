# Third-party notices

MSO itself is licensed under [PolyForm Noncommercial 1.0.0](../LICENSE). This file
records the licenses of other work that MSO depends on, vendors, or mirrors. The
per-project analysis lives in [`../docs/references/`](../docs/references/README.md).

## Bundled or mirrored content

| Artifact in this repo | Upstream | License | Notice |
|---|---|---|---|
| `lib/appearance/presets/registry-data.json` | [jnsahaj/tweakcn](https://github.com/jnsahaj/tweakcn) | Apache-2.0 | [`Apache-2.0.txt`](./Apache-2.0.txt) |
| `components/ui/*` | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | MIT | copied in as application source; see [`docs/references/shadcn-ui.md`](../docs/references/shadcn-ui.md) |
| `lib/infra/provider-icons.ts` | [simple-icons/simple-icons](https://github.com/simple-icons/simple-icons) | CC0-1.0 | path data only; brand trademarks stay with their owners |
| `frontend/slices/icon-picker/lib/twemoji.ts` | [jdecked/twemoji](https://github.com/jdecked/twemoji) | MIT (code) + CC-BY 4.0 (assets) | assets hot-linked from jsDelivr, not redistributed here |

## Pinned artifacts downloaded at install time, not committed

| Runtime | Upstream | License | Pin |
|---|---|---|---|
| Camoufox browser | [daijro/camoufox](https://github.com/daijro/camoufox) | MPL-2.0 | `v156.0.1-beta.36`, SHA-256 in `scripts/camoufox-artifact.json` |
| Orca IDE | [stablyai/orca](https://github.com/stablyai/orca) | MIT | `v1.4.230`; upstream LICENSE and THIRD_PARTY_NOTICES extracted and digest-checked by `scripts/orca/asar-license.mjs` |
| 9Router | [decolua/9router](https://github.com/decolua/9router) | MIT | image digest in `security/managed-app-artifacts.env` |
| Hermes Agent | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | MIT | operator-installed |
| OpenClaw | [openclaw/openclaw](https://github.com/openclaw/openclaw) | MIT | operator-installed |
| OSV-Scanner | [google/osv-scanner](https://github.com/google/osv-scanner) | Apache-2.0 | image digest in `.github/workflows/security-core.yml` |

## Installed from npm, not vendored

`node_modules` is resolved from `bun.lock`; nothing under it is committed. The direct
dependency set is MIT, Apache-2.0, ISC and BSD. Two transitive packages ship under
LGPL-3.0-or-later (`@img/sharp-libvips-linux-x64`, `@img/sharp-libvips-linuxmusl-x64`);
they are loaded dynamically by `sharp` and are not modified or statically linked by MSO.

## Named for comparison only

Cockpit, Coolify, Portainer, Netdata, Tailscale SSH, File Browser, ttyd, CasaOS and
Runtipi appear in [`../docs/COMPARISON.md`](../docs/COMPARISON.md) as documented
competitors. None of their code is present here. See
[`docs/references/comparison-only.md`](../docs/references/comparison-only.md) for the
per-project license list, which includes GPL-3.0 projects that must not be bundled
without a compliance review.

n8n is licensed under the Sustainable Use License (fair-code). MSO bundles no n8n code
and only frames an operator-supplied instance; see
[`docs/references/n8n.md`](../docs/references/n8n.md).
