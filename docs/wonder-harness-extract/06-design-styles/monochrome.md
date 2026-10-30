<!-- get_design_guidelines {"style": "monochrome"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Minimalist Monochrome

Reduction to essence: black, white and typography, in the manner of fashion editorials, architectural monographs and museum catalogues (Chanel, Celine, Bottega Veneta). Austere, authoritative and timeless; editorial luxury, not tech minimalism with the color removed.

**Palette.** Absolute: black is the accent, and no other color appears, not even a tasteful navy.

- Ground `#FFFFFF`; quiet panels `#F5F5F5`; inverted sections and emphasis cards `#000000` with white text.
- Text `#000000`; secondary text `#525252`; hairline dividers `#E5E5E5`.
- No gradients and no shadows: depth comes from black-white inversion, border weight, scale and space.
- Tokens the examples bind: `--ink` #000000, `--paper` #FFFFFF.

**Type.** Serif identity. Headlines `Playfair Display` (with its italics) at `tracking-tight`–`tracking-tighter`, `leading-none`; body `Source Serif 4` at `text-lg leading-relaxed`; dates and metadata `JetBrains Mono` uppercase `tracking-widest`. Hero `text-7xl`–`text-8xl`, with at least one word at `text-8xl`–`text-9xl` used as a graphic; page titles `text-5xl`, sections `text-4xl`.

**Shape.** Square corners on everything. Border weights carry structure: 1px `#E5E5E5` hairlines, 1px black standard, 2px emphasis, 4px or 8px black rules between every major section, thin vertical rules between columns. Rules between grid cells come from gap-px on a container filled with the rule color, each cell keeping its own background.

**Components.**

- Buttons rectangular, `px-8 py-4 uppercase tracking-widest font-medium text-sm`: primary `bg-[var(--ink)] text-[var(--paper)]`, often with a `→`; secondary `border-2 border-[var(--ink)]`; ghost as a text link.
- Cards `bg-[var(--paper)] border border-[var(--ink)] p-6`–`p-8`, inverted `bg-[var(--ink)] text-[var(--paper)] p-8` for emphasis, or borderless with rules between.
- Inputs underlined `border-b-2 border-[var(--ink)]`, italic placeholder in `#525252`.
- Testimonials as pull quotes: a large italic serif line (`text-3xl italic`) with an oversized `text-8xl` opening quotation mark.
- A boxed drop cap opens long-form sections: `float-left mr-3 h-16 w-16 border border-[var(--ink)]` holding a `text-5xl` Playfair letter.
- Thin outline icons in black, alone or in black-stroked circles.

**Signature moves.**

- The hero rule: a thick horizontal rule punctuated by a small bordered square.
- An inverted stats section, black with a faint texture of white vertical 1px lines every 4px at 3%.
- Very faint layered textures keep the page from going flat: horizontal paper lines at 1.5%, a 40px editorial grid, noise at 2%. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A line grid is a repeating pattern behind the content whose tile is <gap>px square with lines along its top and left edges at the style's weight (1px unless it says otherwise). Parallel lines keep only the top edge, and stripes widen that one line to a band. A diagonal hatch, stripe or crosshatch rotates the tile with patternTransform="rotate(45)". A noise overlay is one pointer-events-none absolute inset-0 layer over the whole artboard holding an SVG feTurbulence filter (type="fractalNoise", base frequency about 0.8, 4 octaves); the style sets its opacity and any blend mode.
- The highlighted pricing tier extends taller than its neighbors.

**Layout.** `max-w-6xl px-8`, sections `py-32`, a 12-column grid with strong alignment.
