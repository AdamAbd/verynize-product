<!-- get_design_guidelines {"style": "professional"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Serif

Typographic elegance through classical restraint, like a literary magazine or a premium architecture journal. The serif is the soul of the style; pages breathe and nothing shouts, because everything is placed with intention. Editorial, warm, refined.

**Palette.** One warm accent.

- Ground `#FAFAF8` ivory; cards `#FFFFFF` lifting off it; secondary surfaces `#F5F3F0`.
- Text `#1A1A1A`; secondary text `#6B6B6B`; rules and borders `#E8E4DF`, emphasized `#D4C9B8`.
- Burnished gold `#8B6508` for links, labels and key elements, `#D4A84B` for secondary emphasis.
- Tokens the examples bind: `--card` #FFFFFF, `--card-shadow` rgba(26,26,26,0.04), `--featured-shadow` rgba(26,26,26,0.06), `--gold` #8B6508, `--gold-shadow` rgba(184,134,11,0.2), `--rule` #E8E4DF, `--text` #1A1A1A, `--text-muted` #6B6B6B.

**Type.**

- Headlines `Playfair Display` at normal weight, `tracking-tight`: hero `text-7xl`, sections `text-4xl`, card titles `text-xl` semibold.
- Body `Source Sans 3` `text-base`–`text-lg leading-[1.75] tracking-[0.01em]`; navigation `text-sm` medium at `tracking-[0.05em]`.
- Section labels `IBM Plex Mono text-xs font-medium uppercase tracking-[0.15em] text-[var(--gold)]`, used for labels and metadata only.
- Stats and prices as large Playfair numerals (`text-5xl` and up).

**Shape and depth.** `rounded-md`–`rounded-lg` with 1px warm borders. Shadows are refinement, not depth: `shadow-[0_1px_2px_var(--card-shadow)]` on cards, `shadow-[0_4px_12px_var(--featured-shadow)]` featured, gold-tinted `shadow-[0_4px_12px_var(--gold-shadow)]` on the primary button. A faint paper noise covers the page, and one large gold glow at 2% sits behind the hero. A noise overlay is one pointer-events-none absolute inset-0 layer over the whole artboard holding an SVG feTurbulence filter (type="fractalNoise", base frequency about 0.8, 4 octaves); the style sets its opacity and any blend mode. Ambient orbs are large rounded-full circles of an accent color, 400 to 900px, blurred with blur-3xl to blur-[150px] and placed off the corners in one absolute inset-0 layer behind the content; the style sets their colors, count and opacity.

**Components.**

- Buttons `min-h-[44px] rounded-md px-6 py-3 text-sm font-medium tracking-[0.02em]`: primary `bg-[var(--gold)] text-[var(--card)]`; secondary `border border-[var(--text)]`; ghost `text-[var(--text-muted)]`.
- Cards `rounded-lg border border-[var(--rule)] bg-[var(--card)] p-8`; featured cards add `border-t-2 border-t-[var(--gold)]` and a gold mono badge on a 6% gold tint.
- Inputs `h-12 rounded-md border border-[var(--rule)] bg-transparent px-4`.
- Testimonials in italic Playfair (`text-xl`) beside a gold `text-6xl` opening quotation mark.

**Signature moves.**

- The rule-line system: thin `h-px bg-[var(--rule)]` rules between sections, and section labels wrapped by rules (`flex items-center gap-4`, a `flex-1` rule, the mono label, another rule).
- Asymmetric benefits columns `grid-cols-[1.3fr_0.7fr]`.

**Layout.** Narrow `max-w-5xl`, sections `py-32`–`py-44`, cards `p-8`–`p-10`, gaps `gap-8`–`gap-12`. The hero is centered, narrow and stacked; features sit in three columns.
