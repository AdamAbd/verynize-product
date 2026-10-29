# Audit kualitas orchestrator → UI canvas

Tanggal: 29 Oktober 2026. Target: kualitas hasil Better Design minimal setara Wonder dan Pen; Figma dan FigCraft sebagai pembanding tambahan.

## Kesimpulan

Better Design sudah punya runtime agent, live MCP, editable scene, dan screenshot. Namun implementasi sekarang belum memaksakan proses desain yang terarah dan verifikasi visual sebelum selesai. Ada kehilangan informasi layout di codec yang terbukti lewat eksekusi langsung. Meningkatkan model atau mengganti renderer saja tidak menyelesaikan dua masalah ini.

Belum ada benchmark keluaran dengan brief identik di semua aplikasi. Karena itu audit ini **tidak menyatakan parity 1:1 tercapai**, dan tidak memberikan skor kualitas kompetitor yang dibuat-buat. Audit mencakup kode, probe codec, tes runtime/import, dokumentasi resmi, dan inspeksi aplikasi lokal oleh agent terpisah.

## Temuan yang harus didahulukan

1. **P0 — Fidelity layout rusak sebelum digambar.** `integrations/jsx-codec.mjs:124` mengubah `px-8 py-3` menjadi padding 32px ke semua sisi, tanpa warning. `:148-149` meratakan radius per sudut. Probe `rounded-t-xl rounded-b-sm` menghasilkan radius 2px semua sudut. `gap-x-8 gap-y-2` serta `md:grid-cols-3` diabaikan. Ini kehilangan maksud desain yang bisa terlihat seperti halusinasi model.
2. **P0 — Finished bukan verified.** `integrations/design-tools.mjs:231-238` hanya fokus ke artboard dan mengembalikan finished; screenshot terbaru, clipping, missing assets dan kritik visual tidak menjadi syarat. Runtime menyelesaikan giliran ketika provider selesai.
3. **P1 — Arahan desain terlalu generik.** `desktop/agent-runtime.cjs:32-46` memberi persona editor, bukan kontrak audience, hierarki, density, typography, referensi, dan acceptance criteria. Hasil sangat bergantung pada prompt serta default model.
4. **P1 — Font dan aset belum terjamin.** Ukuran teks memakai estimasi karakter (`integrations/design-edit.mjs:110-117,250`); komponen ikon dilewati dan URL gambar nonembedded menjadi placeholder (`:130,156`). Warning belum mencegah penyelesaian.
5. **P1 — Tes fungsional belum mengukur taste.** Tes runtime/import berguna, tetapi tidak menjawab apakah output lebih baik atau setara Wonder/Pen.

## Bukti aplikasi terpasang

Wonder lokal adalah **0.2.185**, sementara dokumen riset lama menargetkan 0.2.183. Pen adalah **1.2.20** (`dev.pencil.desktop`), berbeda dari OpenPencil yang juga terpasang. Bundled markdown Pen menunjukkan 26 archetype style, panduan per domain, `ctx.bounds`/`ctx.problems`, screenshot per section, dan penantian aset asynchronous. Ini bukti instruksi/kemampuan yang dikemas, belum bukti enforcement runtime atau keberhasilan setiap generasi. Inspeksi manifest juga melaporkan 39 mismatch integritas unpacked member; perlakukan temuan sebagai byte lokal yang diamati, bukan verifikasi distribusi resmi. Detail dan path: [audit pembanding lokal](2026-10-29-local-comparators.md).

## Yang layak diadopsi dari pembanding

- **Wonder:** konteks seleksi/referensi, eksplorasi beberapa arah, refinement terpilih, dan grounding pada komponen/tokens repo. Sumber: [Ideate on the canvas](https://wonder.design/docs/ideate-on-the-canvas), [Design is code](https://wonder.design/docs/design-is-code).
- **Pen:** skill sebagai instruksi terpisah dari tool, library komponen dan variables, eksplorasi layout dipisahkan dari style, serta mode kerja paralel yang eksplisit. Sumber: [AI agents](https://docs.pencil.dev/core-concepts/ai-agents), [Design libraries](https://docs.pencil.dev/core-concepts/design-libraries).
- **Figma:** jangan menyamakan pengalaman halusinasi dengan penyebab tunggal pada aplikasinya. Audit apakah frame, variables, component identity dan screenshot benar-benar sampai ke agent. [Dokumentasi MCP vs agent](https://developers.figma.com/docs/figma-mcp-server/mcp-vs-agent/) menjelaskan pembagian tanggung jawab ini.
- **FigCraft ArtCraft:** pola shared command engine UI/CLI/MCP serta fixture yang dirender oleh renderer sendiri layak dipakai untuk reproduksibilitas. Identitas: [storytold/figcraft](https://github.com/storytold/figcraft). Ini referensi arsitektur, bukan bukti taste terbaik.

Dokumentasi produk adalah bukti kemampuan yang didokumentasikan, bukan bukti kualitas konsisten atau akses ke orchestrator internal mereka.

## Kontrak orchestrator yang direkomendasikan

1. **Brief:** simpan jenis layar, audience, isi wajib, viewport, batas perubahan, dan kriteria selesai. Infer dari konteks; tanyakan hanya informasi yang benar-benar menghambat.
2. **Reference pack:** screenshot terpilih beserta alasan konkret: hierarchy, type scale, density, spacing, image treatment. Bedakan atribut yang dipertahankan dengan yang boleh dieksplorasi.
3. **Capability/asset preflight:** capability manifest codec, font terpasang/siap, ikon yang bisa di-resolve, gambar valid, component identity dan tokens nyata. Unsupported tidak boleh diam-diam menjadi bentuk lain.
4. **Design direction:** buat alternatif kecil saat brief ambigu, pilih arah berdasarkan kebutuhan dan referensi. Hindari banyak agent menulis layar yang sama secara bersamaan.
5. **Compose:** skeleton hierarki dahulu, lalu detail; gunakan operasi scene bertahap dengan revision check.
6. **Render:** tunggu font dan aset siap, ambil screenshot renderer aktual dengan document/page/artboard/revision/viewport yang tercatat.
7. **Critique:** cek overflow, teks terpotong, aset hilang, ketidaksesuaian tokens, dan fidelity; nilai hierarchy, typography, spacing, warna, konten serta relevansi aset secara terpisah.
8. **Repair:** batasi misalnya tiga iterasi; perbaiki temuan spesifik, pertahankan arah desain. Jika masih gagal, simpan draft dan laporan masalah.
9. **Finish:** pisahkan status edited, unverified, verified. Receipt verifikasi batal setelah perubahan scene. Screenshot saja bukan bukti bahwa kritik berhasil.

Quality gate utama harus ada di application runtime/MCP agar berlaku untuk Claude, Codex, dan fallback. Context7 resolve + query resmi Claude Agent SDK memverifikasi hooks sebagai sarana tracking/feedback; hooks satu provider tidak otomatis mencakup backend lain. Timeout hook juga tidak boleh menyebabkan app mengklaim verifikasi sukses. Sumber: [SDK hooks](https://code.claude.com/docs/en/agent-sdk/hooks).

## Urutan implementasi dan kriteria selesai

- **Tahap A — Representasi:** directional padding/gap/radius, diagnostic unsupported yang eksplisit, schema migration/round-trip. Selesai ketika button/header/card fixtures mempertahankan setiap sisi dan sudut di canvas serta export.
- **Tahap B — Kejujuran completion:** receipt per revision, state unverified saat screenshot unavailable, failure terstruktur. Selesai ketika stale screenshot, missing asset, dan unresolved critical warning tidak bisa menghasilkan verified.
- **Tahap C — Grounding:** brief/reference pack, tokens lebih luas dari warna, komponen/ikon nyata, font measurement. Selesai ketika contoh referensi dapat direkonstruksi tanpa substitusi diam-diam.
- **Tahap D — Kritik dan repair:** loop berbatas, log alasan/perubahan dan output sebelum/sesudah. Selesai ketika kasus cacat yang sengaja dimasukkan terdeteksi dan diperbaiki atau dilaporkan gagal.
- **Tahap E — Benchmark:** jalankan paired evaluation di bawah. Migrasi Pixi tetap proyek performa/renderer terpisah; lakukan ketika bottleneck terukur, bukan sebagai pengganti grounding atau evaluasi taste.

## Definisi operasional target “minimal 1:1”

Pisahkan dua track. **Reconstruction** menguji kesetiaan pada referensi yang sama (geometri, font, wrap, warna, aset, screenshot dan export). **Original design** menguji kualitas relatif melalui blind review; kesamaan piksel tidak relevan untuk desain orisinal.

Gunakan delapan brief: dashboard, editorial landing, mobile onboarding, commerce, settings, tabel padat, rekonstruksi referensi, dan refinement layar existing. Tiga run per brief per produk: Better Design/Wonder/Pen menghasilkan 72 output utama. Figma dan FigCraft boleh memakai subset sebagai kontrol tambahan; jangan mencampurnya dalam klaim parity utama.

Bekukan prompt, referensi, aset, font, viewport, batas waktu dan jumlah refinement. Catat versi aplikasi, model/provider/effort bila bisa dipilih; jika tidak bisa disamakan, laporkan sebagai keterbatasan. Simpan first pass dan final output serta logs/revision.

Rubrik usulan 100 poin: hierarchy 20, typography 20, spacing/alignment 20, warna 10, relevansi konten 10, aset 10, konsistensi sistem 10. Minimal tiga reviewer menilai output anonim; laporkan win/tie/loss terhadap Wonder dan Pen **masing-masing**, rentang skor dan disagreement. Usulan gate awal: nol cacat kritis, median total Better Design tidak di bawah tiap pembanding, dan tidak ada kategori brief yang gagal konsisten. Ini kriteria penerimaan usulan, bukan hasil pengukuran; 24 pasangan per kompetitor masih pilot, bukan bukti statistik universal.

## Verifikasi yang dilakukan

- Probe `parseClasses` langsung: directional padding/radius kehilangan makna tanpa warning; directional gaps dan responsive class diabaikan.
- `node --test tests/agent-runtime.cjs tests/figma-import.cjs`: 13 kasus, 12 lulus, satu real-Claude smoke dilewati, nol gagal.
- Tidak menjalankan generasi kompetitif berbayar, tidak mengukur taste manusia, tidak mengklaim pixel parity. Tidak mengubah kode produksi atau perubahan lokal yang sedang berjalan.

Lampiran: [audit pipeline](2026-10-29-pipeline-evidence.md), [riset sumber resmi](2026-10-29-external-research.md), dan laporan pembanding lokal bila tersedia di direktori ini.
