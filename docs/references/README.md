# Upstream references

One file per upstream project MSO studies, compares against, or ships a pinned
artifact from. Each file states the license, the exact pin, what MSO actually
used, what MSO did **not** copy, and where the attribution lives in this repo.

This directory is a study log, not a compatibility claim. A row marked
`docs only` means the project is named in documentation and no artifact from it
is present in this repository.

## Index

| Project | License | Relation | Code copied | Status |
|---|---|---|---|---|
| [nakama](./nakama.md) | MIT | parity contract, 64 requirements | no | pinned + hashed |
| [open-silong](./open-silong.md) | MIT | memory-graph layout ideas | no | attributed in code |
| [tweakcn](./tweakcn.md) | Apache-2.0 | theme preset registry mirror | data | attributed in code |
| [n8n](./n8n.md) | Sustainable Use (fair-code) | capability map, iframe embed | no | attributed in docs |
| [camoufox](./camoufox.md) | MPL-2.0 | managed browser runtime | no | pinned + hashed |
| [orca](./orca.md) | MIT | managed IDE runtime | no | pin + license retained |
| [hermes-agent](./hermes-agent.md) | MIT | managed app, benchmark peer | no | attributed in docs |
| [openclaw](./openclaw.md) | MIT | managed app, comparison peer | no | attributed in docs |
| [9router](./9router.md) | MIT | managed app | no | pin by digest |
| [proot-distro](./proot-distro.md) | GPL-3.0 | Android runtime prerequisite | no | docs only |
| [shadcn-ui](./shadcn-ui.md) | MIT | UI primitives | yes | attributed in code |
| [twemoji](./twemoji.md) | MIT + CC-BY 4.0 | emoji CDN URLs | no | attributed in code |
| [simple-icons](./simple-icons.md) | CC0-1.0 | provider SVG paths | yes | attributed in code |
| [comparison-only](./comparison-only.md) | mixed | product comparison claims | no | docs only |

## Rules for adding a row

1. Name the license and the exact pin (commit, tag, release, or image digest).
2. Say what MSO used: idea, contract, data, or code.
3. If any byte from the upstream landed in this repo, the attribution must exist
   in the repo, not only here.
4. `docs only` rows must point at an official upstream URL in
   [`../comparison-data.json`](../comparison-data.json) so the 90-day freshness
   gate keeps the claim honest.
