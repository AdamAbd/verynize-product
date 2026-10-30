<!-- get_design_guidelines {"style": "swiss-minimalist"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Swiss International Style

The International Typographic Style of 1950s Switzerland: objective communication, mathematical precision and logical structure. The design recedes so content speaks; the grid is law and made visible; type is the interface; negative space is structural. Intellectual and architectural, like a transit map. Flat yet rich: depth comes from pattern, never shadow.

**Palette.** Four colors, no gradients.

- Ground `#FFFFFF`; rhythm sections `#F2F2F2`.
- Text and every border `#000000`.
- Swiss red `#CC2900` is the only signal color: primary calls to action, section-number prefixes and critical emphasis, never decorative fill.
- Tokens the examples bind: `--black` #000000, `--gray` #F2F2F2, `--red-ring` rgba(255,48,0,0.1), `--white` #FFFFFF.

**Type.** `Inter` as the neutral grotesque. Headings 900 or 700, uppercase, `tracking-tighter`, at extreme scale (`text-7xl`–`text-9xl`, words as images); labels uppercase `tracking-widest`; body 400–500. Text is flush-left, ragged-right.

**Shape.** Rectangles only. Thick visible borders (`border-2`, `border-4`) draw the grid; horizontal and vertical lines divide sections. The only shadow is a ring for compositional circles: `shadow-[0_0_0_8px_var(--red-ring)]`.

**Textures.** On gray and occasionally white surfaces (never on black or red), at very low opacity:

- a 24px grid of 1px black lines at 3%;
- a dot matrix of 1px-radius black dots every 16px at 4%;
- diagonal 1px black lines every 10px at 2%;
- noise at `opacity-[0.015]`.

A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A line grid is a repeating pattern behind the content whose tile is <gap>px square with lines along its top and left edges at the style's weight (1px unless it says otherwise). Parallel lines keep only the top edge, and stripes widen that one line to a band. A diagonal hatch, stripe or crosshatch rotates the tile with patternTransform="rotate(45)". A dot grid is a repeating pattern behind the content whose tile is <gap>px square around one circle of radius <dot>px. A noise overlay is one pointer-events-none absolute inset-0 layer over the whole artboard holding an SVG feTurbulence filter (type="fractalNoise", base frequency about 0.8, 4 octaves); the style sets its opacity and any blend mode.

**Components.** Buttons rectangular, bold, uppercase `tracking-wide`: primary `bg-[var(--black)] text-[var(--white)]`, secondary `bg-[var(--white)] text-[var(--black)] border-2 border-[var(--black)]`. Cards and containers `border-2 border-[var(--black)] bg-[var(--white)]` or `bg-[var(--gray)]` with uniform `p-8` or `p-12`. Inputs underlined (`border-b-2 border-[var(--black)]`) or a thick-bordered box. Icons as functional symbols, stroke matched to the type weight, often in `border-2 border-[var(--black)]` squares or circles.

**Signature moves.**

- Section labels in uppercase with wide tracking; when sections form a real sequence they carry a red number prefix ("01. System", "02. Method").
- Abstract Bauhaus-like hero compositions of overlapping circles, rectangles and lines; a 2×2 grid of geometric tiles, each with a different texture.

**Layout.** Asymmetric column ratios 8:4, 7:5 and 5:7, for example a large photo on the left balanced by space and small text on the right. Dense information clusters (tables) beside spacious narrative sections with `p-12`–`p-24`. The uniform grid spine is part of the style.
