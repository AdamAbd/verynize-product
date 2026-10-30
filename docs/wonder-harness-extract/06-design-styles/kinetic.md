<!-- get_design_guidelines {"style": "kinetic"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Kinetic Typography

Typography is the entire structure: text becomes image and the headline is the hero. Festival posters and underground zines brought to the web, high-energy and brutally flat, with headlines ten times the body size instead of two.

**Palette.** Contrast extremes, one accent, solid fills only.

- Ground `#09090B`; secondary surfaces and background numerals `#27272A`.
- Text `#FAFAFA`; body and secondary text `#A1A1AA`; every structural line `#3F3F46`.
- Acid yellow `#DFE104` with black text, used boldly but rarely: hero highlights, marquee bands, selection, full-section flips.
- Tokens the examples bind: `--acid` #DFE104, `--ground` #09090B, `--line` #3F3F46, `--on-acid` #000000, `--text` #FAFAFA.

**Type.** `Space Grotesk` (or `Inter`). Display, buttons and labels uppercase at `tracking-tighter` with `leading-[0.8]` or `leading-none`; body in normal case at `tracking-tight`. Weights 700 headings and buttons, 500 body.

- Hero `text-[clamp(3rem,12vw,14rem)]`; sections `text-8xl`; card titles `text-3xl` and up.
- Body `text-lg`–`text-2xl`, left-aligned; small labels `tracking-widest`.
- Decorative numerals `text-[6rem]`–`text-[12rem]` in `#27272A`, read as shapes rather than text.

**Shape and depth.** Square corners (`rounded-sm` at most on tiny elements), solid `border-2 border-[var(--line)]` for structure and `border` for dividers, `border-l-4` on quotes, `border-b-2` under inputs. Completely flat: depth comes from layered numerals, color flips and cards that overlap as they stick on scroll. A noise layer at `opacity-[0.03]` with `mix-blend-overlay`. A noise overlay is one pointer-events-none absolute inset-0 layer over the whole artboard holding an SVG feTurbulence filter (type="fractalNoise", base frequency about 0.8, 4 octaves); the style sets its opacity and any blend mode. Text over images occasionally takes `mix-blend-difference`.

**Components.**

- Buttons `uppercase tracking-tighter font-bold rounded-none`, large: `h-14 px-8` (`h-20 px-12` large). Primary `bg-[var(--acid)] text-[var(--on-acid)]`; outline `border-2 border-[var(--line)] text-[var(--text)]`.
- Cards `border-2 border-[var(--line)] bg-[var(--ground)] p-8`–`p-12`, title `text-3xl`, numerals behind; stacked cards use `sticky top-24`. Hairline grids are ruled in `var(--line)`. Rules between grid cells come from gap-px on a container filled with the rule color, each cell keeping its own background.
- Inputs are oversized: `h-24 border-b-2 border-[var(--line)] bg-transparent text-4xl font-bold uppercase tracking-tighter px-0`, placeholder in `#8A8A93`.

**Signature moves.**

- At least one viewport-width headline using the clamp size.
- At least two full-bleed marquee bands (fast stats, slower testimonials) with hard edges.
- Sections that flip hard between `bg-[var(--ground)]` and `bg-[var(--acid)]`, text inverted.

**Layout.** Push to the edges: hero `max-w-[90vw]`–`max-w-[95vw]`, body `max-w-5xl`–`max-w-6xl`. Sections `py-32`, subsections `py-20`. Three-column steps and pricing, four-column footer; elements extend past containers and columns are uneven for drama. Section breaks are full-width borders or color flips.
