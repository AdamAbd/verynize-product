# Audit TanStack Start, Nitro, dan TanStack AI

Tanggal: 2026-10-31. Baseline: `verynize-product`, branch `staging`, HEAD `e14b81b` (sudah mencakup PR #17). Audit source dan dokumentasi melalui Context7, dengan dua agent terpisah untuk Start/deployment dan AI/harness. Tidak menjalankan migrasi, deployment, atau suite test; status test terdahulu di dokumentasi bukan hasil validasi baru.

## Keputusan yang disarankan

Lanjutkan migrasi Start yang sudah berjalan; gunakan Nitro sebagai kandidat packaging Node/Vercel setelah spike kompatibilitas. Tambahkan TanStack AI sebagai runtime model API, dimulai OpenRouter, di balik kontrak harness bersama. Pertahankan runtime Claude Agent SDK dan Codex untuk kemampuan coding lokalnya. Ketiga perubahan ini dapat dikirim bertahap dan tidak perlu menjadi satu rewrite besar.

Start tidak otomatis membawa Nitro sebagai backend wajib. Dokumentasi hosting menawarkan integrasi Nitro untuk beberapa target dan integrasi Vite Cloudflare tersendiri. Nitro membantu HTTP/build/deployment, tetapi tidak menggantikan koordinasi room, penyimpanan, permission, atau eksekusi agent.

## Kondisi aktual repository

- `package.json` dan lockfile sudah memiliki Start 1.169.4, Router 1.170.46, React Query 5.105.0. Belum ada dependency TanStack AI atau Nitro.
- `vite.config.ts:15` memakai plugin Cloudflare dan Start. `web-start/src/server.cloudflare.ts:22-27` membagi request antara backend lama dan Start; ekspor kelas Durable Object dipertahankan di `:16`.
- `vite.node.config.ts:12` membangun aplikasi Start yang sama. `web-start/node/server.mjs` adalah HTTP server khusus yang meneruskan backend/WebSocket ke `VERYNIZE_BACKEND_URL`. Ini berbeda dari `server/node.mjs`, yang menjalankan backend dengan adapter Node.
- `web-start/src/routes/_editor.tsx:9` menggunakan `ssr: false`, lalu memanggil `bootLegacyEditor()`. Start sudah nyata, tetapi editor masih legacy DOM + React islands; belum aplikasi Start dengan satu pemilik routing/UI.
- `scripts/vercel-build.mjs:18` masih menyalin `web/` menjadi static app. `vercel.json` masih memakai SPA fallback dan `api/server.mjs`. Vercel belum memakai shell Start.
- `cloud/platform/` sudah mengimplementasikan Cloudflare, Node, dan Vercel. Cloudflare menggunakan binding native DO/D1/R2 (`cloud/platform/cloudflare/` hanya shim runtime); Node memakai SQLite dan actor in-process; Vercel memakai libSQL, Redis, dan S3 (`S3BlobStore` bersama dari adapter Node). Multi-platform backend sudah ada sebelum Nitro.
- `docs/deployment-vercel.md:5` menyatakan validasi lokal, belum deployment Vercel nyata. Jangan menyamakan keberadaan adapter dengan bukti production readiness.
- `desktop/agent-runtime.cjs:707` hanya menerima `claude` atau `codex`. `web/platform.js:24` mengaktifkan agent berdasarkan API preload Electron. Menambahkan paket AI di server belum membuat chat web bisa dipakai.

## Temuan prioritas

### 1. Endpoint AI baru bisa tidak pernah mencapai Start

`web-start/worker-paths.mjs:5` mengambil seluruh `/api/*`. Dispatcher Cloudflare dan proxy Node mengirimnya ke backend; rewrite Vercel juga mengarah ke fungsi backend. Route Start `/api/chat` saja tidak cukup.

Pilih pemilik endpoint secara eksplisit. Rekomendasi: sediakan namespace `/api/ai/*` di dispatcher dengan prioritas sebelum backend catch-all, atau implementasikan endpoint pada backend yang sudah memilikinya. Uji aturan yang sama di ketiga target dan hindari dua route yang sama-sama menganggap dirinya pemilik. Aturan path saat ini tersebar di empat tempat yang harus diubah bersama: `web-start/worker-paths.mjs`, `runWorkerFirst` di `cloudflare.config.ts`, rewrite `vercel.json`, serta urutan dispatch di `server.cloudflare.ts` dan `web-start/node/server.mjs`. Di Vercel, route Start saat ini tidak tercapai karena shell Start belum di-deploy sama sekali, bukan hanya karena urutan dispatch. Server Node juga menolak upgrade WebSocket di path non-backend (404), sedangkan Cloudflare meneruskan semua upgrade ke worker; samakan perilaku ini jika stream AI memakai WebSocket.

### 2. Nitro bukan pengganti semantik room

Room membutuhkan satu writer, persist-before-ack, dedup, urutan operasi, revocation, dan fan-out. Preset Nitro tidak menyediakan otomatis kontrak tersebut. Pertahankan adapter `cloud/platform/*` selama migrasi HTTP. Khusus Cloudflare, pertahankan identitas Worker, ekspor kelas, binding, dan migrasi DO yang ada.

`web-start/README.md:121-125` menjelaskan bahwa build Node memakai server `node:http` kecil alih-alih Nitro karena Nitro 3 masih RC dan tradeoff proxy WebSocket; alasan itu khusus server Node, sementara `docs/deployment-vercel.md:124-127` masih merencanakan preset Nitro `vercel`. Itu alasan historis, bukan bukti bahwa Nitro sekarang tidak mendukung WebSocket. Dokumentasi Nitro yang diambil sekarang menggunakan `features.websocket` dan menyebut Node, Vercel, serta Cloudflare. Per 2026-11-01, `nitro@latest` adalah `3.0.261029-rc` dan halaman migrasi menyatakan v3 belum stabil; tetapkan versi persis dan verifikasi integrasi terhadap versi itu sebelum implementasi. Jangan mencampur contoh Nitro 2 (`nitropack`) dan Nitro 3 (`nitro`).

Vercel memiliki `upgradeWebSocket` di `api/server.mjs:5` dan cabang WebSocket di `cloud/platform/vercel/handler.js:64-80`. Jika Nitro dimasukkan, tentukan satu pemilik handshake. Dokumentasi Nitro mencantumkan Vercel tanpa catatan, tetapi WebSocket di Vercel Functions masih public beta, memerlukan Fluid Compute, dan dibatasi durasi Function (`vercel.json` memasang `maxDuration: 300`), sehingga socket room harus siap reconnect. Output Build Output API dari preset Nitro `vercel` juga dapat bentrok dengan rewrite `vercel.json` dan fungsi `api/server.mjs` yang ditulis manual. Uji preview nyata; test server lokal tidak membuktikan batas koneksi dan lifecycle Function di platform.

Preset Cloudflare Nitro (`cloudflare_module`; `cloudflare_durable` sudah digabung) mengambil alih `main` dan WebSocket bawaannya memerlukan binding serta migrasi `$DurableObject` tambahan. Dokumentasinya tidak membahas cara mempertahankan migrasi DO dan identitas Worker yang ada, sehingga plugin Cloudflare native tetap pilihan untuk target ini.

### 3. TanStack AI menambah runtime inference, bukan semua kemampuan coding agent

Context7 mengonfirmasi adapter resmi `@tanstack/ai-openrouter`, tool definitions, approval, dan streaming. Ini sesuai untuk chat model API yang menggunakan tool desain Verynize.

Claude/Codex sekarang juga mengurus proses lokal, workspace, sesi, tool coding, sandbox/permission, dan interupsi. Semua itu tidak muncul otomatis dari adapter model. Tambahkan runtime `api-model` terpisah; UI memilih runtime/provider/model secara eksplisit. Login Claude/Codex yang sekarang tidak berarti tersedia kredensial OpenRouter.

### 4. Policy tool harus tetap ditegakkan di executor

Approval UI atau instruksi persona tidak cukup. Kaitkan approval dengan user, run, tool-call ID, dan argumen; tolak replay atau approval yang tidak sesuai. Dokumentasi TanStack AI menyatakan mode approval ephemeral tidak memberi jaminan replay, exactly-once, restart, atau cross-instance karena riwayat tetap input dari client; gunakan persistence middleware yang mencatat dan menggerbangi interrupt pending. API client approval saat ini adalah AG-UI interrupts (`resolveInterrupt`); `addToolApprovalResponse` sudah deprecated. Pertahankan aturan Ask, plan-first, helper run, akses room, dan preference-write gate sebelum eksekusi mutation.

Gunakan `toolTable(backend, context)` di `integrations/design-tools.mjs:368` sebagai sumber schema Zod, metadata, dan fungsi `run`. Buat adapter ke tool TanStack AI tanpa menduplikasi implementasi. `toolDefinition` menerima Standard Schema (Zod v4+), cocok dengan `zod ^4.6.7` di repo, tetapi `toolTable` menyimpan *shape* Zod mentah sehingga harus dibungkus `z.object(shape)`. Tool `raw` seperti `take_screenshot` mengembalikan image berformat MCP dan perlu dikonversi ke `ImagePart` TanStack. Verifikasi kompatibilitas schema, error, hasil image/multimodal, revision checks, dan verification receipts terhadap versi AI yang dipin. Import engine ini juga membawa modul Node; reuse adaptasi cloud yang sudah ada, jangan mengimpor runtime desktop ke Workers.

Dokumentasi `maxIterations(n)` menghitung model turns, bukan tool calls. Satu turn bisa memanggil beberapa tool, sehingga perlu budget terpisah; middleware `onBeforeToolCall` (per turn) dan `onShouldContinue` (kumulatif) dapat dipakai, dengan executor tetap sebagai penegak akhir. Replay stream juga tidak menjamin komputasi agent tetap berjalan setelah proses host berhenti.

### 5. Tool cloud dan desktop memiliki kemampuan berbeda

`cloud/mcp.js` sudah memiliki backend room berotorisasi, tetapi `cloudBackend` masih private. Ekstrak factory/service bersama untuk MCP dan AI dengan identitas akun server, jangan menyalin logikanya atau menerima account ID dari model.

Hosted MCP secara eksplisit tidak memiliki renderer screenshot, preferences lokal, atau shell desktop. Knowledge styles/persona/skills dapat digunakan bersama; tool lokal hanya tersedia di executor desktop. Screenshot untuk chat web memerlukan jalur capture tersendiri sebelum mengklaim validasi visual.

## Bentuk arsitektur tujuan

UI chat memakai `AgentService` dengan operasi run, cancel, approval, dan subscribe. Transport desktop memakai IPC; web memakai endpoint terautentikasi dan stream. Adapter event menormalisasi runtime Claude, Codex, dan TanStack AI ke kontrak chat yang sama, termasuk ID/sequence, tool-call/result, error, usage, dan status terminal.

Executor tool bersama menerapkan policy dan memilih backend dokumen desktop atau room cloud. Knowledge harness tetap independen dari provider. Token OpenRouter disimpan di server atau penyimpanan aman proses utama desktop, tidak dalam bundle/browser. Run web perlu state persisten untuk tool pending, approval, idempotency, cancel, dan reconnect; jangan mengandalkan variabel global Function.

Untuk deployment awal: Cloudflare tetap memakai plugin native; Node/Vercel diuji dengan Nitro untuk shell Start dan HTTP endpoint. Adapter state tetap terpisah. Menyeragamkan semua build ke Nitro hanya layak jika spike membuktikan nilai tambahan dan parity binding/room.

## Urutan implementasi dan acceptance gates

1. **Kontrak dan ownership:** definisikan `AgentService`, capability runtime, event mapping, serta pemilik `/api/ai/*`. Tambahkan pengujian dispatch agar route AI tidak ditelan backend.
2. **Spike Start + Nitro:** pin versi, buat target Node/Vercel, pertahankan jalur Cloudflare. Verifikasi asset allowlist, deep link/404, auth cookies, streaming abort, dan room WebSocket. Uji Vercel preview sebelum mengganti entry produksi. Rollback: konfigurasi build/entry lama tetap tersedia sampai parity terbukti.
3. **AI read-only vertikal:** satu model OpenRouter, streaming chat, cancellation, tool baca room, dan persona/style yang sama. Endpoint wajib mengecek session, room membership, kuota, dan batas tool loop.
4. **Mutation dan approval:** tambahkan tool tulis dengan deny/approve/resume, idempotency setelah reconnect, revocation saat run aktif, dan pembatasan Ask/helper. Bandingkan hasil dokumen lewat suite codec/fidelity, bukan hanya respons teks model.
5. **Integrasi UI:** lepaskan ketergantungan chat pada `platform.desktop` secara bertahap; pertahankan sesi Claude/Codex dan fitur lokal. Bedakan capability dan kredensial provider dengan jelas.
6. **Kurangi shell legacy:** pindahkan home/settings/chat per area, jadikan satu router pemilik navigasi. Canvas tetap imperative sesuai AGENTS.md; tidak perlu diubah ke React untuk menyelesaikan Start.

Gate regresi: build/typecheck/lint; `test:web`; cloud suite per target; platform/agent runtime; routing, cancel dan approval; fidelity dokumen. Live OpenRouter dan deployment Vercel merupakan validasi terpisah yang belum dilakukan dalam audit ini. Jangan mengklaim biaya, latency, atau kualitas model membaik sebelum ada pengukuran pada fixture desain yang sama.

## Dokumentasi eksternal

Diambil melalui Context7 dengan resolve-library-id sebelum query-docs; repository tetap sumber kebenaran untuk implementasi yang sudah ada.

- [TanStack Start hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)
- [Nitro + TanStack Start](https://nitro.build/examples/vite-ssr-tss-react)
- [Nitro WebSocket](https://nitro.build/docs/websocket)
- [Nitro migration](https://nitro.build/docs/migration)
- [Nitro Cloudflare preset](https://nitro.build/deploy/providers/cloudflare)
- [TanStack AI OpenRouter adapter](https://github.com/tanstack/ai/blob/main/docs/adapters/openrouter.md)
- [TanStack AI tool architecture](https://github.com/tanstack/ai/blob/main/docs/tools/tool-architecture.md)
- [TanStack AI tool approval](https://github.com/tanstack/ai/blob/main/docs/tools/tool-approval.md)
- [TanStack AI resumable streams](https://github.com/tanstack/ai/blob/main/docs/resumable-streams/overview.md)
- [TanStack AI maxIterations](https://github.com/tanstack/ai/blob/main/docs/reference/functions/maxIterations.md)

Dokumentasi TanStack AI berasal dari repository `main` melalui library Context7 `/tanstack/ai`. API yang terlihat mencakup `openRouterText`, `createOpenRouterText`, `toolDefinition`, dan `toServerSentEventsResponse`; Per 2026-11-01, `@tanstack/ai`, `@tanstack/ai-openrouter`, `@tanstack/ai-react`, dan `@tanstack/ai-client` berada di 1.0.1 (1.0.0 rilis 2026-10-22, setelah lebih dari 70 rilis 0.x). Pin versi persis. Dukungan Workers untuk core terdokumentasi, tetapi adapter OpenRouter (`@openrouter/sdk`) di Workers belum dibuktikan.

## Validasi 2026-11-01

Divalidasi ulang dengan tiga agent terpisah (klaim repository, Start/Nitro via Context7, TanStack AI via Context7) plus spot-check `npm view` dan source. Koreksi sudah diterapkan di bagian terkait di atas. Ringkasan:

- Klaim repository terverifikasi; koreksi pada rujukan line (`server.cloudflare.ts:16`, `handler.js:64`), detail adapter Cloudflare/Vercel, dan sumber alasan penundaan Nitro.
- Nitro: label "beta" usang, sekarang RC `3.0.261029-rc`. Risiko baru: batas WebSocket Vercel, bentrok routing preset Nitro `vercel`, dan pengambilalihan `main`/migrasi `$DurableObject` oleh preset Cloudflare.
- TanStack AI: stabil 1.0.1; API approval berpindah ke AG-UI interrupts; mode ephemeral tidak anti-replay; hook budget tool call tersedia; adapter perlu `z.object(shape)` dan konversi image.
- Hosted MCP juga tidak menyediakan `ask_agent`, `import_html`, dan `export_document`, selain screenshot, preferences, dan shell.

Kesimpulan: tidak ada temuan yang membatalkan keputusan yang disarankan. Langkah 1 (kontrak dan ownership `/api/ai/*`) dan langkah 3 (AI read-only vertikal, mulai di target Node lokal) bisa dimulai. Langkah 2 tetap spike berbatas: Nitro hanya untuk Node/Vercel, Cloudflare tetap plugin native, dan entry produksi Vercel tidak diganti sebelum preview nyata membuktikan WebSocket, routing, dan auth.
