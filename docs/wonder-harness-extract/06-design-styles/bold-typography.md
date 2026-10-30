<!-- get_design_guidelines {"style": "bold-typography"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Bold Typography

Poster design translated to the web: type is the whole visual language. Color creates contrast, space sets off letterforms, and extreme scale carries the eye from headline to action. Confident and editorial, like a gallery exhibition or a magazine spread.

**Palette.** One accent, used sparingly.

- Ground `#0A0A0A` warm near-black; surfaces and inputs `#1A1A1A`.
- Text `#FAFAFA`; secondary text `#A3A3A3`; hairlines `#262626`, emphasized borders `#404040`.
- Accent `#FF3D00` vermillion for headlines, key actions and underlines.
- Tokens the examples bind: `--accent` #FF3D00, `--hairline` #262626, `--surface` #1A1A1A, `--text` #FAFAFA, `--text-muted` #A3A3A3.

**Type.**

- Headlines `Inter Tight` at `-0.06em` to `-0.04em`; `Playfair Display` only for pull quotes and testimonials; `JetBrains Mono` for labels, stats and technical details.
- Scale contrast of 6:1 or more between H1 and body. Hero `text-8xl` (128px), H1 `text-7xl` (96px), H2 `text-4xl`, H3 `text-3xl`, body `text-base`, captions `text-xs`.
- Line height 1.0 for single-line headlines, 1.1 multi-line, 1.6 body. Uppercase labels at `0.1em`–`0.2em`. Weights 400 and up.
- Headlines span the full width; display text fills the viewport (`text-7xl`–`text-9xl`).

**Shape and depth.** Square corners everywhere. No box shadows or text shadows: depth comes from layered type, 2–3px vermillion underlines and bars, and full-width hairline rules (`border-t border-[var(--hairline)]`) as the main section separator. A grain at `opacity-[0.015]` covers the page. A noise overlay is one pointer-events-none absolute inset-0 layer over the whole artboard holding an SVG feTurbulence filter (type="fractalNoise", base frequency about 0.8, 4 octaves); the style sets its opacity and any blend mode.

**Components.**

- Primary action is text with an underline: `text-[var(--accent)] uppercase tracking-wider` over an absolute `h-0.5 w-full bg-[var(--accent)]`.
- Secondary: `border border-[var(--text)] bg-transparent px-6 py-3 uppercase tracking-wider`; ghost: `text-[var(--text-muted)]` with a `h-px bg-current` underline.
- Cards are rare: `border border-[var(--hairline)] bg-transparent p-8`, featured `border-2 border-[var(--accent)]` with a vermillion tag.
- Inputs `h-14 bg-[var(--surface)] border border-[var(--hairline)] px-4`.
- Outline icons only, `h-5 w-5`, used sparingly; text labels are preferred.

**Signature moves.**

- Oversized background numerals (`text-9xl font-black text-[var(--hairline)] opacity-50`) layered behind content with a short vermillion bar.
- Asymmetric 12-column splits, 7/5 or 8/4.
- An inline headline image: a contextual photo set as a word inside a display headline, a type-height span with intrinsic width and `object-cover`, square-cornered, in a `flex items-baseline` row between text runs, never overlapping the glyphs. Display and hero headlines only.

**Layout.** Container `max-w-5xl px-16`; sections `py-20`, `py-28`, hero and CTA `py-40`.
