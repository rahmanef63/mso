# Frontend audit implementation ledger, 2026-11-04

This ledger covers the existing 55 finding groups (8 P1, 47 P2), not an assertion that every application or possible resolution has passed acceptance. The earlier implementation is on main via PR #270. This follow-up closes the remaining source gaps and adds regression evidence. Implementation present and journey verified are separate claims.

Ownership follows [the frontend contract](../FRONTEND-CONTRACT.md): shell owns presentation and inherited metrics; each feature owns data, scope and draft lifetime; the UI kit owns shared controls and dialogs. No shell forks provider authorization or durable data.

| Finding | Original observation | Implemented behavior | Detailed evidence |
|---|---|---|---|
| SH-01 (P1) | Tab Image Picker tidak dapat dipindahkan dengan keyboard | Roving Arrow/Home/End tab navigation and unique panel IDs. | [scope and limits](2026-11-04-final-shell.md) |
| SH-02 (P1) | Pemilih berkas Upload tidak mempunyai pintu masuk keyboard | Native Choose file button reaches the hidden file input. | [scope and limits](2026-11-04-final-shell.md) |
| SH-03 (P2) | Clipboard menyatakan sukses walaupun write ditolak/tidak tersedia | Clipboard result awaited; rejected writes retain manual-copy recovery. | [scope and limits](2026-11-04-final-shell.md) |
| SH-04 (P2) | Link gambar gagal tetap diterima sebagai gambar valid | Image link checked for load/error/timeout with request identity. | [scope and limits](2026-11-04-final-shell.md) |
| SH-05 (P2) | Palet Icon Picker terpotong di coarse pointer | Palette wraps coarse-pointer swatches and expandable pills. | [scope and limits](2026-11-04-final-shell.md) |
| SH-06 (P2) | Config lebar sidebar React belum dikonsumsi shared rail | Shared sidebar consumes inherited feature width token. | [scope and limits](2026-11-04-final-shell.md) |
| SH-07 (P2) | State navigasi/draft Settings belum mengikuti identitas window | Exact-window Settings/form state, sensitive in-memory drafts, save/discard/close/navigation guards and ordered auth cleanup. | [scope and limits](2026-11-04-final-shell.md) |
| SH-08 (P2) | Overlay shortcut/clipboard belum memiliki modal focus boundary | Shared modal boundary, native drawer autofocus, keyboard containment and opener restoration. | [scope and limits](2026-11-04-final-shell.md) |
| SH-09 (P2) | Aksi Pin/Remove clipboard hanya muncul saat hover | Clipboard controls visible for keyboard focus and coarse pointers. | [scope and limits](2026-11-04-final-shell.md) |
| SH-10 (P2) | Icon Picker fallback dialog tidak diberi judul aksesibel | Icon picker dialog has an accessible name. | [scope and limits](2026-11-04-final-shell.md) |
| SH-11 (P2) | Kegagalan memuat theme presets menjadi panel kosong tanpa recovery | Preset error/retry UI and rejected registry promise reset. | [scope and limits](2026-11-04-final-shell.md) |
| SH-12 (P2) | Close target Dialog UI kit belum mengikuti minimum touch44 | Coarse close targets use 44px geometry with title clearance. | [scope and limits](2026-11-04-final-shell.md) |
| AD-01 (P1) | Membuka form Alfa membongkar chat dan menghapus identitas/history percakapan lokal | Chat remains mounted while its form is visible. | [scope and limits](2026-11-04-final-agents.md) |
| AD-02 (P1) | Channels dan Agent groups dapat menyimpan draft lama dengan revision snapshot yang sudah baru | Editors submit the original captured CAS revision and retain conflicting drafts. | [scope and limits](2026-11-04-final-agents.md) |
| AD-03 (P1) | Workflows: Duplicate, copy dari Sources dan restore versi dapat mengganti draft dirty tanpa keputusan | Dirty decisions precede replacement; source copy/restore share the action lock and protect later edits. | [scope and limits](2026-11-04-final-agents.md) |
| AD-04 (P2) | Delete Organization langsung, tanpa status pending dan jalur error yang ditangkap editor | Named Organization confirmation with pending and error state. | [scope and limits](2026-11-04-final-agents.md) |
| AD-05 (P2) | Workflow variables: aksi hapus tanpa label, konfirmasi, pending atau catch | Named variable actions, confirmation, pending and caught errors. | [scope and limits](2026-11-04-final-agents.md) |
| AD-06 (P2) | Shared Alfa form Field hanya teks visual, tidak mengasosiasikan label/hint dengan input | Shared form labels and hint associations. | [scope and limits](2026-11-04-final-agents.md) |
| AD-07 (P2) | Memory graph mempunyai keyboard node-open, tetapi belum parity selection dan viewport controls | Memory selection and viewport pan/zoom/fit controls support keyboard. | [scope and limits](2026-11-04-final-agents.md) |
| AD-08 (P2) | Memory graph menampilkan “No notes yet” untuk hasil search/filter kosong | No search matches is distinct from an empty note collection. | [scope and limits](2026-11-04-final-agents.md) |
| AD-09 (P2) | Memory dan Agent Vault bergantung pada localStorage yang tidak diguard | Memory/Vault catch unavailable or failing browser storage. | [scope and limits](2026-11-04-final-agents.md) |
| AD-10 (P2) | Draft baru Channels/groups dihapus diam-diam bila revision berubah di background | New editor draft identity survives background snapshot refresh; cancel asks about dirtiness. | [scope and limits](2026-11-04-final-agents.md) |
| AD-11 (P2) | Organization Unit/Seat actions menjadi ikon tanpa nama di panel sempit | Narrow Organization actions retain accessible names. | [scope and limits](2026-11-04-final-agents.md) |
| AD-12 (P2) | Member editor Agent groups tidak mempunyai label yang persisten dan select credential tak bernama | Member editor labels and credential fieldsets remain named. | [scope and limits](2026-11-04-final-agents.md) |
| WS-01 (P1) | Code: Save & Close tetap menutup saat penulisan host gagal | Failed writes veto Save & Close and keep the draft. | [scope and limits](2026-11-04-final-workspace.md) |
| WS-02 (P1) | Code: Guard window hanya melihat tab aktif, sehingga draft tab lain tidak dilindungi | All dirty tabs participate in the exact-window close guard. | [scope and limits](2026-11-04-final-workspace.md) |
| WS-03 (P1) | Video Editor: Status Saved ditampilkan meski autosave gagal atau media upload tidak dapat dipulihkan | Failed storage is not Saved; transient media warns and supports relinking. | [scope and limits](2026-11-04-final-workspace.md) |
| WS-04 (P2) | Image Editor: Autosave dokumen host tidak memeriksa HTTP/error dan tidak memberi status/retry | Serialized project writes, failure/retry, flush-before-image-save and revision-aware dirty acknowledgement. | [scope and limits](2026-11-04-final-workspace.md) |
| WS-05 (P2) | Preview: File baru dari Files dapat diabaikan setelah pengguna pernah paging | New payload identity supersedes paged preview state. | [scope and limits](2026-11-04-final-workspace.md) |
| WS-06 (P2) | Preview: Tombol panah global memindahkan file meski fokus ada pada aplikasi lain | Preview arrow handling is limited to the focused window. | [scope and limits](2026-11-04-final-workspace.md) |
| WS-07 (P2) | Finder/Files: Virtualisasi 28 px bertentangan dengan row sentuh minimum 44 px | Virtualizer and coarse row geometry agree at 44px. | [scope and limits](2026-11-04-final-workspace.md) |
| WS-08 (P2) | Code: Tab file hanya div dengan klik, tidak bisa dipilih sebagai tab melalui keyboard | Code tab roles and roving keyboard selection. | [scope and limits](2026-11-04-final-workspace.md) |
| WS-09 (P2) | Finder/Files iOS: Search memakai teks 14 px dan close target sekitar 14 px tanpa fokus yang terlihat | 16px iOS search input and coarse close/focus treatment. | [scope and limits](2026-11-04-final-workspace.md) |
| WS-10 (P2) | Terminal/Claude: Kegagalan POST input diam-diam membuang ketikan tanpa status kegagalan | HTTP/network input failures halt uncertain delivery without replay. | [scope and limits](2026-11-04-final-workspace.md) |
| WS-11 (P2) | Image Editor: Resize panel mobile hanya pointer, tanpa keyboard/semantik atau pointer-cancel cleanup | Keyboard separator operation and pointer-cancel cleanup. | [scope and limits](2026-11-04-final-workspace.md) |
| WS-12 (P2) | Video Editor: Import browser dapat menerima respons folder lama dan awal loading tidak ditandai | Import response identity, initial loading and retry. | [scope and limits](2026-11-04-final-workspace.md) |
| WS-13 (P2) | Video Editor: Render tidak dibatalkan/URL dibersihkan saat fitur unmount | Export abort, activity generation and object URL cleanup. | [scope and limits](2026-11-04-final-workspace.md) |
| PX-01 (P2) | Dokploy / Cloudflare: Refresh dapat ditimpa respons request lama | Superseded Infrastructure reads abort and cannot publish. | [scope and limits](2026-11-04-final-surfaces.md) |
| PX-02 (P2) | Dokploy / Cloudflare: Loading, error, empty dan tombol Refresh belum jelas | Infrastructure loading/error/empty/stale and retry states are distinct. | [scope and limits](2026-11-04-final-surfaces.md) |
| PX-03 (P2) | Integrations / Composio: Panel Composio tidak mengikuti owner/connection yang dipilih manager | Manager owner and explicit connection bind UI requests and server cache to authorized credential identity/revision. | [scope and limits](2026-11-04-final-surfaces.md) |
| PX-04 (P2) | Create App: Label form visual tidak terhubung ke kontrol | Create App input labels are associated. | [scope and limits](2026-11-04-final-surfaces.md) |
| PX-05 (P2) | Create App: Palet Accent tidak reflow setelah target sentuh diperbesar | Accent controls reflow with coarse geometry and expose selection. | [scope and limits](2026-11-04-final-surfaces.md) |
| PX-06 (P2) | Create App: Draft form tidak mempunyai lifetime window/guard discard | Create App draft has exact-window lifetime and discard guard. | [scope and limits](2026-11-04-final-surfaces.md) |
| PX-07 (P2) | n8n: Kegagalan Refresh sesudah data tersedia tidak terlihat | n8n refresh failures identify retained content as stale. | [scope and limits](2026-11-04-final-surfaces.md) |
| PX-08 (P2) | System Monitor: Telemetry lama tetap tampak sehat setelah polling gagal | Monitor identifies stale telemetry and superseded polls cannot overwrite it. | [scope and limits](2026-11-04-final-surfaces.md) |
| SH-13 (P2) | Image Picker: file pengganti invalid tetap meninggalkan file lama siap diunggah | Invalid replacement clears the previous accepted upload. | [scope and limits](2026-11-04-final-shell.md) |
| SH-14 (P2) | Desktop icons: tombol hanya bereaksi pada double-click, bukan Enter/Space | Keyboard activation opens desktop icons; Delete is scoped to desktop focus. | [scope and limits](2026-11-04-final-shell.md) |
| WSC-01 (P2) | Video: tab browser lain dapat menimpa recovery draft yang lebih baru | Draft conflict baseline captured during the same initial read; concurrent storage changes cannot be silently adopted. | [scope and limits](2026-11-04-final-workspace.md) |
| WSC-02 (P2) | Preview: Download/Open in editor tidak memakai isi sample yang ditampilkan | Sample actions use displayed bytes; unsupported byte-dependent actions are withheld. | [scope and limits](2026-11-04-final-workspace.md) |
| WF-02 (P2) | Workflows: Delete tidak meminta keputusan untuk target dan draft | Workflow deletion names the target and asks about unsaved state, under the action lock. | [scope and limits](2026-11-04-final-agents.md) |
| AC-01 (P2) | Channels/groups: response refresh lama dapat menggantikan snapshot terbaru | Only the newest Channels/group refresh generation can publish. | [scope and limits](2026-11-04-final-agents.md) |
| ST-01 (P2) | Store/Create/Shell features: storage gagal tetapi state terlihat berhasil tersimpan | Browser registry commits persistence before publishing success and reports failures. | [scope and limits](2026-11-04-final-surfaces.md) |
| ST-02 (P2) | Skills: respons reload lama dapat menggantikan katalog terbaru | Skills catalog publishes a coherent generation and serializes mutations. | [scope and limits](2026-11-04-final-surfaces.md) |
| ST-03 (P2) | External app frame: load selesai meskipun embedding ditolak | External iframe load is not asserted as readiness; visible Open and recovery guidance remain available. | [scope and limits](2026-11-04-final-surfaces.md) |
| PX-09 (P2) | Integrations: daftar Composio panjang menghilangkan ruang manager | Composio tool disclosure is capped and scrolls internally. | [scope and limits](2026-11-04-final-surfaces.md) |

## Investigations and limits

WF-01 is grouped under AD-03. SH-C01 desktop Delete scope is guarded under SH-14. WSC-03 null/throwing image export and WSC-04 superseded/unmounted Camoufox operations received defensive fixes; their actual canvas/noVNC journeys remain acceptance limits. AD-13 managed upstream readiness is unknown without a vendor handshake. ST-I01 blocked-domain correction, ST-I02 successful mutation followed by failed refresh, and ST-I03 system-monitor no-match remain distinguished from proven implementation defects; the no-match UI is present. Do not turn these into fabricated security or upstream success claims.

Cross-origin frame readiness cannot be proven by iframe load. Browser teardown can interrupt writes. Unsaved operational drafts are not durable after a reload; transient media uploads require relinking. Terminal failure reports uncertain delivery and never blindly resends potentially executed input.

## Integration evidence

Per-agent records list focused tests, mocked component receipts and remaining manual checks. Shared-shell fixtures used five shells, two themes and 320/390/844 landscape samples, with previously compiled CSS; they do not replace the current-build browser gate. Physical devices, assistive technology and real upstream credentials are outside those fixtures. Required local, pinned security and remote checks must be recorded for the final committed SHA before readiness or merge is asserted.

Rollback: revert the incremental audit commits through an ordinary reviewed PR. No live deployment, tunnel, runtime state or credential store was modified by this audit work.
