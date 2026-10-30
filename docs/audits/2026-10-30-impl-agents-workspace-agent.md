# Implementasi: akun agen, tools, otonomi, pencarian global, template/library, dan pemindahan workspace

Tanggal: 30 Oktober 2026. Cakupan: dua celah di `docs/implementation-status.md` ("Provider-hosted multi-account management …" dan "Global source-code search …"). Kode dan teks UI ditulis sendiri.

## 1. Multi-akun penyedia

- `desktop/agent-profiles.cjs` (baru): akun bernama untuk Claude Code dan Codex. Tiap akun punya folder privat `userData/agent-profiles/<agent>/<id>` (mode 0700) yang dipakai sebagai `CLAUDE_CONFIG_DIR` / `CODEX_HOME`. "This Mac" (`system`) adalah login bawaan komputer. Tambah, ganti nama, hapus (folder ikut dihapus), akun default per penyedia, dan pilihan akun per chat. Token tidak pernah dibaca atau dicatat; hanya klaim tampilan (email/paket).
- `desktop/agent-auth.cjs`: `status`/`login`/`logout` menerima `{profile}`; login per akun memakai slot sendiri sehingga login "This Mac" tetap bisa dipakai.
- `desktop/agent-usage.cjs`: `agentUsage.read({agent, profile})` membaca batas paket per akun dengan cache terpisah; Settings › Usage menampilkan satu kartu per akun bernama.
- `desktop/agent-runtime.cjs`: akun run = pilihan eksplisit → pilihan chat → default. Claude mendapat env akun; Codex menjalankan satu app-server per akun (`codexPool`).
- UI: Settings › Accounts (`web/src/islands/settings/accounts.tsx`).
- Login browser: alur diuji sampai CLI login diluncurkan dengan folder akun terisolasi (fixture CLI). **Login penyedia sungguhan = butuh kredensial live (belum diverifikasi).**

## 2. Konfigurasi tools/plugin

- `desktop/agent-tool-config.cjs` (baru): server MCP milik Verynize (stdio/HTTP, global atau per proyek, untuk Claude/Codex/keduanya, bisa dinonaktifkan) dan default izin per tool (allow/ask/deny, pola `prefix*`, aturan proyek menimpa global).
- Claude: `mcpServers`, `allowedTools`, `disallowedTools`. Codex: `-c mcp_servers.<nama>.command/args/env_vars/url/bearer_token_env_var`; nilai env dikirim lewat environment anak, tidak pernah lewat argv. Renderer hanya melihat nama variabel.
- UI: Settings › Tools (`web/src/islands/settings/tools-config.tsx`).

## 3. UI otonomi per chat

- `desktop/agent-autonomy.cjs` (baru) + tombol gauge di composer (`web/src/islands/chat/autonomy-panel.tsx`): level akses, akun, tool diizinkan/ditolak, aturan auto-approve (`Tool: teks`), maks turn, budget USD, "plan before edits".
- Penegakan di runtime: Claude `maxTurns`, `maxBudgetUsd`, `permissionMode:'plan'`, daftar tool; Codex: langkah tool dihitung dan run dihentikan saat lewat batas, plan-first = sandbox read-only + approval `untrusted` + instruksi persona; budget menghentikan run bila biaya yang dilaporkan melebihi batas. Keputusan otomatis lewat `askPermission` (otonomi chat → default Tools).
- Transkrip: event `autonomy` (ringkasan efektif, hanya bila chat dikustomisasi/akun bernama/server tambahan) dan `policy` (allow/deny/limit) dirender oleh `transcript.tsx`; `web/desktop-panel.js` mendapat dua `case` kecil.

## 4. Pencarian global

- `desktop/project-search.cjs` (baru): ripgrep (`@vscode/ripgrep` bila terpasang, else `rg` di PATH) atau walker Node (`git ls-files --exclude-standard`, atau `.gitignore` root di folder non-git). Melewati `.git`, `node_modules`, file biner, >1 MB. Juga mencocokkan nama halaman/layer/teks di `*.verynize.json`.
- Dialog ⌘⇧F / tombol "Search all projects" (`web/src/islands/settings/projects.tsx`); hasil membuka file di editor Code workspace (`window.codeWorkspace.openFile`, tambahan kecil di `code.tsx`/`controller.ts`), hasil desain di-reveal di Finder.
- `@vscode/ripgrep` tidak ditambahkan sebagai dependensi (package.json dipakai bersama); di mesin ini `rg` sistem dipakai, fallback Node teruji.

## 5. Ekosistem template/library

- `web/views-templates.js`: galeri dengan kategori, pencarian, pratinjau SVG, simpan dokumen/seleksi sebagai template, hapus, impor/ekspor paket JSON (`verynize-template-pack` v1), dan library komponen bersama antar file (localStorage): tambah dari seleksi, sisipkan instance (`libraryComponent:{id,version}`), publikasikan perubahan instance (versi naik), perbarui instance usang. Kontrak lama (`#templates-open`, `[data-template]`, `designTemplates.create`) tetap.
- Batas: paket **.zip belum didukung** (hanya JSON); library tersimpan lokal per instalasi, bukan disinkronkan cloud.

## 6. Pemindahan workspace yang menjaga histori

- `desktop/repository-moves.cjs` (baru): `git mv` + commit di dalam repo (proyek bersarang ikut dipindah di registry); rename/pindah folder repo + `git worktree repair` + update registry/worktree; pindah lintas repo dengan `format-patch`/`am` (file atau folder, plus commit sinkron bila merge menyembunyikan isi) atau `subtree split/add` (folder). Hanya tree bersih; ditolak saat agen berjalan di sana.
- Renderer memindahkan kunci chat `better-agent-chats:<root>` dan draft ke root baru (`migrateChatStorage`). UI: Settings › Projects.

## Pengujian (semua lulus di mesin ini)

- `node --test tests/agent-accounts-tools.cjs` (8): profil, auth per akun dengan CLI fixture, usage per akun, tool config, otonomi, runtime Claude (SDK terskrip) dan Codex (`tests/fixtures/fake-codex.cjs`, kini juga mencatat `CODEX_HOME`), batas budget.
- `node --test tests/workspace-search-moves.cjs` (8): pencarian ripgrep dan Node pada repo git sementara nyata; pindah di dalam repo, relocate dengan worktree chat, lintas repo (patches dan subtree), file tunggal.
- `node tests/agent-workspace-ui.cjs` (Electron): Accounts + login terisolasi, Tools, Projects, pencarian global → editor, panel otonomi + catatan transkrip, galeri template dan library komponen, ekspor/impor paket.
- Regresi lulus: agent-options/auth/behavior/runtime/usage-memory/tools/commands/live-status, repositories, desktop-projects, window-cleanup, agent-chat, chat-composer-menu, chat-indicators, chat-markdown, code-workspace, changes-panel, desktop-ipc, settings, views-templates, wonder-shell. `npm run build:ui`, `lint:ui`, `typecheck:ui`, `check` bersih. Tes baru didaftarkan di `test:desktop`.

## Batas bukti

Tidak ada akun penyedia nyata atau model yang dipakai. Login browser sungguhan, batas paket akun bernama yang nyata, dan server MCP pihak ketiga nyata belum diverifikasi.

## Tindak lanjut (30 Oktober 2026): paket .zip dan ripgrep bawaan

Dua batas di bagian 4 dan 5 di atas kini ditutup.

- **Paket template .zip**: `desktop/template-packs.cjs` (baru) berisi penulis/pembaca zip minimal buatan sendiri di atas `zlib` Node (entri stored/deflate, CRC-32 sendiri, tanpa dependensi baru). Isi paket: `manifest.json`, `templates/<n>.verynize.json`, `components/<n>.json`, dan `assets/<sha256>.<ext>`. Setiap gambar `data:image/…;base64` disimpan sekali sebagai aset lalu dirujuk dengan `verynize-asset:…`; saat impor, gambar dipulihkan. Pembacaan menolak: path zip-slip (`..`, path absolut, backslash, huruf drive), file atau folder di luar pola yang diizinkan, nama ganda, entri >20 MB (dicek di header dan saat inflate lewat `maxOutputLength`), total >100 MB, arsip >50 MB, ukuran/CRC tidak cocok, dan enkripsi. IPC yang ditambahkan: `templatePacks.encode/decode`, berupa byte saja tanpa akses file system. Galeri mengekspor .zip di aplikasi desktop (JSON di web), dan mengimpor .zip maupun .json (dideteksi dari magic `PK`). Paket JSON tetap berfungsi.
- **@vscode/ripgrep**: ditambahkan sebagai dependensi produksi (`npm install`, lockfile diperbarui dengan paket biner per platform, versi aplikasi tidak berubah). `findRipgrep()` memilih biner bawaan lebih dulu, lalu `rg` sistem, lalu walker Node. Hasil pencarian kini menyertakan `ripgrep: 'bundled'|'system'|null`, dan dialog menampilkannya sebagai `data-ripgrep`. Aplikasi dikemas tanpa asar, jadi tidak perlu asar-unpack. `scripts/package-macos.cjs` kini mewajibkan paket tersebut dan memastikan biner `ripgrep-darwin-<arch>/bin/rg` ikut dikirim dan dapat dieksekusi. `npm run package:mac` belum dijalankan ulang.
- **Regresi**:
  - `node --test tests/template-packs.cjs` (4 tes): nilai referensi CRC, round trip dengan satu aset bersama, interoperabilitas dua arah dengan `zip`/`unzip` sistem, zip-slip, entri tak terduga, oversize, header yang berbohong, CRC rusak, entri ganda, manifest hilang.
  - `tests/workspace-search-moves.cjs` kini menguji varian bundled, system, dan node, serta urutan preferensi biner.
  - `tests/agent-workspace-ui.cjs` kini memastikan `data-ripgrep="bundled"` dan menjalankan ekspor/impor .zip lewat file picker dengan gambar yang dipulihkan.
- **Hasil**: `build:ui`, `lint:ui`, `typecheck:ui`, dan `check` bersih. Tes yang terdampak lulus: template-packs, workspace-search-moves, agent-accounts-tools, agent-workspace-ui, views-templates, settings. `tests/template-packs.cjs` didaftarkan di `test:desktop`.
