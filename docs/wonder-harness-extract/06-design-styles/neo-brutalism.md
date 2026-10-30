<!-- get_design_guidelines {"style": "neo-brutalism"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Neo-Brutalism

A punk rebellion against polished SaaS: raw structure with Pop Art saturation, early-internet sticker culture and zine spirit. The screen is a collage board of stickers, cutouts and printed cards, rotated and overlapping with hard ink shadows. Loud, playful, anti-corporate, ugly-cool. More borders, shadows, uppercase and texture than the defaults.

**Palette.**

- Ground and card interiors `#FFFDF5` cream newsprint; white `#FFFFFF`.
- Every text, border and shadow pure black `#000000`; no grays.
- Hot red `#FF6B6B` for primary buttons and key badges; yellow `#FFD93D` for secondary buttons, badges and alternate sections; violet `#C4B5FD` for soft backgrounds and card headers.
- Sections block in cream, yellow, violet and black.
- Tokens the examples bind: `--cream` #FFFDF5, `--ink` #000000, `--white` #FFFFFF.

**Type.** `Space Grotesk`, heavy only: headings 900, body 700. Display `text-8xl`–`text-9xl` uppercase `tracking-tighter leading-[0.85]`; H2 `text-6xl`–`text-8xl`; body `text-lg`–`text-xl`; labels `tracking-[0.2em]`. Huge hollow display words: the word in the ground color outlined by four hard black text shadows, `text-[var(--cream)] text-shadow-[-2px_-2px_0_var(--ink),2px_-2px_0_var(--ink),-2px_2px_0_var(--ink),2px_2px_0_var(--ink)]`, often layered over a solid copy. Text on color gets a hard 4–6px black text shadow.

**Shape and depth.** Square corners, with `rounded-full` only for pill badges, round stickers and decorative shapes. Every element has a solid black border: `border-2` for separators and ghost buttons, `border-4` by default, `border-8` for hero elements and major dividers. A hard shadow is an unblurred offset down and right, shadow-[<n>px_<n>px_0px_0px_<color>], 4px on small elements and 8px on cards; every element casts it the same way. Here they run from `shadow-[4px_4px_0px_0px_var(--ink)]` up to `shadow-[12px_12px_0px_0px_var(--ink)]`, or `shadow-[20px_20px_0px_0px_var(--white)]` on black. No blur and no smooth gradients anywhere.

**Components.**

- Buttons `h-12`–`h-14 font-bold text-sm uppercase tracking-wide border-4 border-[var(--ink)] shadow-[4px_4px_0px_0px_var(--ink)]` in red (primary), yellow (secondary) or white (outline); a pressed button moves onto its shadow like a physical switch.
- Cards `bg-[var(--white)] border-4 border-[var(--ink)] shadow-[8px_8px_0px_0px_var(--ink)]` with a colored header over a `border-b-4 border-[var(--ink)]` rule.
- Inputs `border-4 border-[var(--ink)] bg-[var(--white)] h-14`–`h-20 font-bold text-lg`.
- Badges: colored pills or squares, `font-black text-sm uppercase tracking-widest`, placed over corners (`absolute -right-6 -top-6 rotate-3`) with a small hard shadow.
- Thick-stroke icons (`stroke-[3px]`) at `h-8 w-8` in bordered color boxes.

**Signature moves.**

- Sticker rotations (`-rotate-2`, `rotate-1`, `rotate-3`) on headlines, cards, badges and CTAs.
- Backgrounds always textured: an ink halftone of 1.5px-radius dots every 20px, or a 40px graph-paper grid at 10% black. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A dot grid is a repeating pattern behind the content whose tile is <gap>px square around one circle of radius <dot>px. A line grid is a repeating pattern behind the content whose tile is <gap>px square with lines along its top and left edges at the style's weight (1px unless it says otherwise). Parallel lines keep only the top edge, and stripes widen that one line to a band. A diagonal hatch, stripe or crosshatch rotates the tile with patternTransform="rotate(45)".
- Stars, arrows and simple geometric floaters; giant background text at `opacity-10`; busy zones of stacked shapes and large numbers.

**Layout.** `max-w-6xl`–`max-w-7xl`, sections `py-16`–`py-32`, gaps `gap-8`–`gap-12`; 60/40 splits, offset columns and staggered grids; space is filled with texture and decoration rather than left empty.
