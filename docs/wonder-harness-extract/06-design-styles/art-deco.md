<!-- get_design_guidelines {"style": "art-deco"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Art Deco

The Roaring Twenties as an interface: Gatsby opulence with skyscraper geometry. Hard edges, bilateral symmetry, verticality and geometry used as ornament (chevrons, ziggurats, sunbursts, fans). Every container is a small architectural facade.

**Palette.**

- Ground `#0A0A0A` obsidian; cards `#141414`.
- Text `#F2F0E4` champagne cream (body and small sizes); secondary text `#888888` pewter.
- Gold `#D4AF37` for accents, headings and borders, with `#F2E8C4` for highlights and a light-to-dark metallic sheen on buttons and borders. Gold stays out of long-form body text.
- Midnight blue `#1E3D59` for quiet depth and inactive states.
- Contrast is theatrical: elements sit either in shadow or in light.
- Tokens the examples bind: `--card` #141414, `--gold` #D4AF37, `--gold-glow` rgba(212,175,55,0.2), `--gold-glow-strong` rgba(212,175,55,0.4), `--gold-sunburst` rgba(212,175,55,0.15), `--ground` #0A0A0A.

**Type.** Headings `Marcellus` or `Italiana`; body `Josefin Sans`. All display text is `uppercase tracking-widest`: H1 `text-6xl`–`text-7xl`, card titles `font-['Marcellus'] text-2xl text-[var(--gold)] uppercase tracking-widest`, labels `text-xs uppercase tracking-widest text-[var(--gold)]`.

**Shape and depth.** `rounded-none` (2px at most). Borders are a feature: thin 1px gold lines or `border-[3px]`, often doubled (a border inside a border). Depth is a gold glow like backlit signage, `shadow-[0_0_15px_var(--gold-glow)]` up to `shadow-[0_0_25px_var(--gold-glow-strong)]`. Glow depth replaces drop shadows with zero-offset colored shadows, shadow-[0_0_<blur>px_<color>], stacked from a tight bright layer to a wide faint one; text glows use drop-shadow-[0_0_<blur>px_<color>].

**Components.** Buttons are architectural, `rounded-none uppercase tracking-widest h-12`: gold outline `border-2 border-[var(--gold)] text-[var(--gold)]` by default, solid `bg-[var(--gold)] text-[var(--ground)]` for the main action. Cards are framed exhibits: `bg-[var(--card)] border border-[var(--gold)]/30` with small L-bracket corners (`absolute top-2 right-2 h-4 w-4 border-t border-r border-[var(--gold)]/50` and its bottom-left mirror) and a gold-ruled title band. Inputs are a single gold underline, `bg-transparent border-0 border-b-2 border-[var(--gold)]`, with gold uppercase labels. A diagonal corner cut: `[clip-path:polygon(0_0,100%_0,100%_calc(100%-20px),calc(100%-20px)_100%,0_100%)]`.

**Signature moves.**

- A diagonal gold crosshatch over the ground at 3–5% opacity, 1px lines every 20px at 45° and -45°. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A line grid is a repeating pattern behind the content whose tile is <gap>px square with lines along its top and left edges at the style's weight (1px unless it says otherwise). Parallel lines keep only the top edge, and stripes widen that one line to a band. A diagonal hatch, stripe or crosshatch rotates the tile with patternTransform="rotate(45)".
- Gold sunburst radials (`radial-gradient(ellipse_at_center,var(--gold-sunburst)_0%,transparent_70%)`) behind focal points.
- Icons and avatars in 45°-rotated diamonds with the content counter-rotated upright.
- Roman numerals for steps, tiers and lists, in the display serif.
- Section headings flanked by short gold rules (`h-px w-24 bg-[var(--gold)]` on each side), never full-width rules.
- Images double-bordered (gold outside, black inside) and `grayscale`.
- Thin vertical gold lines (`w-px bg-[var(--gold)]/20`) add architectural height.

**Layout.** Symmetric on a central axis: hero, headings and CTAs centered, decoration mirrored. Even grid counts (3-column features and pricing, 2-column benefits), sections `py-32`, cards `p-8`, containers `max-w-6xl`.
