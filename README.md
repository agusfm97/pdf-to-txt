# PDF ke TXT

Konverter **PDF → TXT** gratis yang berjalan sepenuhnya di browser, terinspirasi dari [CloudConvert](https://cloudconvert.com/pdf-to-txt).

> **Demo publik:** https://agusfm97.github.io/pdf-to-txt/

## Fitur

- **Privat sepenuhnya** — file tidak pernah diunggah ke server; ekstraksi teks memakai [PDF.js](https://mozilla.github.io/pdf.js/) di perangkat pengguna.
- **Banyak file sekaligus** — tarik & lepas atau pilih beberapa PDF.
- **Pilihan halaman** — konversi semua halaman atau rentang tertentu (`1-3, 5, 8-`).
- **Penanda halaman** — format bawaan, tanpa penanda, atau kustom dengan placeholder `{n}`.
- **Mode teks** — rapi (mudah dibaca) atau pertahankan tata letak asli.
- **Rapikan hasil** — hapus baris kosong berlebih dan gabungkan kata terpotong (`pem-` + `rograman`).
- **Unduhan fleksibel** — per file `.txt`, semua file sebagai `.zip`, atau gabungkan menjadi satu TXT.
- **Salin ke papan klip** dengan satu klik.
- **Encoding** UTF-8 atau UTF-8 dengan BOM (ramah Excel/Notepad lama).
- **PDF berpassword** didukung (diminta saat konversi).
- **Responsif & mode gelap** mengikuti preferensi sistem.

## Menjalankan secara lokal

Karena situs ini statis, cukup jalankan server HTTP sederhana dari folder proyek:

```bash
# Python 3
python -m http.server 8080

# atau Node.js
npx serve .
```

Lalu buka <http://localhost:8080>.

> Membuka `index.html` langsung lewat `file://` tidak disarankan karena Web Worker PDF.js butuh protokol HTTP.

## Deploy ke GitHub Pages

1. Buat repositori baru, misalnya `pdf-to-txt`.
2. Push seluruh isi folder ini ke branch `main`.
3. Buka **Settings → Pages**.
4. Pada **Build and deployment**, pilih **Deploy from a branch**, branch `main`, folder `/ (root)`, lalu **Save**.
5. Tunggu 1–2 menit. Situs tersedia di `https://<username>.github.io/pdf-to-txt/`.

File `.nojekyll` sudah disertakan agar aset dilayani apa adanya.

## Struktur

```
index.html
assets/
  css/style.css
  js/app.js
  favicon.svg
vendor/
  pdf.min.js          # PDF.js 3.11.174
  pdf.worker.min.js
  jszip.min.js        # JSZip 3.10.1
.nojekyll
```

## Batasan

- PDF hasil **pindaian (scan)** tidak memiliki lapisan teks, sehingga hasilnya kosong. Diperlukan OCR (mis. Tesseract) sebelum dikonversi.
- Kualitas teks bergantung pada bagaimana PDF dibuat. PDF dengan teks sebagai kurva/gambar tidak dapat diekstrak.
- Kinerja dipengaruhi perangkat pengguna untuk file berukuran besar.

## Lisensi

Kode proyek ini dirilis di bawah [MIT License](LICENSE).

Pustaka pihak ketiga:

- **PDF.js** — Apache License 2.0, © Mozilla Foundation
- **JSZip** — MIT / GPLv3, © Stuart Knightley
