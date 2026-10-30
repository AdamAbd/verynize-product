# Alur desain Wonder dan audit Verynize — 30 Oktober 2026

Dokumen ini menghubungkan eksplorasi UI Wonder, bukti gambar, audit implementasi Verynize, dan pemeriksaan regresi. Sasaran sesi adalah membuat desain dari canvas kosong sambil mencoba keluarga konfigurasi Properties, Icons, dan Variables, termasuk perubahan nilai variable setelah dipakai pada beberapa properti.

**Status dokumen: sesi masih berlangsung.** Bukti baru yang telah diperiksa mengonfirmasi canvas awal kosong, pembuatan frame putih 800 × 570, menu tipe variable, serta lima entri variable yang dibuat. Checklist di bawah adalah cakupan pengujian, bukan pernyataan bahwa semua fitur telah berhasil dipakai. Hasil akhir dan validasi Verynize harus mengikuti catatan pelaksana serta gambar yang benar-benar tersedia.

## Pembagian pekerjaan

| Pelaksana | Tanggung jawab | Hasil tertulis |
|---|---|---|
| Agent utama | Kontrol Wonder, membuat desain, merekam gambar, integrasi dan validasi akhir | Dokumen ini dan `design/wonder/2026-10-30/` |
| `audit_properties` | Audit Properties dan binding nilai, perbaikan yang ditugaskan | [Audit Properties](audits/2026-10-30-properties-agent.md) |
| `audit_variables_icons` | Audit Variables/Icons, validasi nama, ekspor CSS dan penanganan ikon | [Audit Variables dan Icons](audits/2026-10-30-variables-icons-agent.md) |
| `workflow_documentation` | Inventaris cakupan, indeks bukti, batas klaim dan alur reproduksi | Dokumen ini |

Kontrol desktop dimiliki satu pelaksana agar klik dan fokus aplikasi tidak bentrok. Agent dokumentasi tidak mengoperasikan Wonder dan tidak menafsirkan perubahan kode sebagai bukti keberhasilan UI Wonder.

## Sumber dan batas bukti

- **Baru, 30 Oktober:** screenshot dalam [`design/wonder/2026-10-30/`](../design/wonder/2026-10-30/), ditinjau bersama langkah dan hasil dari pelaksana.
- **Historis, 28 Oktober:** screenshot dalam [`design/wonder/`](../design/wonder/) dan [catatan eksplorasi](../design/wonder/catatan.txt). Screenshot historis membantu menentukan kontrol yang perlu dicoba; tidak membuktikan kontrol itu dipakai pada desain sesi ini.
- **Spesifikasi terdahulu:** [Wonder canvas spec](wonder-canvas-spec.md) mencampur pengamatan screenshot, inspeksi statis, dan inferensi yang dilabeli. Nama fitur dari spesifikasi tidak otomatis menjadi hasil observasi runtime.
- **Verynize:** audit sumber, hasil tes dan screenshot Verynize harus diberi identitas terpisah. Gambar Wonder bukan screenshot produk Verynize.

Label hasil yang digunakan:

| Label | Arti |
|---|---|
| Terlihat | Kontrol atau nilai tampak pada screenshot; efek belum dibuktikan |
| Diterapkan | Ada tindakan yang dicatat dan bukti tampilan sesudahnya |
| Teruji | Nilai/efek dibandingkan sebelum–sesudah, termasuk hasil yang diharapkan |
| Historis | Bukti berasal dari eksplorasi sebelumnya |
| Belum | Belum ada bukti sesi ini |
| Tidak tersedia | Kontrol dicari pada konteks yang sesuai, tetapi tidak ditawarkan; alasan dicatat |
| Gagal | Tindakan dicoba dan hasil berbeda dari harapan; jangan dipromosikan menjadi berhasil |

## Keadaan awal dan jurnal sesi

File aktif pada baseline adalah **Thrush**, halaman **Page 1**, zoom **100%**. Canvas tampak kosong. Panel kiri dilipat. Panel kanan menampilkan Variables dan Icons yang dilipat, serta Properties → Page dengan warna `2B2B2B` dan opacity `100%`.

| Urutan | Langkah / kondisi yang dapat dibuktikan | Hasil | Bukti |
|---|---|---|---|
| 00 | Keadaan awal file Thrush / Page 1 | Canvas kosong; Properties menampilkan Page | [00-empty-canvas.png](../design/wonder/2026-10-30/00-empty-canvas.png) |
| 01 | Membuat frame dari canvas kosong | Frame putih terpilih, ukuran 800 × 570 px, X −620, Y −305, rotation 0° | [01-frame-created.png](../design/wonder/2026-10-30/01-frame-created.png) |
| 02 | Membuka create-variable menu | Frame kini memakai fill `111827` dan radius 24; menu Colors, Dimensions, Numbers, Font family, Font weight terlihat. Pembuatan masing-masing tipe belum dibuktikan oleh gambar ini | [02-variable-types.png](../design/wonder/2026-10-30/02-variable-types.png) |
| 03 | Membuat satu variable dari tiap tipe | Panel menunjukkan Variables 5: surface `#111827`, spacing `24px`, strength `0`, family `Inter`, dan weight sedang dalam field edit nama; nilai weight tidak tampak | [03-five-variable-types-created.png](../design/wonder/2026-10-30/03-five-variable-types-created.png) |

| 04 | Menyelesaikan nilai lima variable | `surface=#111827`, `spacing=24px`, `strength=1`, `family=Inter`, `weight=600` | [04-variable-values.png](../design/wonder/2026-10-30/04-variable-values.png) |
| 05 | Memasang binding fill/radius dan mengaktifkan Flex | Background Fill menampilkan chip `surface`; Corner radius menampilkan chip `spacing`; kontrol Flex aktif | [05-bound-fill-radius-flex.png](../design/wonder/2026-10-30/05-bound-fill-radius-flex.png) |
| 06 | Beralih ke Flex Column, mengikat gap dan padding | Vertical gap, horizontal padding, vertical padding sama-sama menampilkan chip `spacing`; radius tetap terikat dan fill tetap `surface` | [06-variable-mix-layout.png](../design/wonder/2026-10-30/06-variable-mix-layout.png) |

![Baseline Wonder: Thrush / Page 1 masih kosong, Variables dan Icons dilipat](../design/wonder/2026-10-30/00-empty-canvas.png)


Pelaksana menggunakan kontrol UI native macOS melalui Accessibility/CGEvent, lalu mengambil screenshot window Wonder. Percobaan awal belum memfokuskan Wonder; setelah aplikasi dijadikan frontmost, frame berhasil dibuat dan capture 01 diganti dengan hasil yang terverifikasi. Tidak ada kode atau state internal Wonder yang digunakan untuk menyusun desain.

Pada frame baru, inspector menampilkan:

- **Position:** alignment, rotate/flip, X −620, Y −305, rotation 0°, anchor Left/Top, Z Auto, constraint widget.
- **Layout:** empat opsi Display, W 800 px, H 570 px, aspect-ratio control.
- **Appearance:** opacity 100%, radius 0, per-corner control, Clip content aktif, visibility dan blend controls.
- **Background Fill:** `FFFFFF`, 100%, visibility, remove, add dan shader controls.
- **Border, Outline, Shadow, Filters, Mask, Export:** judul dan tombol tambah terlihat; parameter di dalamnya belum dibuka pada capture ini.

![Frame pertama 800 × 570 dan inspector lengkap](../design/wonder/2026-10-30/01-frame-created.png)


## Binding yang sudah diterapkan

Pelaksana mengamati bahwa klik pada input angka menampilkan saran variable yang kompatibel. Memilih `spacing 24px` mengganti tampilan angka dengan chip nama variable. Untuk warna, jalurnya **Choose color → Variables → surface**. Pada capture 06, frame yang sama memakai `surface` untuk background dan `spacing` untuk radius, horizontal padding, vertical padding serta vertical gap. Ini membuktikan pemasangan beberapa binding berbeda pada satu frame; propagasi nilai setelah variable diedit dan persistensi setelah reopen masih memerlukan bukti tambahan.

| Variable | Tipe dan nilai pada capture 04 | Properti yang sudah terikat pada capture 06 |
|---|---|---|
| surface | Colors, `#111827` | Background Fill frame |
| spacing | Dimensions, `24px` | Corner radius, horizontal padding, vertical padding, vertical gap |
| strength | Numbers, `1` | Belum ada binding yang dibuktikan |
| family | Font family, `Inter` | Belum ada binding yang dibuktikan |
| weight | Font weight, `600` | Belum ada binding yang dibuktikan |

![Variable diterapkan bersamaan pada radius, gap, padding dan fill](../design/wonder/2026-10-30/06-variable-mix-layout.png)

## Latihan desain yang diusulkan

Bagian ini merupakan rancangan latihan untuk cakupan fitur, belum hasil yang sudah dibuat. Gunakan satu komposisi dashboard/kartu proyek yang mudah dibaca, lalu letakkan contoh efek terpisah di sampingnya. Konfigurasi yang saling menggantikan, seperti mode layout atau jenis fill, dicoba berurutan atau di node berbeda agar efeknya dapat dibandingkan.

| Elemen | Tujuan desain | Konfigurasi yang dicoba |
|---|---|---|
| Artboard utama | Permukaan dashboard | Ukuran, background, padding, radius, clip, border |
| Header + judul/body | Hierarki teks | Family, weight, size, line height, letter spacing, Text Fill |
| Baris aksi dengan ikon | Aksi utama dan pendukung | Flex direction/alignment/gap, Icon library, token warna |
| Grid kartu | Kelompok proyek/status | Grid tracks, row/column gap, spans, Fill/Hug/fixed |
| Badge status | Aksen sederhana | Radius, opacity, fill, inset/outer shadow |
| Papan contoh di samping | Membandingkan efek yang tidak cocok diterapkan bersamaan | Gradient/image/shader fill, border per-side, outline, filters, mask, blend |

Contoh token latihan (usulan nilai, bukan nilai yang telah dimasukkan): Colors `brand/primary`, `surface/base`, `text/primary`; Dimensions `space/md`, `radius/card`, `type/body`; Numbers `opacity/muted`; Font family `font/body`; Font weight `weight/heading`. Nama dan unit akhir mengikuti kontrol Wonder yang benar-benar tersedia.

## Checklist Properties

Kolom status merupakan hasil **sesi 30 Oktober**, bukan dukungan fitur di Verynize. Sumber H adalah screenshot historis; S adalah spesifikasi terdahulu. Sizing, layout anak, tipografi, dan warna SVG memerlukan jenis node/konteks yang sesuai.

| ID | Keluarga dan kontrol yang perlu dicoba | Cara membuktikan efek | Dasar inventaris | Status sesi |
|---|---|---|---|---|
| P01 | Page background: warna, opacity, visibility | Ubah satu nilai, bandingkan canvas, pulihkan | Baseline baru | Terlihat |
| P02 | Position X/Y dan rotation | Nilai inspector cocok dengan perpindahan/rotasi node | H43, S §3 | Terlihat pada 01; belum diuji |
| P03 | Align L/C/R dan T/M/B, distribusi | Beberapa node menunjukkan posisi/spacing berubah sesuai aksi | H43, S §2 | Terlihat pada 01; belum diuji |
| P04 | Rotate 90°, flip horizontal/vertical | Gunakan bentuk/ikon asimetris supaya hasil jelas | H43, S §3 | Terlihat pada 01; belum diuji |
| P05 | Anchors Left/Right/Center dan Top/Bottom/Center; constraint widget | Resize parent dan periksa hubungan anak | H43, S §3 | Terlihat pada 01; belum diuji |
| P06 | Z / Auto dan absolute positioning | Node tumpang tindih; ubah urutan dan posisi dalam parent flow | H43, S §3 | Terlihat pada 01; belum diuji |
| P07 | Display free/absolute, flex, block, grid | Capture tiap mode serta perpindahan child | H43, S §3 | Flex aktif pada 05, Column pada 06; free/block/grid belum diuji |
| P08 | W/H fixed px, relative %, Hug, Fill, Auto | Catat mode yang tersedia per parent/node; resize parent/content | H25, H43, S §1 | Terlihat pada 01; belum diuji |
| P09 | Min/max width/height; aspect ratio; Calculate bila ditawarkan | Resize melewati batas; ratio tetap; tulis jika Calculate tidak tersedia | S §1/§3 | Belum |
| P10 | Flex direction, wrap bila tersedia, align, justify, gap | Bandingkan susunan paling sedikit tiga child | S §1/§3 | Column diterapkan dan vertical gap terikat spacing pada 06; layout child belum diuji |
| P11 | Grid columns/rows, auto-flow, gap X/Y, child spans | Grid berisi beberapa item menunjukkan track dan span berubah | S §1/§3 | Belum |
| P12 | Padding/margin uniform, per-axis, per-side | Nilai di tiap sisi terlihat pada jarak child/parent | S §1/§3 | Padding X/Y terikat spacing pada 06; margin/per-side belum |
| P13 | Visibility dan opacity | Toggle lalu pulihkan; turunkan opacity dengan backdrop pembanding | H43 | Terlihat pada 01; belum diuji |
| P14 | Blend mode | Dua layer berwarna saling tumpang tindih; capture pilihan dan efek | S §1/§3 | Terlihat pada 01; belum diuji |
| P15 | Radius uniform dan per-corner | Bandingkan sudut yang berbeda; kemudian coba binding dimension | H43 | Radius uniform terikat spacing pada 05–06; per-corner belum |
| P16 | Clip content / overflow | Child sengaja melewati batas parent, toggle dan bandingkan | H43, S §1 | Terlihat pada 01; belum diuji |
| P17 | Font family, weight, size | Teks terpilih menunjukkan nilai dan perbedaan tipografi | H25–27 | Belum |
| P18 | Line height Auto/px, letter spacing | Gunakan teks beberapa baris dan cukup panjang | H25 | Belum |
| P19 | Text horizontal/vertical alignment; advanced typography | Frame teks lebih besar dari content; capture menu lanjutan | H25, S §3 | Belum |
| P20 | Text Fill dan Background Fill: warna, opacity, visibility, tambah/hapus paint | Teks dan background berbeda; periksa paint individual | H23, H25, H43 | Background solid terikat surface pada 05–06; Text Fill/paint stack belum |
| P21 | Color picker: Custom/Variables, hue, alpha, channel, format, eyedropper | Konversi format mempertahankan warna; binding tampil setelah pilih variable | H23, S §3 | Belum |
| P22 | Gradient linear/radial/conic; stop, posisi, opacity | Capture editor stop dan hasil visual masing-masing jenis yang tersedia | S §1/§3 | Belum |
| P23 | Image fill: cover/contain/fill/scale-down | Gunakan rasio gambar dan frame berbeda, periksa crop/stretch | S §1 | Belum |
| P24 | Shader fill/node: preset dan parameter | Pilih preset, ubah satu parameter; simpan sebelum–sesudah | H55–56, S §3 | Belum |
| P25 | Border: warna, opacity, width uniform/per-side, style bila tersedia | Border kontras; tiap sisi dibedakan | H43, S §1 | Terlihat pada 01; belum diuji |
| P26 | Outline | Ubah width/offset/color yang ditawarkan dan capture hasil | H43 | Terlihat pada 01; belum diuji |
| P27 | Shadow outer/inset/drop/text; tambah/hapus dan parameter | Capture jenis yang tersedia dan efek pada bentuk/teks | H43, S §1 | Terlihat pada 01; belum diuji |
| P28 | Filters: blur, brightness, contrast, grayscale, hue rotate, invert, saturate, sepia, drop shadow | Gunakan contoh berwarna; catat satu hasil tiap filter yang tersedia | H43, S §1 | Terlihat pada 01; belum diuji |
| P29 | Mask dan pelepasan mask | Bentuk pemotong dan target jelas; capture sebelum/sesudah | H52, S §2 | Terlihat pada 01; belum diuji |
| P30 | Icon / SVG Colors (kontekstual) | Ubah warna path/stroke; bedakan dengan background bounding box | S §3 | Belum |
| P31 | Scale tool (kontekstual) | Ukuran, stroke/radius/font ikut berubah sesuai kontrol yang ditawarkan | S §2/§3 | Belum |
| P32 | Export format, scale, prefix dan output | Capture pengaturan, file output dan dimensi; buka output | H45–50 | Terlihat pada 01; belum diuji |

Untuk dropdown dengan banyak opsi, catat daftar yang muncul, opsi yang benar-benar diterapkan, dan alasan opsi tersisa belum dicoba. “Semua konfigurasi” tidak boleh disimpulkan hanya dari daftar keluarga di atas.

## Checklist Variables dan mix-and-match

Screenshot historis H42 menunjukkan lima kategori: **Colors, Dimensions, Numbers, Font family, Font weight**. H41 memperlihatkan nama dalam folder `brand`. Dukungan binding suatu properti perlu dikonfirmasi lewat picker properti tersebut.

| ID | Percobaan | Hasil yang harus dicatat | Status sesi |
|---|---|---|---|
| V01 | Buka create menu dan tiap kategori | Nama kategori, field nilai, unit/default | Terlihat: menu 02; detail tiap tipe belum |
| V02 | Buat color variable dan folder/nama dengan slash | Nilai tersimpan, pengelompokan, nama saat dipilih | Color surface `#111827` dibuat pada 03; folder belum |
| V03 | Buat dimension variable | Nilai dan unit; daftar properti kompatibel | spacing 24px dibuat 04, terikat radius/gap/padding 06 |
| V04 | Buat number variable | Range dan unit; batas saat dipakai opacity/angka lain | strength 1 terlihat pada 04; binding belum |
| V05 | Buat family dan weight variable | Nama family dan nilai weight yang diterima | family Inter dan weight 600 terlihat pada 04; binding belum |
| V06 | Search/filter/grid atau list yang ditawarkan | Hasil pencarian nama/nilai serta reset pencarian | Belum |
| V07 | Rename, duplicate, delete yang ditawarkan | Referensi lama tetap konsisten atau perilaku pelepasan yang terlihat | Belum |
| V08 | Bind satu color ke fill pada dua node berbeda | Kedua node menampilkan warna yang sama serta indikator binding | Belum |
| V09 | Bind color yang sama pada Text Fill dan background | Setelah edit token, warna teks dan frame sama-sama berubah | Belum |
| V10 | Bind dimension ke radius, gap, padding, ukuran/font size yang kompatibel | Satu variable mengontrol lebih dari satu properti sesuai picker | spacing terikat radius, padding X/Y dan vertical gap pada 06; ukuran/font size belum |
| V11 | Bind number ke opacity atau properti angka kompatibel | Nilai hasil dan normalisasi persen/angka jelas | Belum |
| V12 | Bind family + weight + size pada teks yang sama | Ketiga binding tetap aktif bersamaan | Belum |
| V13 | Literal override lalu bind kembali | Nilai dan indikator sesuai sumber nilai yang aktif | Belum |
| V14 | Bind scalar saat per-side/per-corner/per-axis aktif | Catat apakah override dibersihkan, dipertahankan, atau UI menolak | Belum |
| V15 | Edit variable global setelah dipakai beberapa node | Capture sebelum–sesudah; identifikasi semua node yang berubah | Belum |
| V16 | Detach variable | Tampilan sebelum dan sesudah; apakah nilai resolved dipertahankan | Belum |
| V17 | Hapus variable yang masih dipakai | Perilaku pengguna nyata: fallback, detach, dialog, atau penolakan | Belum |
| V18 | Undo/redo edit, bind, detach | Nilai, binding, dan tampilan kembali konsisten | Belum |
| V19 | Simpan/reopen serta export variable jika tersedia | Binding/nama/nilai tetap; output bukan hanya screenshot | Belum |

Percobaan yang paling menentukan untuk Verynize adalah **V14** dan **V16**: audit kode awal menemukan potensi konflik antara binding scalar dengan override individual, serta pelepasan color binding yang dapat mengembalikan warna lama. Audit dan pengujian Verynize tetap terpisah dari perilaku Wonder sampai sesi UI mengonfirmasinya.

## Checklist Icons

Baseline baru memperlihatkan header Icons dengan tombol view, search dan add. Menu add dan isi library belum dibuktikan oleh baseline. Jangan menganggap opsi Verynize sama dengan opsi Wonder.

| ID | Percobaan | Bukti yang diperlukan | Status sesi |
|---|---|---|---|
| I01 | Expand Icons dan buka Add | Menu penuh, kategori/set/import yang benar-benar tersedia | Terlihat: header saja |
| I02 | Pilih/tambah ikon yang tersedia | Nama set dan ikon, preview, item library | Belum |
| I03 | Grid/list, search dan clear | Hasil pencarian serta perubahan tampilan panel | Belum |
| I04 | Masukkan ikon pada canvas / parent | Node hasil, ukuran, tipe/konteks Properties | Belum |
| I05 | Resize/rotate/flip ikon | Hasil dengan bentuk asimetris dan nilai inspector | Belum |
| I06 | Ubah warna ikon melalui Properties | Path/stroke berubah, bukan hanya background kotak | Belum |
| I07 | Bind warna ikon ke color variable jika ditawarkan | Picker, indikator binding, perubahan global, hasil ikon | Belum |
| I08 | Ikon yang sama pada dua komponen | Periksa apakah instance ikut update atau berupa salinan mandiri | Belum |
| I09 | Rename/delete asset yang dipakai | Dampak ke instance dan Undo | Belum |
| I10 | Export ikon dan komposisi | Ikon tetap terlihat pada file output | Belum |

## Bukti historis untuk inventaris

| ID | File | Yang benar-benar tampak / fungsi referensi |
|---|---|---|
| H23 | [Color picker](../design/wonder/23-color-picker.png) | Solid/gradient/image controls, Custom/Variables, HSV surface, alpha dan input warna |
| H25 | [Typography](../design/wonder/25-typography.png) | Teks, family Inter, Regular, 32 px, line height Auto, letter spacing, alignment |
| H26–27 | [Family picker](../design/wonder/26-font-family-picker.png), [Weight picker](../design/wonder/27-font-weight-picker.png) | Referensi menu tipografi; bukan percobaan ulang sesi ini |
| H41–42 | [Variables](../design/wonder/41-variables.png), [Create variable](../design/wonder/42-new-variable-menu.png) | Folder `brand` dan lima tipe variable |
| H43 | [Frame Properties](../design/wonder/43-frame-properties.png) | Position, Layout, Appearance, Fill, Border, Outline, Shadow, Filters, Mask, Export |
| H45–50 | [Export options](../design/wonder/45-export-options.png), [Format](../design/wonder/46-export-format.png), [Saved](../design/wonder/50-export-success.png) | Referensi opsi dan keberhasilan export pada sesi lama |
| H52 | [Mask options](../design/wonder/extra/52-mask-options.png) | Referensi menu mask |
| H55–56 | [Shader](../design/wonder/55-shader-created.png), [Presets](../design/wonder/56-shader-presets.png) | Referensi node dan picker shader |
| H89 | [Desain eksplorasi lama](../design/wonder/89-final-design.png) | Hasil sesi 28 Oktober; tidak digunakan sebagai hasil desain baru |

## Dari observasi ke implementasi Verynize

Setiap perbaikan harus menghubungkan empat hal: tindakan pengguna, perilaku yang diharapkan, lokasi implementasi, dan bukti regresi. Audit kode dapat membuktikan bug internal tanpa harus mengklaim perilaku Wonder identik.

| Temuan audit awal | Dampak pengguna | Pemilik dan dokumen | Status validasi akhir |
|---|---|---|---|
| Detach color binding dapat memakai literal warna lama | Tampilan berubah saat pengguna melepas binding | `audit_properties`, [audit Properties](audits/2026-10-30-properties-agent.md) | Mengikuti laporan agent/integrasi akhir |
| Scalar binding bertentangan dengan override radius/spacing individual | Indikator bound tidak mencerminkan hasil visual | `audit_properties` | Mengikuti laporan agent/integrasi akhir |
| Color creation bisa bertabrakan dengan nama variable | Nilai terpakai tertimpa atau dokumen tidak valid | `audit_variables_icons`, [audit Variables/Icons](audits/2026-10-30-variables-icons-agent.md) | Mengikuti laporan agent/integrasi akhir |
| Nama berbeda menjadi identifier CSS sama | Ekspor membatalkan nilai variable sebelumnya | `audit_variables_icons` | Mengikuti laporan agent/integrasi akhir |
| Ikon SVG tidak valid lolos lalu gagal saat decoding | Klik insert dapat melempar error sebelum handler | `audit_variables_icons` | Mengikuti laporan agent/integrasi akhir |

Gaps yang perlu tetap dinyatakan: outline/filter inspector, warna SVG berbasis variable, struktur folder variable dan binding properti yang belum didukung. Status pastinya mengikuti audit sumber terbaru dan hasil implementasi, bukan daftar lama dalam spec.

## Kriteria penutupan sesi

- [ ] Desain baru terlihat, bernama, dan dapat dibuka kembali di Wonder.
- [ ] Semua keluarga Properties yang tersedia di konteks yang diuji memiliki hasil/catatan batas yang eksplisit.
- [x] Kelima tipe variable dibuat; nilai akhirnya terlihat pada capture 04.
- [ ] Setidaknya satu edit global memperbarui beberapa node/properti; detach dan undo dibuktikan.
- [ ] Ikon dimasukkan ke komposisi; interaksi warna/variable dicatat sesuai kemampuan nyata.
- [ ] Screenshot sebelum–sesudah dan indeks bukti sesuai isi gambar.
- [ ] Ekspor hasil desain tersedia atau kegagalannya didokumentasikan.
- [ ] Audit tiap agent selesai, perubahan Verynize tercatat, dan tes relevan dilaporkan dengan hasil nyata.
- [ ] Bukti Wonder dan Verynize dibedakan; tidak ada klaim full parity tanpa pengujian.
