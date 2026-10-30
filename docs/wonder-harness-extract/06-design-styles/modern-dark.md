<!-- get_design_guidelines {"style": "modern-dark"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Modern Dark

Premium developer tools (Linear, Vercel, Raycast): obsessively crafted, nearly monochrome, every surface in three-dimensional space under soft ambient light, with one saturated indigo accent. Cinematic meets technical minimalism; sophisticated, never cold.

**Palette.**

- Grounds `#050506` page, `#020203` footer and deepest layers, `#0a0a0c` raised surfaces and mock interfaces; glass surface `rgba(255,255,255,0.05)`.
- Text `#EDEDEF`; body and metadata `#8A8F98`.
- Borders white at 6% (`border-[var(--white)]/[0.06]`), 10% emphasized, indigo at 30% for accent edges.
- Indigo `#5E6AD2` (`#6872D9` active) for actions, links and glows; most of the interface stays monochrome.
- Tokens the examples bind: `--deepest` #020203, `--edge` rgba(255,255,255,0.06), `--edge-strong` rgba(255,255,255,0.1), `--ground` #050506, `--ground-lift` #0A0A0F, `--indigo` #5E6AD2, `--indigo-edge` rgba(94,106,210,0.3), `--indigo-glow` rgba(94,106,210,0.1), `--indigo-ring` rgba(94,106,210,0.5), `--input` #0F0F12, `--inset-highlight` rgba(255,255,255,0.2), `--raised` #0A0A0C, `--shadow` rgba(0,0,0,0.4), `--shadow-ambient` rgba(0,0,0,0.2), `--shadow-strong` rgba(0,0,0,0.5), `--text` #EDEDEF, `--text-muted` #8A8F98, `--white` #FFFFFF.

**Type.** `Inter` or `Geist Sans`, semibold headings: display `text-7xl`–`text-8xl tracking-[-0.03em]`, H1 `text-5xl`–`text-6xl tracking-tight`; body `text-sm`–`text-base leading-relaxed`; labels `text-xs` mono `tracking-widest`. Headlines fade vertically: `bg-gradient-to-b from-[var(--white)] via-[var(--white)]/95 to-[var(--white)]/70 bg-clip-text text-transparent`; key phrases in an indigo gradient. Gradient text is bg-gradient-to-r from-<a> to-<b> bg-clip-text text-transparent on display-size words only (text-5xl and up), most often the headline's last word or two.

**Shape and depth.** Cards `rounded-2xl border border-[var(--white)]/[0.06]`; buttons `rounded-lg` with an inset highlight instead of a border; inputs `rounded-lg border border-[var(--white)]/10`; icon wells `rounded-xl`; badges `rounded-full border` in indigo at 30%. Every elevated surface stacks three or four shadow layers:

- card `shadow-[0_0_0_1px_var(--edge),0_2px_20px_var(--shadow),0_0_40px_var(--shadow-ambient)]`;
- emphasized `shadow-[0_0_0_1px_var(--edge-strong),0_8px_40px_var(--shadow-strong),0_0_80px_var(--indigo-glow)]`;
- accent button `shadow-[0_0_0_1px_var(--indigo-ring),0_4px_12px_var(--indigo-edge),inset_0_1px_0_0_var(--inset-highlight)]`.

A gradient border: a `p-px rounded-2xl bg-gradient-to-b from-[var(--indigo-edge)] to-transparent` wrapper around a `bg-[var(--raised)] rounded-2xl p-6` interior.

**Components.** Primary button `bg-[var(--indigo)] text-[var(--white)]` with the accent shadow; secondary `bg-[var(--white)]/[0.05] text-[var(--text)]` with an inset border; ghost `text-[var(--text-muted)]`. Cards `bg-gradient-to-b from-[var(--white)]/[0.08] to-[var(--white)]/[0.02] border border-[var(--white)]/[0.06] rounded-2xl p-6`–`p-8` with a 1px glow along the top edge. Inputs `bg-[var(--input)] border border-[var(--white)]/10 rounded-lg`.

**Signature moves.**

- A layered background: a radial base `bg-[radial-gradient(ellipse_at_top,var(--ground-lift)_0%,var(--ground)_50%,var(--deepest)_100%)]`, noise at about 1.5%, large blurred light pools (indigo at 25% top-center, about 900×1400px; purple at 15% left; blue at 12% right) and a 64px grid at 2%. A noise overlay is one pointer-events-none absolute inset-0 layer over the whole artboard holding an SVG feTurbulence filter (type="fractalNoise", base frequency about 0.8, 4 octaves); the style sets its opacity and any blend mode. Ambient orbs are large rounded-full circles of an accent color, 400 to 900px, blurred with blur-3xl to blur-[150px] and placed off the corners in one absolute inset-0 layer behind the content; the style sets their colors, count and opacity. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A line grid is a repeating pattern behind the content whose tile is <gap>px square with lines along its top and left edges at the style's weight (1px unless it says otherwise). Parallel lines keep only the top edge, and stripes widen that one line to a band. A diagonal hatch, stripe or crosshatch rotates the tile with patternTransform="rotate(45)".
- Soft 300px indigo glows at about 15% behind featured surfaces. Glow depth replaces drop shadows with zero-offset colored shadows, shadow-[0_0_<blur>px_<color>], stacked from a tight bright layer to a wide faint one; text glows use drop-shadow-[0_0_<blur>px_<color>].
- Bento grids: a six-column grid of explicit `col-span-2`, `3` and `4` and `row-span-2` items that tile completely, with one hero card 4×2, so there are as many cells as items and no empty cell.

**Layout.** Sections `py-24`–`py-32`, separated by `border-t border-[var(--white)]/[0.06]` or a `from-transparent via-[var(--white)]/10 to-transparent` line; occasional overlap through negative margins.
