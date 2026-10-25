# Comparison-only references

Projects named in [`../COMPARISON.md`](../COMPARISON.md) and
[`../comparison-data.json`](../comparison-data.json) to position MSO honestly. None
of their code is present in this repository. Every claim cites an official upstream URL
and is re-reviewed under a 90-day freshness gate enforced by
`node scripts/gen-comparison.mjs --check`.

| Project | License | MSO use |
|---|---|---|
| [Cockpit](https://cockpit-project.org/) | mixed (LGPL-2.1 / GPL-3.0 / MIT / BSD-3 / CC-BY-SA-3.0 per component, see upstream `LICENSES/`) | comparison row only |
| [Coolify](https://coolify.io/docs) | Apache-2.0 | comparison row only |
| [Portainer](https://docs.portainer.io/) | zlib | comparison row only |
| [Netdata](https://learn.netdata.cloud/) | GPL-3.0 | comparison row only |
| [Tailscale SSH](https://tailscale.com/docs/features/tailscale-ssh) | BSD-3-Clause | comparison row only |
| [File Browser](https://github.com/filebrowser/filebrowser) | Apache-2.0 | comparison row only |
| [ttyd](https://github.com/tsl0922/ttyd) | MIT | comparison row only |
| [CasaOS](https://github.com/IceWhaleTech/CasaOS) | Apache-2.0 | comparison row only |
| [Runtipi](https://runtipi.io/) | GPL-3.0 | comparison row only |

## Why this file exists

A comparison table is commentary, not derivation: naming a GPL project and describing
its documented behaviour creates no obligation. It would change the moment MSO embedded
or redistributed one of these. If that ever happens, the project moves out of this file
into its own reference with the full license analysis.

## Also named for standards, not code

| Standard | Use |
|---|---|
| [MCP Apps (`modelcontextprotocol/ext-apps`)](https://github.com/modelcontextprotocol/ext-apps) | wire contract followed in [`../integrations/CHATGPT-UI.md`](../integrations/CHATGPT-UI.md); no helper code vendored |
| [Next.js](https://github.com/vercel/next.js) | framework, MIT, installed from npm |
| [Bun](https://github.com/oven-sh/bun) | runtime, installed from its own release channel |
| [OSV-Scanner](https://github.com/google/osv-scanner) | CI vulnerability scan, pinned by image digest in `security-core.yml` |
