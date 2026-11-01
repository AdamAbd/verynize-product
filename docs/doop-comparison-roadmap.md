# Perbandingan doop vs Verynize dan bahan roadmap

Tanggal: 1 November 2026.

Sumber:

- Riset awal oleh Codex (astra) atas [kgoedecke/doop](https://github.com/kgoedecke/doop) dan Verynize.
- Validasi ulang dengan dua agen paralel (clone doop baru dan audit kode Verynize) serta pemeriksaan halaman GitHub doop di browser.

Basis yang divalidasi:

- doop HEAD `53698d9` (commit 1 November 2026).
- Verynize HEAD `e0e71a5` di branch `feat/ai-durable-byok-shell`, versi 0.17.0.

Kedua aplikasi tidak dijalankan. Semua temuan berasal dari kode dan dokumentasi.

## Ringkasan

doop lebih menonjol sebagai ruang kolaborasi desain manusia dan AI. Verynize punya fondasi yang lebih luas untuk menghubungkan desain dengan pengerjaan kode lokal. Pelajaran terpenting dari doop adalah workflow timnya: feedback, tugas agen, review, lalu persetujuan untuk developer. Teknologi inti Verynize tidak perlu diganti.

## Fitur doop yang terverifikasi

| Fitur | Status | Bukti dan catatan |
|---|---|---|
| Frame menyimpan HTML/CSS | Benar | `shared/types.ts:14` (`html: string`). Agen mengedit lewat `set_frame_html`, `append_frame_html` dan `edit_frame_html`. |
| Peran agen dalam pipeline berurutan | Benar | `shared/agents.ts:28-95`. Peran: `doop` (designer), `ux`, `copy`, `brand`, `a11y`, `polish`. `brand` dan `a11y` berperan sebagai reviewer. Server menjalankan tahap secara berurutan (`server/actions.ts:163-177`, `1252-1269`). Pipeline hanya berlaku untuk kartu board. |
| Komentar memicu agen | Sebagian | @mention di komentar langsung memanggil agen bawaan (`actions.ts:811-848`). Komentar tidak menjadi kartu tugas. Ringkasan hasil agen bawaan masuk ke activity feed (`server/resident.ts:819`), bukan ke thread. Hanya agen MCP eksternal yang bisa membalas di thread (`reply_to_comment`). |
| Design memory yang dikurasi | Benar | `server/distill.ts:6-15`. Usulan aturan menunggu keputusan manusia untuk diterima ke style guide atau ditolak. Aturan yang ditolak tidak diusulkan lagi. Fitur ini hanya aktif jika `ANTHROPIC_API_KEY` diset. |
| Prototyping antarframe | Benar | `shared/prototype.ts`. Interaksi disimpan sebagai atribut `data-doop-*`. Trigger: click, hover, press, delay, key. Aksi: navigate, back, overlay, scroll-to, url. Tersedia 8 transisi. |
| Approval `ready_for_dev` | Benar | Status otomatis berubah menjadi `needs_review` ketika HTML, lebar atau tinggi frame berubah (`server/store.ts:680-687`). Memindahkan, mengganti nama atau mengunci frame tidak membatalkan approval. Approval bisa memicu automation. |
| Figma, Canva dan PSD hanya di Doop Cloud | Benar | README: "Figma, Canva and Photoshop (PSD) import and export are currently available in Doop Cloud and not part of the open source." |
| Lisensi | AGPL-3.0 | Repo juga punya `CLA.md`. Verynize berlisensi MIT. |

Fitur doop lain yang tidak masuk riset awal:

- Klien agen: Claude Code, Codex, ChatGPT, Cursor, OpenCode, dan agen bawaan multi-model dengan kunci API milik pengguna (BYOK).
- Automations yang dipicu jadwal atau approval.
- Integrasi Linear, Slack dan Meta Ads di repo open source.
- Riwayat versi frame dengan restore, webhooks/REST API dan gambar frame publik.
- Aplikasi iOS SwiftUI yang merender frame dengan engine Blitz (Rust, tanpa WebKit).
- Stack: Express di Node, Postgres/Drizzle, React 18, Tailwind 4, Zustand, sinkronisasi live lewat WebSocket, dan desktop Tauri.

## Posisi Verynize

Kemampuan berikut sudah ada di Verynize:

- Dokumen node terstruktur (`web/document-core.js`) dengan konversi JSX dan HTML/CSS.
- Worktree Git per chat, editor file, terminal PTY dan preview dev-server.
- Capture preview menjadi layer yang bisa diedit.
- Agen Claude dan Codex lokal.
- Dokumen yang sama bisa diedit dari aplikasi maupun CLI/MCP.
- AI web lewat OpenRouter, dengan backend Cloudflare, Node dan Vercel. Backend ini belum pernah di-deploy.

Fitur parsial yang ternyata sudah ada:

- **Komentar pada layer**: `cloud/rooms.js:40` dan `web/cloud-panel.js:47-50`. Belum ada thread balasan, status resolve, atau hubungan ke agen.
- **Design preferences**: maksimal 50 aturan yang dimasukkan ke setiap chat dan tool MCP (`desktop/agent-runtime.cjs:97-116`, `integrations/preferences.mjs`). Ada juga 31 named style dan `integrations/design-knowledge/`. Preferences tersimpan per pengguna di mesinnya sendiri. Belum ada aturan bersama untuk satu tim, alur persetujuan, atau penyimpanan referensi visual.

## Gap dan usulan roadmap

Urutan berdasarkan besarnya gap dan apa yang sudah bisa dipakai ulang.

1. **Approval desain berbasis revisi (gap penuh).**
   - Tandai frame "ready for dev", lalu ubah otomatis ke "needs review" ketika geometri atau konten frame berubah.
   - Agen dan MCP bisa memfilter frame yang sudah disetujui sebelum implementasi.
   - Status ini bisa dihubungkan ke workflow worktree dan chat coding yang sudah ada.
2. **Komentar → agen → hasil di thread.**
   - Komentar pada layer sudah ada.
   - Yang perlu ditambahkan: thread balasan, status resolve, @mention agen yang memulai run, dan balasan agen ke thread.
   - Ini juga menutup kelemahan doop, yang tidak mengembalikan hasil agen bawaannya ke thread.
3. **Design memory untuk satu tim.**
   - Naikkan design preferences menjadi aturan bersama di cloud room.
   - Tambahkan alur usul, terima dan tolak, serta referensi visual yang disematkan.
4. **Prototyping antarframe (gap penuh dan paling besar).**
   - Perlu model interaksi baru di skema dokumen, codec, export dan preview.
   - Saat ini hanya ada "interaction variants" yang tersimpan sebagai metadata tanpa UI edit (`docs/implementation-status.md:83`).

Kandidat tambahan dari doop:

- Automations yang dipicu approval.
- Riwayat versi per frame.
- Integrasi Linear dan Slack.

## Housekeeping yang ditemukan

`README.md` tertinggal dari `docs/implementation-status.md`:

| README menulis | implementation-status.md mencatat |
|---|---|
| `.fig` belum diimplementasi (`:42`) | Import `.fig` dan paste dari clipboard sudah ada (`:71`) |
| Tidak ada embedding font kustom, capture halaman remote, recovery interaksi, atau source mapping (`:54`) | Keempatnya sudah ada (`:72`) |
| Belum ada rewind atau resume percakapan penuh (`:52`) | Resume dan rewind dengan fork sesi sudah ada (`:35`) |
| Token Figma tidak disimpan (`:58`) | OAuth PKCE dengan token terenkripsi (`:71`) |
| Belum ada model gambar fotografis; trace masih kotak-kotak tanpa kurva halus (`:60`) | Provider gambar dan tracing Bézier halus sudah ada (`:73`) |
| Sinkronisasi snapshot dan berbagi kapabilitas, bukan sistem akun (`:46`, `:88`) | Akun, passkeys, role, merge berbasis operasi dan organisasi Better Auth (`:40`, `:76`) |
| Worktree `design/name` (`:50`) | Worktree per chat (`:14`) |

Masalah lain:

- README belum menyebut AI web lewat OpenRouter, backend Node dan Vercel, hosted MCP, maupun Code workspace.
- `docs/implementation-status.md:96` masih menulis aplikasi terpaket versi 0.3.0.
