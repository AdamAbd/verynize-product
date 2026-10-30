<!-- get_design_guidelines {"style": "newsprint"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Newsprint

"All the news that's fit to print": the golden age of print journalism made digital. Massive serif headlines, visible grid lines, dense information and sharp geometry, like a publication of record. Authoritative, intellectual, urgent.

**Palette.** Light only, 99% ink and paper.

- Paper `#F9F9F7`; quiet backgrounds `#F5F5F5`; secondary rules and fills `#E5E5E0`.
- Ink `#111111` for text and every structural border; captions `#666666`; secondary headings `#404040`.
- Editorial red `#CC0000` for breaking-news badges, link underlines and calls to action only, and only on light grounds.
- At least one major section inverted to `bg-[var(--ink)] text-[var(--paper)]`, with red step numbers and `#A3A3A3` muted text.
- Tokens the examples bind: `--ink` #111111, `--muted` #A3A3A3, `--paper` #F9F9F7, `--red` #CC0000.

**Type.**

- Headlines `Playfair Display`, sentence case: hero `text-9xl leading-[0.9] tracking-tighter`, sections `text-5xl font-black`, cards `text-3xl font-bold`.
- Body `Lora` `text-lg leading-relaxed`, justified (`text-justify`) in multi-column bodies.
- Navigation, labels, buttons and bylines in `Inter`, uppercase `text-xs tracking-widest`; stats, dates and edition numbers in `JetBrains Mono`.
- Key paragraphs open with a `text-7xl float-left` drop cap, optionally red.

**Shape and depth.** Square corners everywhere; 1px ink borders, `border-4` or `border-b-4` for major dividers. Grid cells share single ink rules like a printed page. Rules between grid cells come from gap-px on a container filled with the rule color, each cell keeping its own background. Flat, except a hard cutout shadow `shadow-[4px_4px_0px_0px_var(--ink)]`. A hard shadow is an unblurred offset down and right, shadow-[<n>px_<n>px_0px_0px_<color>], 4px on small elements and 8px on cards; every element casts it the same way. Textures: a 4px ink dot grid at 4% and a faint 3px line grid, and image placeholders in a halftone of 1px-radius ink dots every 16px at 10%. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A dot grid is a repeating pattern behind the content whose tile is <gap>px square around one circle of radius <dot>px. A line grid is a repeating pattern behind the content whose tile is <gap>px square with lines along its top and left edges at the style's weight (1px unless it says otherwise). Parallel lines keep only the top edge, and stripes widen that one line to a band. A diagonal hatch, stripe or crosshatch rotates the tile with patternTransform="rotate(45)".

**Components.**

- Buttons `uppercase tracking-widest rounded-none`: primary `bg-[var(--ink)] text-[var(--paper)]`; outline `border border-[var(--ink)]`; links `underline-offset-4 decoration-2 decoration-[var(--red)]`.
- Cards `border border-[var(--ink)] bg-[var(--paper)] p-6`; pricing cards may use dashed rules between features.
- Inputs: bottom border only, `border-b-2 border-[var(--ink)] font-mono text-sm`.
- Thin Feather icons in ink, or in square `border border-[var(--ink)] h-12 w-12` boxes.

**Signature moves.**

- Vertical `border-r` rules forming strict newspaper columns.
- Edition metadata: "Vol. 1 | [Date] | New York Edition" in the header, "Fig. 1.1" captions, a printed-in line in the footer.
- A black stats ticker band with white text and red badges, like a breaking-news crawl.
- Photos `grayscale` (or `sepia-[50%]` for vintage).
- Ornamental dividers: `✧ ✧ ✧` centered in `text-2xl text-[var(--muted)] tracking-[1em]`.

**Layout.** `max-w-screen-xl px-4` on a 12-column grid with editorial splits: 8/4 hero, 5/7 benefits. Dense 8px spacing (`gap-2` to `gap-8`), sections `py-16`, cards `p-6`–`p-8`.
