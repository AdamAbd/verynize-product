<!-- get_design_guidelines {"style": "flat-design"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Flat Design

Confident reduction: no shadows, bevels, realistic gradients or textures, so hierarchy comes entirely from size, color and type. Digital-native but print-inspired, every section a flat graphic poster with bold color blocks, crisp edges and a strict grid.

**Palette.** Vibrant and confident rather than pastel.

- Ground `#FFFFFF`; muted blocks and inputs `#F3F4F6`; borders `#E5E7EB`, rarely used.
- Text `#111827`.
- Blue is the action color: `#3B82F6` for accents, `#2563EB` for blue text and for fills that carry white text; emerald `#10B981` supports; amber `#F59E0B` for highlights and badges.
- Sections alternate white, muted `#F3F4F6`, solid accent (`bg-[var(--blue-deep)]` with white text, `bg-[var(--emerald)]` and `bg-[var(--amber)]` with `text-[var(--text)]`) and dark gray, with hard edges between them. Color defines grouping instead of lines or shadows.
- Tokens the examples bind: `--amber` #F59E0B, `--blue-deep` #2563EB, `--blue-wash` #EFF6FF, `--emerald` #10B981, `--muted` #F3F4F6, `--text` #111827, `--white` #FFFFFF.

**Type.** `Outfit` throughout: headings 700–800 `tracking-tight`, body 400, labels and buttons 500–600 with uppercase `tracking-wider` labels.

**Shape and depth.** `rounded-md` or `rounded-lg` everywhere, pills only for tags. Edges are background color (`border-0`); inputs and outline buttons use thick solid borders (`border-2`, `border-4`). `shadow-none` on every element and no blur; a gradient appears only as a faint background decoration such as `from-[var(--muted)] to-transparent`.

**Components.**

- Buttons `h-14 rounded-md px-8 font-semibold`: primary `bg-[var(--blue-deep)] text-[var(--white)]`, secondary `bg-[var(--muted)] text-[var(--text)]`, outline `border-4 border-[var(--blue-deep)] text-[var(--blue-deep)]`.
- Color-block cards: `rounded-lg bg-[var(--blue-wash)] p-6` (or white on a gray section), no border or shadow, with the icon in a `h-14 w-14 rounded-full bg-[var(--white)] text-[var(--blue-deep)]` circle.
- Inputs `h-14 rounded-md bg-[var(--muted)] px-4`, borderless.
- Feather icons at `h-6 w-6`, 2–2.5px stroke, in the section's accent.

**Signature moves.**

- Large low-opacity geometric shapes behind sections: `absolute -right-20 -top-20 h-80 w-80 rounded-full bg-[var(--white)]/5` and a rotated square, in a `relative overflow-hidden` section.
- Full-section color blocks: blue hero, emerald benefits, amber CTA, dark gray how-it-works and footer.
- Stat numbers each in a different accent; the popular pricing tier starts larger.
- Sections separate by color or space; the FAQ is the one place with `border-2` between items.

**Layout.** `max-w-7xl` on a 12-column grid, spacing in multiples of 4 at medium density, sections `py-16`–`py-24`.
