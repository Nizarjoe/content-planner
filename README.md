# Content Planner 🗂️

Dashboard perencana konten media sosial dengan **login pengguna**, **panel superadmin**, **auto posting** ke TikTok/Instagram, **generator caption**, dan **kalender eksekusi**. Node.js (Express) + SQLite bawaan Node 22 (`node:sqlite`) — tanpa dependensi database eksternal.

## ✨ Fitur

**Untuk pengguna:**
- 🔐 Login & registrasi (akun baru menunggu persetujuan admin)
- 📊 Dashboard: progres bulanan (ring chart), target mingguan, konten terbaik, pipeline
- 🗂️ Manajemen konten: draft → review → terjadwal → tayang, progres %, campaign
- 📅 **Kalender eksekusi** — tampilan bulanan semua jadwal & konten tayang, navigasi bulan
- ⚡ **Auto Post TikTok & Instagram** — jadwalkan posting; worker cek tiap 60 detik, saat jatuh tempo konten otomatis tayang (mode demo/simulasi; siap dihubungkan ke API resmi)
- ✨ **Generator Caption** — 4 gaya (edukasi/motivasi/promosi/hiburan), hook + body + CTA + hashtag otomatis, sekali klik salin
- 📣 Campaign, 💡 Idea Bank, 📁 Resources, 📈 Analytics, 👤 Profil + ganti sandi
- 📝 Catatan cepat, streak 🔥 & poin 💎, pencarian
- 🌙 **Mode malam / 🌞 siang** — tersimpan per perangkat

**Untuk admin/superadmin:**
- 🛡️ Kelola pengguna: setujui pendaftar, ubah peran (user/admin), nonaktifkan/aktifkan, hapus
- Data terisolasi per pengguna; hanya superadmin bisa mengubah peran & menghapus akun

## 🚀 Menjalankan

```bash
npm install
NODE_ENV=production SEED_DEMO=1 PORT=3030 node server.js
```

- Kredensial superadmin pertama dibuat acak → `data/initial-superadmin.txt` (chmod 600). **Segera ganti sandi lalu hapus file itu.**
- `SEED_DEMO=1` mengisi data dummy (10 konten, 2 campaign, ide, resources, catatan) hanya saat database kosong — jalankan tanpa variabel ini untuk produksi bersih.
- `AUTOPOST_MODE=live` untuk mengaktifkan integrasi posting asli (stub tersedia di `server.js`).
- Env vars: `PORT`, `NODE_ENV`, `SEED_DEMO`, `SUPERADMIN_PASSWORD`, `AUTOPOST_MODE`, `MONTHLY_GOAL`.

## 🛡️ Peran

| Peran | Kemampuan |
|---|---|
| `user` | Kelola konten/campaign/ide/resources/kalender/auto post miliknya |
| `admin` | + setujui pendaftar, nonaktifkan/aktifkan pengguna |
| `superadmin` | + ubah peran, hapus akun |

## 🔒 Keamanan (production)

- Password scrypt + session token acak (HttpOnly cookie + Bearer)
- Rate limit (login 25/15 menit, API 180/menit), security headers + CSP
- Sanitasi XSS, isolasi data per user, gzip, static cache + no-cache HTML

## 📄 Lisensi

MIT
