# How to use MSO MCP

Panduan praktis berbahasa Indonesia: hubungkan AI ke MSO, jalankan tugas pertama,
dan periksa masalah koneksi. Untuk instalasi MSO, mulai dari [README](../README.md).
Nilai `mso.example.com`, `example-project`, dan `<workflow-id>` hanyalah placeholder.

## 1. Pilih arah koneksi

| Menu di Settings → MCP | Arah dan fungsi |
|---|---|
| **Access MSO** | ChatGPT/Codex/klien lain → MSO. Gunakan untuk mengelola server dan proyek melalui AI. |
| **MSO Access** | MSO → layanan eksternal. Registry plugin dan koneksi proyek tidak otomatis memberikan izin ke layanan tersebut. |
| **Sessions** | Lihat sesi, aktivitas, dan informasi handover; bukan pengaturan scope token. |

SI-Coder adalah **plugin opsional MSO**, bukan server MCP utama atau syarat memakai MSO.
Menambahkan manifest ke **Plugins / Registry** hanya menyimpan deklarasi di browser;
itu tidak menginstal kode, mengaktifkan koneksi, atau membuat credential.

## 2. Siapkan MSO

Masuk ke MSO dengan perangkat Owner yang sudah disetujui. Buka
**Settings → MCP → Access MSO → Connection details** untuk URL dan pemeriksaan koneksi.
Klien cloud membutuhkan origin HTTPS stabil yang dapat dijangkau, bukan localhost
atau URL Quick Tunnel sementara. [Panduan instalasi dan HTTPS](./INSTALL.md).

Instalasi baru mengisi `OS_MCP_ENABLED=1` dan `OS_MCP_MAX_SCOPE=exec`.
Update mempertahankan `.env.local` lama. MCP yang dinonaktifkan atau mode demo menghasilkan 404.
Untuk membatasi instalasi menjadi observasi saja, ubah **dua nilai terkait saja** di `.env.local`:

```dotenv
OS_MCP_ENABLED=1
OS_MCP_MAX_SCOPE=read
```

Jangan mengganti seluruh `.env.local`. Terapkan perubahan melalui **Settings → About**
atau `mso update --rebuild`, lalu ulangi otorisasi bila scope koneksi perlu berubah.

| Scope | Pemakaian |
|---|---|
| `read` | Status, daftar proyek, dan pembacaan yang dibatasi. |
| `write` | Semua kemampuan read ditambah perubahan terbatas. |
| `exec` | Semua kemampuan write ditambah shell dan eksekusi/delegasi proyek. |

`OS_MCP_MAX_SCOPE` adalah batas maksimum; izin token aktual tetap diperiksa pada setiap call.
Pilih scope sesuai tugas: jangan menyebut seluruh MSO read-only hanya karena satu call ditolak.
`exec` dapat menjalankan perintah sebagai user layanan MSO; jangan berikan tanpa kebutuhan.

## 3. Hubungkan klien

### ChatGPT

1. Di MSO, pilih **Access MSO → Connect an app → ChatGPT** dan salin Server URL.
2. Aktifkan Developer Mode di ChatGPT bila diperlukan. Dokumentasi OpenAI saat ditinjau
   memakai **Settings → Security and login**, lalu **Plugins → +**; workspace lama bisa
   menampilkan Apps/Create. Izin admin workspace tetap berlaku.
3. Buat app MCP dengan URL **`https://mso.example.com/mcp`**, transport **Streamable HTTP**,
   dan autentikasi **OAuth**. Gunakan domain instalasi sendiri, bukan `/api/mcp` atau `/sse`.
4. Selesaikan login/consent pada domain MSO dan pilih scope minimum. Gunakan discovery/DCR
   bila tersedia; untuk form Client ID manual, MSO mendukung `chatgpt-mso` tanpa client secret.
   Jangan memasukkan password MSO sebagai client secret dan jangan memilih No Authentication.
5. Scan/refresh tools, simpan/publikasikan sesuai UI workspace, lalu aktifkan MSO pada percakapan.
6. Uji dengan `@MSO tolong cek status VPS tanpa mengubah apa pun`.

`@MSO` adalah nama app yang dipilih; penyebutan nama saja bukan bukti koneksi berhasil.
Bukti awal adalah tool benar-benar dipanggil dan mengembalikan hasil, bukan jawaban tebakan AI.
Lihat [referensi ChatGPT](./CHATGPT-PLUGIN.md) untuk detail OAuth dan refresh.

### Codex dan Claude Code

Gunakan terminal lokal milik pengguna setelah mengganti domain contoh:

```bash
# Codex: tambahkan server, lalu login OAuth
codex mcp add mso --url https://mso.example.com/mcp
codex mcp login mso

# Claude Code: tambahkan server dan periksa konfigurasinya
claude mcp add --transport http mso https://mso.example.com/mcp
claude mcp get mso
```

Di Claude Code, buka `/mcp` untuk menyelesaikan OAuth. Status dari `get` belum membuktikan
izin setiap tool; tetap uji satu operasi read untuk membuktikan akses. Untuk Cursor, Gemini CLI,
VS Code, atau klien lain, pilih klien tersebut di **Connect an app** agar mendapat konfigurasi
sesuai instalasi. Jangan menaruh bearer/password di config bersama atau argumen shell.

## 4. Mulai dengan tugas nyata

Ganti `example-project` dengan nama/ID yang benar-benar dikembalikan MSO.

| Tujuan | Contoh prompt |
|---|---|
| Status server | `@MSO cek CPU, RAM, disk, dan service yang bermasalah. Jangan ubah apa pun.` |
| Pilih proyek | `@MSO tampilkan proyek yang tersedia agar saya bisa memilih target.` |
| Baca dokumentasi | `@MSO baca README proyek example-project dan ringkas cara menjalankannya.` |
| Ubah dokumentasi | `@MSO tambahkan panduan MCP ke example-project. Periksa aturan repo, jaga perubahan sesi lain, lalu validasi tautan.` |
| Diagnosis akses | `@MSO periksa scope, tool yang tersedia, dan error sebenarnya. Jangan ubah credential atau izin untuk menutupi error.` |

Sebutkan hasil yang diinginkan, proyek, batas perubahan, dan cara verifikasi.
Scope `write` tidak menjamin shell tersedia; menjalankan shell/test melalui `exec_run`
atau memanggil MCP proyek memerlukan `exec`. Prompt tidak bisa menaikkan scope token.

## 5. Urutan tool untuk agent

Untuk satu pembacaan sederhana, gunakan tool read yang sesuai. Untuk tugas multi-langkah:

```text
workflow_start (sekali) → inspeksi target → perubahan yang diizinkan
→ verifikasi hasil → workflow_finish
```

`workflow_start` sudah mencari skill/konteks yang relevan; jangan mengulang `skills_search`
sebelumnya untuk tugas sama. Contoh argumen bootstrap:

```json
{
  "intent": "Periksa dokumentasi MCP proyek example-project tanpa mengubah file",
  "project": "example-project",
  "constraints": "Read-only; jangan restart service atau membuka credential"
}
```

Simpan ID workflow dari respons. **Kirim ID persis itu sebagai `workflow_id` pada setiap
operasi berikutnya**, bukan ID sesi/job atau ID workflow percakapan lain. Contoh `project_get`:

```json
{
  "project": "example-project",
  "workflow_id": "<workflow-id>"
}
```

Periksa hasil sesuai tugas: file/diff untuk perubahan dokumen, test/build untuk kode,
dan health/version untuk deployment. `workflow_finish` menerima `workflow_id`, `summary`,
`success`, serta `evidence` terstruktur. Gunakan `success: true` hanya setelah hasil terbukti;
catat kegagalan/risiko dengan jujur, atau gunakan `workflow_cancel` untuk pekerjaan yang dibatalkan.

Jangan salin daftar atau jumlah tool secara manual ke instruksi. Gunakan
[katalog otomatis](./generated/MCP-CATALOG.md) untuk referensi dan `tools/list` terautentikasi
untuk izin aktual. `GET /mcp` menunjukkan identitas versi/hash deployment, bukan bukti token berfungsi.

## 6. Pakai MCP milik proyek melalui MSO

Koneksi masuk ke MSO tidak otomatis mengotorisasi akses ke layanan lain.
Di **Integrations → Add MCP**, simpan endpoint HTTPS dan credential downstream lewat form privat;
pilih pemilik credential serta koneksi yang tepat. Jangan mengirim token lewat chat.
Registry plugin saja tidak cukup. [Kontrak koneksi privat](./PROJECT-MCP-CONNECTIONS.md).

```text
projects_list → pilih proyek persis
→ project_capabilities(project) → pilih alias server dari hasil
→ project_mcp_tools(project, server) → baca schema tool
→ project_mcp_call(project, server, tool, arguments)
```

Ini urutan konseptual, bukan JSON siap kirim; sertakan `workflow_id` untuk setiap langkah
bila sedang dalam workflow. Ikuti `nextCursor` dengan parameter `cursor` sampai habis.
Discovery/call MCP proyek memerlukan `exec`; layanan tujuan tetap memeriksa izinnya sendiri.
Jangan menebak nama tool/argumen, memakai token MSO sebagai token downstream, atau memindahkan
credential lintas pemilik. Tool proyek tetap dinamis, bukan tambahan nama global di MSO.

## 7. Troubleshooting dan pemeliharaan

| Gejala | Pemeriksaan dan langkah berikutnya |
|---|---|
| `/mcp` atau discovery 404 | Pastikan domain/path benar, MCP aktif di proses berjalan, dan bukan demo. Cek `mso doctor`. |
| Login OAuth gagal | Periksa HTTPS, perangkat Owner, redirect, serta kecocokan origin/resource. Jangan matikan autentikasi. |
| 401 / expired token | Ulangi OAuth/reconnect. Jangan menyalin token dari log atau koneksi pengguna lain. |
| 403 / scope denied | Periksa error, scope token, ceiling server, dan penolakan Origin/path. Jangan otomatis menaikkan ke exec. |
| Tools kosong/hilang | Pastikan app aktif; cek scope, katalog live, dan scan/refresh setelah update. Uji chat baru untuk snapshot baru. |
| `unknown tool` | Bedakan tool global dari tool proyek; lakukan discovery dan gunakan nama/schema terbaru. |
| GET SSE menghasilkan 405 | MSO tidak menyediakan listener SSE. Gunakan klien Streamable HTTP, bukan endpoint SSE lama. |
| MCP proyek belum terhubung | Periksa alias, endpoint persis, pemilik koneksi, token downstream, serta kebutuhan exec. |
| Timeout / hasil terpotong | Pecah tugas, batasi output, dan ikuti pagination. Jangan mengulangi mutation sebelum memeriksa hasil sebelumnya. |
| Workflow/job tidak ditemukan | Pastikan ID persis dan sesi/principal pemanggil benar. Jangan meminjam ID percakapan lain. |

Sesudah update tool/schema, bandingkan versi/hash pada **Tools & updates**, refresh di klien,
dan ulangi operasi read. Penanda refresh di MSO hanya pengingat lokal browser, bukan
konfirmasi bahwa ChatGPT berhasil memindai ulang. Jumlah tool bisa berbeda menurut scope/profil.
Putuskan akses yang tidak dipakai melalui **Connected apps** atau `mso mcp revoke <id>`;
`mso mcp list` hanya menampilkan metadata. Service token khusus automation mempunyai
allowlist terbatas, bukan pengganti umum OAuth: lihat [MCP reference](./MCP.md).

## Referensi dan batas bukti

[Dokumentasi OpenAI Developer Mode](https://developers.openai.com/api/docs/guides/developer-mode),
[Codex MCP](https://developers.openai.com/codex/mcp), dan
[Claude Code MCP](https://code.claude.com/docs/en/mcp) ditinjau 2026-09-13.
Menu/dukungan klien bisa berubah; kode MSO dan descriptor live menjadi otoritas perilaku server.
Panduan ini bukan klaim bahwa setiap klien, akun, atau koneksi downstream sudah diuji end-to-end.
