# Panduan Pengguna BonPOS

Manual operasional untuk kasir, dapur, supervisor, manager, dan admin toko.
Untuk instalasi teknis (Docker, env, API), lihat [README.md](../README.md).

---

## 1. Ringkasan

BonPOS adalah sistem Point of Sale multi-outlet untuk retail & F&B:

- **Kasir (POS)** — keranjang, meja, bayar (tunai / QRIS / split), struk
- **Dapur (KDS)** — tampilan order & bump status
- **Admin toko** — katalog, inventori, outlet, staf, jurnal ringan
- **Dashboard & laporan** — penjualan, shift, X/Z-Report
- **HRIS** — karyawan, absensi, draft payroll (Manager+)

Mata uang disimpan sebagai **bilangan bulat Rupiah** (bukan desimal). Di Admin, isi harga sebagai `15000` untuk **Rp 15.000**.

---

## 2. Akun demo (setelah seed)

Tenant default: `onprem-store`. PIN demo: `1234` (ganti di production).

| Peran | Email | Akses utama |
|--------|--------|-------------|
| Tenant Admin | `admin@bonpos.local` | Semua menu |
| Manager | `manager@bonpos.local` | POS, Admin, HRIS, Dashboard, Laporan |
| Supervisor | `supervisor@bonpos.local` | POS, inventori/outlet Admin (terbatas), tanpa Tim/GL |
| Kasir | `cashier@bonpos.local` | POS saja |
| Dapur | `kitchen@bonpos.local` | KDS saja |
| Bar | `bar@bonpos.local` | KDS (stasiun bar) |

---

## 3. Login & navigasi

1. Buka aplikasi (contoh Docker Desktop: **http://localhost:9088**).
2. Masukkan **email** + **PIN**.
3. Pilih **Bahasa** (ID / EN) di bilah atas.
4. Pilih **Toko** aktif di dropdown (multi-outlet).
5. Menu yang tampil mengikuti peran Anda:

| Menu | Siapa |
|------|--------|
| POS | Kasir, Supervisor, Manager, Admin |
| Dapur (KDS) | Kitchen/Bar, Supervisor+, Manager+ |
| Dashboard | yang punya `dashboard.read` |
| Laporan | yang punya akses Z-Report |
| HRIS | Manager+ (kasir tidak bisa) |
| Admin | `admin.access` (Supervisor terbatas) |
| Runtime | status teknis |

Keluar: tombol **Logout**.

---

## 4. POS — alur kasir

### 4.1 Buka shift

1. Masuk menu **POS**.
2. Mulai shift / clock-in bila diminta (kas awal laci).
3. Pastikan toko di dropdown sudah benar.

### 4.2 Tambah item

1. Ketuk produk di katalog (atau scan barcode).
2. Pilih **modifier** / **varian** bila ada.
   - Produk seperti **Teh Manis** wajib pilih varian (Regular / Large) sebelum masuk keranjang.
   - Satu varian saja → otomatis dipilih; lebih dari satu → modal pilih muncul.
   - Scan SKU varian (contoh `DRINK-TEH-L`) langsung menambah dengan varian itu.
3. Atur qty di keranjang.
4. Opsional: lampirkan pelanggan, promo/voucher, poin loyalty.

### 4.3 Meja & tamu (F&B)

1. Buka peta/daftar **meja** (Table Floor).
2. Pilih meja → status AVAILABLE / OCCUPIED / BILLING.
3. Item bisa diberi **nomor tamu** (guest) untuk bayar per orang.

### 4.4 Parkir order

- **Park** menyimpan keranjang untuk dilanjutkan nanti.
- **Resume** membuka kembali order yang diparkir.

### 4.5 Bayar (checkout)

1. Ketuk bayar / checkout.
2. Pilih metode:
   - **Tunai** — masukkan uang diterima; sistem hitung kembalian
   - **QRIS** — tampil **QR pembayaran** (dari payload toko di Admin → Outlet, atau Midtrans/Xendit). Ini beda dengan QR di preview struk.
     - Lokal: ketuk **Konfirmasi sudah bayar** setelah pelanggan transfer
     - PSP: ketuk **Cek status bayar** sampai status lunas
     - Tombol selesaikan terkunci sampai QRIS lunas
   - **Kartu** — proses di mesin EDC dulu, lalu ketuk **EDC berhasil — konfirmasi** (belum terhubung gateway EDC). Tombol selesaikan terkunci sampai dikonfirmasi
   - **Split** — kombinasi tunai + kartu/QRIS (aturan konfirmasi sama)
3. Opsional: tip.
4. Konfirmasi → layar **preview nota** (shell printer).

### 4.6 Preview struk & cetak

Setelah bayar sukses:

1. Tampil preview bergaya printer thermal (bisa **tarik ke bawah** untuk animasi sobek).
2. **QR di kaki struk** = referensi transaksi (`BONPOS:` + ID sale), **bukan** QRIS bayar. Tidak ada setting Admin untuk QR ini.
3. Aksi:
   - **Cetak struk** → kirim ESC/POS (USB/Serial atau LAN — lihat §10)
   - **Simpan PNG** → unduh gambar struk
   - **Salin teks** / **Lewati cetak**

### 4.7 Aksi sensitif (perlu PIN supervisor)

- Void transaksi (saat ini **seluruh sale**, bukan per baris)
- Diskon manual
- Buka laci kasir paksa

Minta Supervisor/Manager memasukkan PIN.

### 4.8 Cash drop & tutup shift

1. **Cash drop / mid-count** — catat setoran di tengah shift.
2. **X-Report** — ringkasan tanpa menutup shift.
3. **Z-Report** — tutup shift + rekonsiliasi laci:
   - Masukkan **kas fisik terhitung** dengan benar.
   - Sistem bandingkan dengan kas diharapkan (float awal + penjualan tunai − drop, dll.).
   - **Selisih** = dihitung − diharapkan. Isi `0` saat tutup → biasanya muncul selisih negatif besar.
---

## 5. Dapur (KDS)

1. Login sebagai `kitchen@…` atau `bar@…` (atau Manager mengawasi).
2. Buka **Dapur (KDS)**.
3. Ticket muncul saat kasir **fire** item ke stasiun.
4. Tap / bump untuk mengubah status (siap → selesai).
5. Stasiun dibatasi per user (User ↔ Kitchen Station di Admin → Tim / Outlet).

---

## 6. Administrasi toko

Buka **Admin** → URL `/admin/catalog` (lima hub).

| Hub | Isi | Siapa |
|-----|-----|--------|
| **Katalog** | Produk, kategori, modifier, promo, varian | Manager+ tulis |
| **Inventori** | Stok toko, transfer, opname, supplier, PO, resep | Supervisor+ inventori; PO butuh purchasing |
| **Outlet** | Toko (profil/QRIS/struk), meja, stasiun dapur | Supervisor+ |
| **Tim** | Staf POS, role, PIN, assign stasiun | Manager+ |
| **Sistem** | Jurnal/GL, edge sync, audit | Manager+ finance |

Deep link contoh: `/admin/inventory?tab=transfer`.

### 6.1 Produk & harga

1. Hub **Katalog** → tab Produk.
2. Isi nama, SKU, barcode, kategori, **harga Rupiah bulat**, pajak (bps; 1100 = 11%), stok, tipe (RETAIL/MENU/INGREDIENT), stasiun dapur.
3. Expand produk → kelola **varian** (sku, nama, harga).
4. Modifier: buat grup (min/max pilih) + opsi dengan delta harga.

### 6.2 Toko / QRIS / struk

1. Hub **Outlet** → Toko.
2. Tambah toko (kode + nama) atau edit: alamat, telepon, zona waktu, header/footer struk, aktif.
3. Tempel **payload QRIS statis** (EMVCo MPM dari bank/PSP, biasanya panjang). Saat **checkout → Bayar QRIS**, BonPOS membentuk QR dinamis dengan nominal.
4. Header/footer struk di sini mempengaruhi teks identitas toko; **QR referensi di preview nota** (setelah bayar) digenerate otomatis dari ID transaksi — bukan dari field ini.

### 6.3 Stok toko & transfer

1. **Stok toko** — pilih outlet, set qty / harga override per produk.
2. **Transfer** — tambah beberapa baris produk → kirim (in-transit) → terima di tujuan → atau batalkan.
3. Status: `DRAFT` → `IN_TRANSIT` → `COMPLETED` / `CANCELLED`.

### 6.4 Opname, supplier, PO, resep

- **Opname** — mulai sesi, isi qty hitung, selesai (variance) atau batalkan.
- **Supplier** — buat/edit kontak; nonaktifkan tanpa hapus riwayat.
- **Pembelian** — buat PO multi-baris → konfirmasi → terima barang (partial OK).
- **Resep / BOM** — tautkan bahan (INGREDIENT) + qty + biaya; preview COGS.

### 6.5 Meja & stasiun dapur

- Area + meja (kode, kapasitas, aktif).
- Stasiun dapur per toko; assign produk MENU ke stasiun; assign staf kitchen/bar ke stasiun.

### 6.6 Staf

- Buat user: email, nama, role, PIN 4–8 digit.
- Role tidak boleh di atas rank Anda sendiri.
- Kitchen: centang stasiun yang boleh dilihat di KDS.

---

## 7. Dashboard & laporan

### Dashboard

- Gross / Net sales, jumlah transaksi, AOV, produk terlaris.
- Widget shift & **Z-Report & selisih kas**.

#### Apa arti badge “N selisih”?

Contoh **`8 selisih`** = ada **8 Z-Report (tutup shift)** di daftar terbaru yang kas fisik **tidak sama** dengan kas diharapkan sistem (selisih ≠ 0).

| Kolom di widget | Arti |
|-----------------|------|
| **Kotor** | Total penjualan shift (semua metode bayar) |
| **dihitung** | Kas fisik yang diisi kasir saat clock-out |
| **selisih** | dihitung − diharapkan (float + tunai − drop, dll.) |

Bukan error stok. Sering muncul di demo jika tutup shift dengan **dihitung Rp 0** padahal ada float awal (mis. Rp 100.000).

### Laporan

- Arsip X/Z-Report, cetak ulang, ekspor CSV (sesuai izin).

---

## 8. HRIS (Manager+)

Kasir **tidak** punya akses menu ini.

1. **Karyawan** — data pegawai; opsional taut ke user POS.
2. **Absensi** — clock-in/out harian.
3. **Shift kerja** — jadwal.
4. **Payroll draft** — hitung OT + helper PPh 21 (bukan payroll production penuh).

---

## 9. Offline & sinkronisasi

- Keranjang & antrian penjualan disimpan di **IndexedDB** (Dexie).
- Saat offline, kasir tetap bisa jualan; saat online, antrean tersinkron.
- Mode **on-prem / edge sync** (compose onprem): sinkron hub pusat bila koneksi tersedia (lihat Admin → Sistem → Edge sync).
- Pasang sebagai **PWA** dari browser untuk pengalaman seperti app.
- **Tablet kasir (≥768px):** layout dua kolom **produk kiri | keranjang kanan** (penuh tinggi). Di HP: stack dengan keranjang max ~46% agar tombol Bayar tetap terlihat. Toolbar shift dilipat; nav sekunder di **Menu**.

---

## 10. Perangkat keras

| Perangkat | Cara kerja |
|-----------|------------|
| Printer thermal | ESC/POS: **Web Serial → WebUSB → LAN (TCP 9100 via API)** → fallback hex preview |
| Setup di POS | Badge status di header POS → buka **Setup printer** |
| USB / Serial | Chrome/Edge: **Pasang & uji cetak**. Browser minta izin perangkat. |
| LAN / Wi‑Fi | Isi IP printer + port (biasanya **9100**). Server API harus satu jaringan dengan printer. Tes koneksi / cetak uji. Hanya alamat LAN privat. |
| Bluetooth | Tidak didukung di browser murni (tidak ada SPP klasik). Pakai USB, dongle USB, atau printer LAN. |
| Preview struk | Setelah bayar: shell printer + tarik-sobek struk, QR referensi, simpan PNG, lalu **Cetak struk** |
| Laci kas | Perintah `ESC p` (buka paksa butuh PIN) |
| Scanner barcode | Mode keyboard wedge (HID) |

Pastikan browser mengizinkan akses serial/USB bila memakai kabel. Untuk LAN, pastikan firewall mengizinkan port 9100 dari mesin API ke printer.

---

## 11. Peran & izin (ringkas)

| Aksi | Kasir | Supervisor | Manager+ |
|------|-------|------------|----------|
| Jual di POS | ✓ | ✓ | ✓ |
| Void / diskon (PIN) | minta atasan | ✓ | ✓ |
| Opname / transfer / meja | — | ✓ | ✓ |
| Katalog / promo tulis | — | — | ✓ |
| Supplier / PO tulis | — | — | ✓ |
| Staf / GL / audit | — | — | ✓ |
| HRIS | — | — | ✓ |
| KDS bump | — | ✓ | ✓ |
| Kitchen-only login | — | — | (akun KITCHEN) |

---

## 12. Tips operasional

1. **Harga Admin** = Rupiah bulat (`25000` = Rp 25.000), lihat petunjuk di bawah field uang.
2. Login ulang setelah perubahan role/izin agar session memuat permission baru.
3. Selalu tutup shift dengan **Z-Report** dan isi **kas terhitung** sesuai laci sungguhan.
4. Uji QRIS di toko cabang sebelum go-live (payload terlalu pendek akan ditolak). Setting: Admin → Outlet → Payload QRIS.
5. Jangan bingungkan **QR pembayaran QRIS** (saat checkout) dengan **QR referensi** di preview struk.
6. Void saat ini membatalkan **seluruh** transaksi — koreksi item lebih aman sebelum bayar.
7. Produk ber-varian wajib dipilih dulu; error `Variant required for …` berarti baris tanpa varian (refresh POS / pilih Regular·Large).
8. Untuk demo dapur: login `kitchen@bonpos.local`, buka KDS; di POS fire menu yang sudah di-assign stasiun.

---

## 13. Bantuan teknis singkat

| Masalah | Cek |
|---------|-----|
| Admin kosong / URL `/catalog` | Buka `/admin/catalog` (sudah ada redirect) |
| KDS 403 | User harus punya `kitchen.display`; stasiun di-assign |
| QRIS tidak muncul saat bayar | Admin → Outlet → payload QRIS toko + pilih metode QRIS di checkout |
| QR di struk “apa artinya?” | Referensi sale ID (`BONPOS:…`), bukan QRIS bayar |
| Badge “N selisih” di Dashboard | N Z-Report dengan variance kas ≠ 0 — isi hitung kas saat tutup shift |
| `Variant required for Teh Manis` | Pilih varian; hard-refresh POS agar katalog/varian tersinkron |
| Toast sync berulang | Refresh; antrean error permanen sudah di-drop otomatis |
| Stok 0 di cabang | Set stok di Inventori → Stok toko (seed sering isi MAIN saja) |
| Tidak bisa masuk Admin | Role tanpa `admin.access` |

Dokumentasi deploy & env: [README.md](../README.md).  
Diagram ERD / RDBMS (56 tabel): [ERD.md](./ERD.md).
