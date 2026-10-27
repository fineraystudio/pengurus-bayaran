# Pengurus Bayaran

**Urus bayaran bulanan anda dengan mudah.** Apl web (PWA) Bahasa Melayu untuk merekod bil dan
komitmen bulanan: tandakan apa yang sudah dibayar, lihat jumlah bulanan berbanding tambahan, dan
tapis atau susun senarai mengikut status, jenis, tarikh atau amaun.

Semua data disimpan dalam peranti anda (`localStorage`). Tiada akaun, tiada pelayan, tiada muat naik.
Eksport dan import fail JSON membolehkan anda membuat salinan sandaran atau berpindah peranti.

## Ciri-ciri

- **Bahasa Melayu sepenuhnya** — semua teks antara muka, nama bulan dan format tarikh.
- **Ringgit Malaysia (RM)** — semua amaun dipaparkan dalam RM.
- **Komitmen bulanan berulang** — bulan baharu menyalin sendiri semua bayaran jenis "Komitmen Bulanan".
- **Tapis dan susun** — ikut jenis, status, tarikh, amaun atau nama.
- **Eksport / import JSON** — sandaran dan pindah peranti.
- **Boleh dipasang (PWA)** — tambah ke skrin utama telefon; berfungsi luar talian selepas lawatan pertama.
- **Ringan** — satu halaman, tiada rangka kerja, tiada penjejak.

## Jalankan secara tempatan

```sh
python -m http.server 8000
# buka http://localhost:8000
```

Service worker hanya berdaftar melalui `http://` atau `https://` (bukan `file://`).

## Ujian

```sh
node --test test/lib.test.js   # ujian unit lib.js
node test/e2e.mjs              # ujian hujung-ke-hujung dalam Chrome headless
```

Ujian unit meliputi logik data dalam `lib.js` (format RM, tapisan, susunan, ringkasan, salinan
komitmen bulanan). Ujian hujung-ke-hujung memandu halaman sebenar: tambah/sunting/padam bayaran,
tapis, susun, bulan baharu, simpan merentas muat semula, eksport, import dan service worker.

## Struktur

| Fail | Tujuan |
| --- | --- |
| `index.html` | antara muka |
| `styles.css` | gaya |
| `lib.js` | logik data tulen (boleh diuji dengan Node) |
| `app.js` | DOM, localStorage, PWA |
| `service-worker.js` | cache luar talian |
| `manifest.json` | metadata PWA |

## Kredit dan lesen

Berdasarkan **Payment Manager** daripada projek [personal-efficiency-machine](https://github.com/faridrameli/personal-efficiency-machine)
oleh Farid Rameli.

Lesen: [MIT](LICENSE).

Ikon dalam `icons/` ialah pemegang tempat daripada projek asal; ikon rasmi (hijau/emas) akan
diganti dalam langkah "Aset dan penjenamaan".
