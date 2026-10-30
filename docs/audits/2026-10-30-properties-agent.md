# Audit Properties dan pengikatan variable — 30 Oktober 2026

Penanggung jawab: agent `audit_properties`. Cakupan: inspector Verynize, hubungan variable dengan nilai yang dirender, dan referensi Wonder yang sudah tersimpan. Audit ini tidak mengoperasikan Wonder atau mengambil screenshot baru; observasi Wonder pada sesi aktif merupakan tanggung jawab agent utama.

## Sumber dan batas bukti

- Screenshot historis yang diperiksa langsung: [43-frame-properties.png](../../design/wonder/43-frame-properties.png), [42-new-variable-menu.png](../../design/wonder/42-new-variable-menu.png).
- Spesifikasi referensi: [wonder-canvas-spec.md §3](../wonder-canvas-spec.md#3-inspector-right-panel-o-screenshots-22254356-plus-bundle-headings). Label observasi/inferensi di dokumen asal tetap berlaku.
- Implementasi: `web/src/islands/inspector/`, `web/app.js`, `web/node-style.js`, `integrations/design-edit.mjs`.
- Screenshot historis membuktikan keberadaan kontrol pada waktu capture, bukan hasil interaksi pada Wonder hari ini. Tidak ada klaim bahwa seluruh konfigurasi Wonder sudah dicoba.

![Referensi historis panel frame Wonder](../../design/wonder/43-frame-properties.png)

![Referensi historis lima tipe variable Wonder](../../design/wonder/42-new-variable-menu.png)

## Temuan dan perbaikan

### P1 — Melepas color variable mengubah warna yang terlihat

Sebelum perbaikan, `VariableMenu` di `web/src/islands/inspector/properties.tsx` menjalankan `setField(selection, node, "token", "")`. Renderer (`web/app.js:19`) memilih `design.tokens[n.token] || n.color`; mengosongkan token membuat layer kembali ke warna lokal lama. Contoh: warna lokal merah, token biru transparan → Detach variable menghasilkan merah.

Perbaikan pada `properties.tsx:351`: setiap layer yang dipilih menerima warna token terkini sebagai `color` sebelum `token` dikosongkan, dalam satu edit undoable. Alpha dipertahankan. Multi-selection mempertahankan warna masing-masing; token yang hilang mempertahankan fallback lokal. Penghapusan color variable sebelumnya sudah benar karena handler `web/app.js:20` menyimpan nilai resolved sebelum menghapus referensinya.

### P1 — Chip variable aktif tetapi override lama tetap menang saat rendering

Sebelum perbaikan, `bindVariable` pada `vars.ts` hanya menulis scalar dan nama binding. Renderer memberi prioritas pada `cornerRadii`, `strokeWidths`, `paddingTop/Right/Bottom/Left`, dan `gapX/Y` (`web/node-style.js:173`, `:177`, `:236`, `:239`). Akibatnya, binding radius 24 masih dapat terlihat sebagai empat radius 4/8/12/16.

Reproduksi headless menggunakan fungsi produksi `syncVariables` dan `nodeStyle` menghasilkan:

| Properti | Scalar setelah sync | Nilai CSS sebelum perbaikan bind |
|---|---|---|
| radius | 24 | `4px 8px 12px 16px` |
| strokeWidth | 24 | `1px 2px 3px 4px` |
| padding | 24 | `5px 5px 5px 5px` |
| gap | 24 | column `7px`, row `9px` |

Perbaikan pada `vars.ts:224`: pemasangan binding scalar membersihkan override yang bertentangan melalui helper `scalarOverrides` di `model.ts`. Gap mengikuti kontrak kontrol `layout.tsx:430`: main axis flex, atau column gap untuk grid. Override cross axis tetap dipertahankan. Detach hanya melepas binding dan mempertahankan hasil yang sudah dirender.

Batas: perbaikan ini berlaku ketika pengguna memasang binding melalui inspector. Dokumen lama yang sudah menyimpan kombinasi binding dan override yang bertentangan belum dimigrasi; headless `syncVariables` masih mempertahankan override. Kebijakan migrasi perlu ditentukan terpisah agar spacing independen tidak terhapus secara luas.

### P2 — Cakupan pengikatan masih terbatas

`vars.ts:26` menyediakan sepuluh properti typed binding: radius, gap, padding, strokeWidth, fontSize, letterSpacing, lineHeight, opacity, fontFamily, fontWeight. Color token memakai jalur `node.token` yang hanya mencakup fill/ink utama. Warna border pada `properties.tsx` memakai `ColorPopover` tanpa `tokens`/`onToken`; tidak ada binding warna border, warna gradient stop, shadow, maupun halaman. W/H, posisi, radius per corner, dan padding per side juga belum memiliki binding tersendiri. Ini merupakan batas fitur nyata, bukan klaim bahwa Wonder mengizinkan setiap kombinasi tersebut tanpa observasi lanjutan.

### P2 — Kontrol Properties belum mencakup seluruh referensi

`PropertiesBody` (`properties.tsx:969`) merender Position, Layout, Appearance, Typography, Fill, Border, Shadow, Mask, Export, Layer dan Page. Screenshot historis Wonder memperlihatkan Outline dan Filters; dua bagian ini belum tersedia. Kontrol radius dan border inspector tetap uniform meskipun renderer mendukung override per corner/per side. Fill masih satu warna utama dengan satu field CSS gradient, bukan stack paint dengan add/remove/visibility per paint.

Temuan lanjutan pada pengetikan scalar langsung juga diperbaiki: `model.ts:setField` kini memakai helper `scalarOverrides` yang sama seperti binding, sehingga pengetikan uniform radius/border membersihkan `cornerRadii`/`strokeWidths`. Regression memeriksa nilai CSS yang terlihat dan satu undo mengembalikan nilai individual. Helper juga mencakup padding dan main-axis gap agar aturan pengikatan tidak terpisah dari aturan edit scalar.

## Matriks cakupan

| Area | Bukti Wonder | Verynize saat audit | Status/pengujian yang diperlukan |
|---|---|---|---|
| Page background | Screenshot awal sesi user, referensi 42 | Warna dan alpha halaman | Ada; variable halaman belum didukung |
| Position, constraints, z-index | Referensi 43 | Kontrol tersedia | Flow/absolute perlu observasi Wonder lanjutan |
| Free/flex/grid/block layout | Spesifikasi §3 | Layout, axis, wrapping, alignment, gap | Ada; binding gap diperbaiki untuk override |
| W/H modes, min/max | Spesifikasi §3 | Sebagian mode dan min/max | Audit UI modes lengkap di luar perbaikan ini |
| Padding/margin per axis/side | Spesifikasi §3 | Per-axis/per-side tersedia | Binding padding uniform diperbaiki |
| Opacity, clip | Referensi 43 | Number binding dan clip frame | Ada, test inspector lama |
| Radius | Referensi 43 menunjukkan expand | Scalar binding, tanpa editor corner | Binding scalar diperbaiki; UI per corner belum |
| Font family/weight/size | Referensi 42 dan spesifikasi | Typed binding tersedia | Test inspector lama; batas font-size tidak seragam |
| Fill dan color variable | Referensi 43 | Fill utama, alpha, gradient CSS | Detach diperbaiki; paint stack belum |
| Border | Referensi 43 dan spesifikasi | Uniform width bindable, warna literal | Per-side UI dan color binding belum |
| Outline/Filters | Referensi 43 | Tidak dirender PropertiesBody | Gap eksplisit |
| Shadow/Mask | Referensi 43 | Field CSS | Structured editor dan variable subproperti belum |
| Export | Referensi 43, spesifikasi §3 | PNG/JPEG/WebP/SVG/PDF/HTML | Test inspector lama; bukan bukti semua format Wonder dicoba |
| Variable types | Referensi 42 | Colors + Dimensions + Numbers + Font family + Font weight | Kelima jenis tersedia |
| Icons | Screenshot awal sesi user | Panel terpisah | Audit agent `audit_variables_icons` |

## Validasi

- `node --test integrations/variables.test.mjs integrations/node-style.test.mjs`: 11/11 lulus pada audit awal, sebelum perubahan agent lain pada test variable. Tidak membuka desktop.
- `npm run lint:ui`: lulus pada pemeriksaan awal patch.
- `node --check tests/inspector-variable-binding.cjs`: lulus.
- `npm run typecheck:ui`: lulus setelah agent pemilik memperbaiki error sementara `legacy.ts:78` pada perubahan yang sedang berlangsung.
- Regression UI baru: `node tests/inspector-variable-binding.cjs`. Menggunakan Electron asli dan interaksi inspector, memeriksa warna/alpha, mixed selection, missing token, undo/redo/reload, pengetikan uniform radius/border, radius/border/padding overrides, main/cross axis, dan detach numeric. Belum dijalankan saat dokumen ini ditulis karena agent utama sedang memakai desktop Wonder.
- Jalankan `npm run build:ui` sebelum regression UI. Agent integrator perlu menambahkan test baru ke script `test:canvas`; `package.json` sudah memiliki perubahan pengguna sebelum tugas ini sehingga tidak diedit agent ini.

## Rekomendasi urutan berikutnya

1. Selesaikan bukti Wonder sesi aktif untuk matriks properties × variable, dengan screenshot sebelum/sesudah dan nama layer/variable yang jelas.
2. Jalankan regression UI baru saat desktop bebas; jangan menandai lolos tanpa hasil runtime.
3. Tambahkan editor per-corner/per-side dan tentukan semantik override saat pengguna berpindah dari nilai individual ke uniform.
4. Rancang paint stack dan binding color per properti sebagai perubahan schema konsisten antara renderer, export, codec dan MCP; hindari sekadar menampilkan kontrol yang tidak punya perilaku.

Pemeriksaan hidden-window: tidak ditemukan mode pengujian tersembunyi pada infrastruktur yang ada. `desktop/main.cjs` membuat BrowserWindow langsung; hide setelah launch masih berisiko mengambil fokus. Karena itu regression Electron ditunda sampai agent utama menyatakan desktop bebas, tanpa mengubah default visibility produk.
