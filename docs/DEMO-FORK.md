# Demo publik MSO

[`official-manef/mso`](https://github.com/official-manef/mso) adalah GitHub fork dari
[`rahmanef63/mso`](https://github.com/rahmanef63/mso).

Entrypoint di `demo/app` mengimpor `OsRoot` dan stylesheet MSO langsung. Build
mengaktifkan `NEXT_PUBLIC_OS_DEMO=1` untuk memakai adapter dan data contoh yang
sudah ada di MSO. Terminal dan fitur host tetap mengikuti mode demo upstream.

Siapkan dependensi dengan `bun install --frozen-lockfile`, lalu jalankan
`node demo/build.mjs`. Sajikan `demo/out` sebagai file statis dari root domain.
Output berisi halaman, aset dan JavaScript browser. API dan proses server MSO
berada di luar proyek ekspor. Vercel memakai konfigurasi di `vercel.json`.

Workflow [Sync upstream](../.github/workflows/sync-upstream.yml) menjalankan
`git merge` dari `rahmanef63/mso:main` setiap hari dan dapat dijalankan manual
melalui GitHub Actions. Jika konflik terjadi, periksa log dan selesaikan lewat
merge biasa agar riwayat kedua repo tetap tersimpan. Konfigurasi demo berada
di direktori `demo/` sehingga perubahan frontend dan dependensi MSO dapat masuk
melalui merge upstream.
