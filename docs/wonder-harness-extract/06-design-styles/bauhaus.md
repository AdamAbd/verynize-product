<!-- get_design_guidelines {"style": "bauhaus"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Bauhaus

A 1920s Bauhaus poster as an interface: every element composed from circles, squares and triangles, thick deliberate borders, pure primaries on stark black and white. Constructivist, asymmetric, architectural; form follows function.

**Palette.** Solid fills only, no gradients.

- Ground `#F0F0F0`; cards and outline-button fills `#FFFFFF`; muted `#E0E0E0`.
- Text and every border `#121212`.
- Primaries: red `#D02020`, blue `#1040C0`, yellow `#F0C020`; `#FFF9C4` for light answer panels.
- Color blocking: a whole section takes one primary as its background (hero panel blue, stats yellow, benefits red, final CTA yellow, footer black). This is the most identifying move.
- Tokens the examples bind: `--ink` #121212, `--white` #FFFFFF.

**Type.** `Outfit` at 400/500/700/900. Display `text-8xl font-black uppercase tracking-tighter leading-[0.9]`; subheads `text-4xl font-bold uppercase`; body `text-lg font-medium leading-relaxed`; labels `font-bold uppercase tracking-widest`.

**Shape and depth.** Radius is binary: `rounded-none` or `rounded-full`. Borders `border-2` on elements, `border-4` on cards and major divisions, `border-b-4` under every section and the nav, always `border-[var(--ink)]`. A hard shadow is an unblurred offset down and right, shadow-[<n>px_<n>px_0px_0px_<color>], 4px on small elements and 8px on cards; every element casts it the same way. In ink: `shadow-[4px_4px_0px_0px_var(--ink)]` and `shadow-[8px_8px_0px_0px_var(--ink)]`.

**Components.** Buttons `rounded-none uppercase font-bold tracking-wider border-2 border-[var(--ink)] shadow-[4px_4px_0px_0px_var(--ink)]` in red, blue, yellow (black text) or white; a pill (`rounded-full`) variant is allowed. Cards `relative border-4 border-[var(--ink)] bg-[var(--white)] p-6 shadow-[8px_8px_0px_0px_var(--ink)]` with a tiny corner shape (`absolute right-2 top-2 h-2 w-2`) cycling circle, square and triangle (`[clip-path:polygon(50%_0%,0%_100%,100%_100%)]`) through the three primaries. Inputs `h-12 border-2 border-[var(--ink)] bg-[var(--white)] rounded-none font-medium`. Accordions open into a red header with a `border-t-4` yellow-highlight answer panel. Icons are Feather outlines (`react-icons/fi`) in bordered square wells or yellow circles.

**Signature moves.**

- A geometric logo of circle, square and triangle in the three primaries.
- Abstract compositions of overlapping shapes, for example a red circle, a 45°-rotated blue square and a yellow square layered in a `relative h-64 w-64` box.
- Every third shape in a repeating pattern rotated 45°; step numbers in rotated squares with upright content.
- Images alternate `rounded-full` and `rounded-none` and stay `grayscale`.
- Large ambient shapes at 10–20% opacity behind sections, and on colored blocks a white dot grid of 2px-radius dots every 20px. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A dot grid is a repeating pattern behind the content whose tile is <gap>px square around one circle of radius <dot>px.

**Layout.** `max-w-7xl` poster breadth, sections `py-24 px-8`, spacing on a 4/8/12/16/24px scale. Stats in a 4-column grid with 4px ink rules (`gap-1`), pricing with the center tier raised. Rules between grid cells come from gap-px on a container filled with the rule color, each cell keeping its own background. Balance is asymmetric: geometric elements overlap and break the grid on purpose.
