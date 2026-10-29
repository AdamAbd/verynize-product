# Plan: migrasi renderer canvas dari DOM ke PixiJS v8 (hybrid)

Ditulis 2026-10-28. Tujuan: parity dengan Wonder 0.2.183 dan seluruh item di https://wonder.design/roadmap.

## 1. Apakah PixiJS alasan Wonder bisa menjalankan web di canvas?

Tidak. Bukti statis dari cache renderer Wonder (`/tmp/wonder-canvas-cache/js`, dibaca tanpa dieksekusi):

| Temuan | Status |
| --- | --- |
| Node app preview membuat `<iframe>` DOM sungguhan (`surface: canvas`, `pointerEvents = none`), dimasukkan ke `container` milik node di canvas | observed |
| Iframe baru menerima input saat mode **Navigate**. **Edit** dan **Capture** (Enter = elemen, ⌘Enter = halaman penuh) memakai alat terpisah | observed |
| Bundle PixiJS v8 memuat `DOMContainer`/`DOMPipe`, yang menyinkronkan transform kamera ke elemen HTML lewat CSS `matrix()` | observed (library) |
| Wonder memakai `DOMContainer` khusus untuk iframe preview | inferred; tidak ditemukan pemanggilan langsung |
| `html-in-canvas` (`layoutsubtree` / `copyElementImageToTexture`) hanya dipakai satu efek shader eksperimental yang butuh Chrome Canary dengan flag | observed |
| Node desain (frame, fill, border, teks) digambar dengan container dan `Graphics` Pixi di `Renderer-*.js`, ditambah overlay judul berbasis DOM | observed |
| Mesin layout flex/grid: tidak ada Yoga atau Taffy. Ada pengukuran `getBoundingClientRect` dan `getComputedStyle` | unknown; kemungkinan browser atau server |

Kesimpulan: web app di canvas adalah **iframe DOM yang ditumpuk di atas canvas WebGL dan ikut transform kamera**. Pendekatan ini sama mudahnya dengan renderer DOM kita saat ini. Wonder memakai PixiJS untuk **skala dan kualitas**: ribuan node, zoom sampai 20000%, shader GPU di dalam scene, dan handle yang tetap tajam. Live preview tidak bergantung pada PixiJS.

## 2. Pilihan teknologi (dicek via context7 dan npm)

| Opsi | Versi | Kelebihan | Kekurangan | Keputusan |
| --- | --- | --- | --- | --- |
| **PixiJS v8** | `pixi.js` 8.22.0 | WebGL/WebGPU, sama dengan Wonder; `DOMContainer` untuk iframe/input; `Graphics`, `Text`/`HTMLText`/`BitmapText`, filter, blend mode, mask, render-to-texture, EventSystem; shader GLSL/WGSL bisa masuk scene | `DOMContainer` masih EXPERIMENTAL; layout CSS harus dikerjakan sendiri | **Dipilih** |
| Konva | 10.9.0 | API editor bagus (Transformer), dokumentasi kuat | Canvas 2D saja, tanpa WebGL; skala bergantung pada cache dan layer; tanpa jalur shader; overlay HTML hanya lewat `react-konva-utils` (React) | Ditolak: tidak bisa menyamai shader dan skala Wonder |
| WebGL/WebGPU mentah | — | Kontrol penuh | Membangun ulang batching, teks, event dan mask sendiri. Biaya bulanan | Ditolak |
| `@pixi/layout` (Yoga) | 3.2.1 | Flex di atas Pixi | **Hanya flexbox**: tidak ada grid, block, inline atau teks inline campuran; hasilnya beda dengan CSS asli dan dengan export HTML kita | Ditolak sebagai mesin layout utama |
| Tetap DOM | — | Fidelity CSS sempurna, capture dan export gratis | Lambat untuk ribuan node; zoom besar memaksa re-layout; shader adalah canvas terpisah per node | Dipakai sebagai **mesin layout dan referensi**, bukan sebagai painter |

## 3. Arsitektur target: "browser menghitung layout, Pixi menggambar"

```
document (v2 JSON) ──► LayoutHost (DOM tersembunyi, CSS asli) ──► LayoutSnapshot {id → rect, lineBoxes, clip}
          │                                                         │
          └──────────────► SceneSync (diff per node) ◄──────────────┘
                                   │
                   PixiJS Application (WebGL, WebGPU opsional)
                   ├─ world (ikut kamera)
                   │   ├─ node containers: fills/gradients, borders, radius per sudut, shadows (filter), masks, blend, opacity
                   │   ├─ text: Pixi Text/HTMLText per line box, re-raster saat zoom berhenti
                   │   ├─ images: Texture + mipmap
                   │   ├─ shaders: Filter/Mesh dengan shader GLSL kita
                   │   └─ live app: DOMContainer(<iframe>) → Navigate/Edit/Capture
                   └─ overlay (ruang layar): seleksi, handle, smart guides, marquee, label ukuran, kursor kolaborasi
```

- **LayoutHost**: render dokumen sebagai DOM CSS asli di subtree `visibility:hidden` atau `contain:strict`, memakai serializer yang sama dengan `integrations/export-html.mjs`. Dengan begitu export, MCP JSX dan canvas memakai satu definisi CSS (code in = code out). Posisi diambil dengan `getBoundingClientRect` dan baris teks dengan `Range.getClientRects()`. Layout diukur ulang hanya untuk subtree yang kotor.
- **SceneSync**: diff berdasarkan `node.id` sehingga hanya container yang berubah yang di-update. Hal ini penting untuk streaming edit MCP dan Yjs.
- **Camera**: satu matriks world. Logika `web/canvas-interactions.js` (zoom stop, pan, cursor anchor) dipindah ke `web/render/camera.js`, dan zoom dinaikkan sampai 20000%.
- **Hit-test**: indeks spasial (R-tree pada rect hasil layout) dipakai untuk seleksi, marquee dan snapping. Pixi `eventMode` hanya dipakai untuk handle.
- **Antarmuka renderer**: `createRenderer({kind:'pixi'|'dom'})`. DOM tetap ada sebagai fallback (tanpa WebGL) dan sebagai **oracle uji piksel**.

## 4. Fase (setiap fase berisi agen paralel dengan kepemilikan file yang terpisah)

| Fase | Isi | Agen paralel | Exit criteria |
| --- | --- | --- | --- |
| **0. Fondasi model** | Migrasi model style ke bentuk CSS: daftar fill, border per sisi, radius per sudut, padding/margin per sisi, shadow/filter list, blend, flip, min/max, ukuran %/auto. Migrator v2 → v3, validasi store, codec JSX dan export | A: model + migrator + store · B: jsx-codec/export · C: inspector UI | Semua dokumen lama lolos round-trip; `npm test` hijau |
| **1. Renderer Pixi minimal** | `pixi.js@8.22.0`, `web/render/*`, kamera, LayoutHost, frame/rect/fill/border/radius/image/teks dasar; flag `?renderer=pixi` | A: LayoutHost + SceneSync · B: paint primitives · C: camera + overlay + hit-test | Perbedaan piksel dengan renderer DOM ≤ 1% pada template dan fixture `tests/render-export.cjs` |
| **2. Fitur gambar penuh** | Gradien dan mask, shadow (filter), blend mode, opacity grup, clipping, mixed text runs, shader preset sebagai Filter di scene | A: efek dan mask · B: teks · C: shader | Fixture `canvas-advanced`/`canvas-shaders` lolos di kedua renderer |
| **3. Interaksi di atas Pixi** | Pindahkan seleksi, resize/rotate, guides, marquee, drag, clipboard dan edit teks inline (memakai `DOMContainer` contentEditable) ke overlay baru | A: transform tools · B: text editing · C: port tes interaksi | `tests/canvas-interactions.cjs` lolos dengan `renderer=pixi` |
| **4. Live app node (Preview)** | Tipe node `preview`: iframe dalam `DOMContainer`, chrome (alamat, reload, Publish/Stop), mode Navigate/Edit/Capture, snapshot statis saat tidak aktif, terhubung ke `desktop/preview.cjs` dan capture yang sudah ada | A: node + DOMContainer · B: mode Capture → node · C: dev-server/worktree wiring | Tes Electron: jalankan app lokal di canvas, Navigate, Capture elemen menjadi layer |
| **5. Skala dan kualitas** | Culling, LOD teks, cache texture per frame statis, mipmap image, zoom 5–20000%, WebGPU opsional | A: perf + benchmark · B: LOD teks/gambar | Dokumen 10k node berjalan ≥ 55 fps saat pan di M-series; zoom 20000% tetap tajam |
| **6. Cutover** | Pixi jadi default dan DOM jadi fallback; dokumentasi, packaging (bundle `node_modules`/`pixi.js` di `scripts/package-macos.cjs`) | 1 agen | `npm test`, `npm run test:package`, `vp check` hijau |

## 5. Item roadmap Wonder yang perlu ditutup selain renderer

| Roadmap (status Wonder) | Better Design sekarang | Pekerjaan |
| --- | --- | --- |
| Vector editing (Planned) | Belum ada | Node `vector` (path) dengan Pixi `Graphics`, pen tool, edit titik, boolean (fase setelah 3) |
| Measurements & Snapping (Shipped) | Ada (DOM) | Port ke overlay Pixi (fase 3) |
| Code in, code out (Shipped) | JSX/HTML ada | Satu serializer untuk LayoutHost, export dan MCP (fase 0–1) |
| Wonder Capture / Preview (Shipped) | Panel terpisah + capture | Live app sebagai node canvas (fase 4) |
| Icon library (Shipped) | 4 ikon | Pustaka Phosphor penuh + tool MCP ikon |
| Code Components (In Progress) | Belum ada | Node komponen dari source repo (render iframe terisolasi per komponen), props di inspector |
| Wonder MCP / Chat (Shipped) | Ada (24 tool lokal) | `execute_action`, ikon, streaming ghost preview, image tools |
| Real-time collab (Shipped) | Snapshot + WebSocket | Yjs per node (sesuai Wonder) agar edit agen dan user bisa digabung |
| Advanced sharing, Comments (In Progress) | Publish snapshot | Izin per orang, komentar berjangkar ke node |
| Better design search (Planned) | Pencarian nama/teks lokal | Pencarian semantik dan visual lintas file |
| Shared previews (Early access) | Belum ada | Bagikan URL preview app yang berjalan |
| Public profiles, Cloud, Marketplace | Belum ada | Butuh akun hosted; di luar renderer dan dikerjakan terakhir |

## 6. Risiko

- `DOMContainer` masih eksperimental, jadi versi `pixi.js` di-pin dan perilakunya ditutup dengan tes.
- Fidelity teks (kerning, wrap, emoji): line box diambil dari browser dan digambar dengan font yang sama. Selisih kecil tetap mungkin ada, sehingga diukur dengan diff piksel.
- LayoutHost menambah biaya reflow. Pengukuran dibatasi per subtree kotor dan dibatch per frame.
- Iframe tidak bisa diputar atau diklip dengan rounded corner sebaik texture. Saat tidak aktif, iframe diganti snapshot texture.
- Packaging saat ini belum membawa `node_modules`, dan hal ini harus diperbaiki pada fase 6.
