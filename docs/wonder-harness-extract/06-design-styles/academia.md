<!-- get_design_guidelines {"style": "academia"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Academia / Classical

A physical university library rendered on screen: aged parchment, dark mahogany, polished brass and crimson leather, set in traditional book typography with measured ornament. Scholarly, warm, dignified; a whole environment, not a dark theme with serifs.

**Palette.** Warm browns and creams only, no pure black or white and no cool tones.

- Ground `#1C1714` mahogany; cards and panels `#251E19` aged oak layered on it; muted fills `#3D332B`.
- Text `#E8DFD4` parchment; secondary text `#9C8B7A`; borders `#4A3F35`.
- Brass `#C9A962` is the interactive language: every button, link and icon. Brass gradient `bg-[linear-gradient(180deg,var(--brass-light)_0%,var(--brass)_50%,var(--brass-dark)_100%)]`, text on brass `#1C1714`.
- Crimson `#8B2635` is a rare second accent for wax seals and special emphasis.
- Tokens the examples bind: `--border` #4A3F35, `--brass` #C9A962, `--brass-dark` #B8953F, `--brass-light` #D4B872, `--card` #251E19, `--card-shadow` rgba(0,0,0,0.3), `--engrave-highlight` rgba(255,255,255,0.1), `--engrave-shadow` rgba(0,0,0,0.4).

**Type.** All serif. Headings `Cormorant Garamond` 400–500; body `Crimson Pro` 400, emphasis in italic rather than bold; labels and overlines `Cinzel` 500–600 uppercase at `tracking-[0.2em]`–`tracking-[0.3em]`. Display `text-5xl`–`text-7xl leading-[1.1]`, body `text-base`–`text-lg leading-relaxed`. Opening paragraphs start with a brass Cinzel drop cap: `float-left mr-4 font-['Cinzel'] text-7xl leading-[0.8] text-[var(--brass)]`. Buttons and special headings carry an engraved shadow `[text-shadow:1px_1px_1px_var(--engrave-shadow),-1px_-1px_1px_var(--engrave-highlight)]`.

**Shape and depth.** `rounded` (4px) on buttons, cards and inputs; `rounded-full` for icon wells and badges. Cards `bg-[var(--card)] border border-[var(--border)] rounded p-8`–`p-12` with `shadow-[0_8px_24px_var(--card-shadow)]`. Primary buttons use the brass gradient, Cinzel uppercase `text-xs tracking-[0.15em]` and an engraved inset shadow; secondary buttons are `border-2 border-[var(--brass)] text-[var(--brass)]` on transparent. Inputs `bg-[var(--card)] border border-[var(--border)] h-12 rounded` with an italic placeholder.

**Signature moves.**

- Featured images are arch-topped (`rounded-t-full`) and sepia-toned (`sepia-[0.6]`).
- Brass corner brackets frame the hero (40px) and cards (24px): `absolute -top-px -left-px w-10 h-10 border-t-2 border-l-2 border-[var(--brass)]` plus the mirrored bottom-right pair.
- Ornate dividers fade transparent → wood → brass and back, with a centered glyph (✶ ❧ ✤ ❦) on the ground color.
- Major sections are numbered as volumes ("Volume I", "Volume II"); lists use Roman numerals in brass Cinzel.
- Crimson wax-seal badges (radial gradient, inset shadow, star) mark featured items.
- A paper-grain overlay at `opacity-[0.03]` and a soft vignette sit over the page. A noise overlay is one pointer-events-none absolute inset-0 layer over the whole artboard holding an SVG feTurbulence filter (type="fractalNoise", base frequency about 0.8, 4 octaves); the style sets its opacity and any blend mode.
- Thin, elegant stroke icons in brass: book, scroll, quill, star, quotation marks.

**Layout.** Sections `py-24`–`py-32`, containers `max-w-6xl`, hero split 60/40 or 7/5, timelines alternate left and right. Ornament stays measured: one flourish per container reads scholarly, several read gaudy.
