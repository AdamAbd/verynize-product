<!-- get_design_guidelines {"style": "industrial"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Industrial Skeuomorphism

An interface that feels like a machine: Dieter Rams clarity with Teenage Engineering playfulness. Matte ABS plastic, brushed aluminum, powder-coated steel and safety-orange controls, like a 1980s Braun synthesizer or a spacecraft panel. Light comes from the top-left at 45°, so highlights sit on top and left edges and shadows on bottom and right.

**Palette.** Light mode, workshop lighting.

- Chassis `#e0e5ec`; raised panels `#f0f2f5`, sparingly; recessed wells `#d1d9e6`.
- Text `#2d3436` charcoal; labels `#4a5568`; hard edges `#a3b1c6`.
- Shadow pair: dark `#babecc` bottom-right, light `#ffffff` top-left.
- Safety red-orange `#ff4757` is the emergency stop: interactive elements, LEDs and critical alerts only.
- Dark technical panels (screens) use `#2d3436` or `#2c3e50` with `#e0e5ec` text.
- Tokens the examples bind: `--button-highlight` rgba(255,100,110,0.4), `--button-shadow` rgba(166,50,60,0.4), `--chassis` #E0E5EC, `--control-highlight` rgba(255,255,255,0.5), `--ink` #000000, `--led-glow` rgba(255,71,87,0.6), `--pipe-shadow` rgba(0,0,0,0.2), `--safety` #FF4757, `--scanline` rgba(0,0,0,0.25), `--screw` rgba(0,0,0,0.15), `--shadow-dark` #BABECC, `--shadow-light` #FFFFFF, `--tape` rgba(255,230,0,0.3), `--well` #D1D9E6.

**Type.** `Inter` for text; `JetBrains Mono` or `Roboto Mono` for numerics, badges, inputs and uppercase metadata. Hero `text-5xl`–`text-7xl` weight 800 `tracking-[-0.03em]` embossed with `drop-shadow-[0_1px_1px_var(--shadow-light)]`; sections `text-3xl`–`text-4xl` 700; labels and buttons `text-xs`–`text-sm` bold uppercase mono at `0.05em`–`0.08em`.

**Shape and depth.** Soft injection-molded radii: 4px badges, 8px inputs, 16px cards, 24px bezels, 30px+ hero panels, full circles for LEDs and icon housings. Extruded and pressed surfaces share one top-left light: a raised element pairs a dark shadow offset down-right with a light one offset up-left, and a recessed one uses the same pair inset; primary elements rise, inputs and wells press in. Four elevation levels, all with paired shadows:

- Recessed (inputs, screens, slots): `shadow-[inset_4px_4px_8px_var(--shadow-dark),inset_-4px_-4px_8px_var(--shadow-light)]`.
- Chassis: no shadow.
- Panels: `shadow-[8px_8px_16px_var(--shadow-dark),-8px_-8px_16px_var(--shadow-light)]`.
- Floating controls: `shadow-[12px_12px_24px_var(--shadow-dark),-12px_-12px_24px_var(--shadow-light),inset_1px_1px_0_var(--control-highlight)]`; pressed `inset 6px 6px 12px` pair.

**Components.**

- Primary button `bg-[var(--safety)] text-[var(--ink)] uppercase tracking-[0.05em] font-bold rounded-lg shadow-[4px_4px_8px_var(--button-shadow),-4px_-4px_8px_var(--button-highlight)]`; secondary is chassis-colored with the panel shadow.
- Cards are panels bolted to the chassis: `bg-[var(--chassis)] rounded-2xl` with the panel shadow, four corner screws (stacked `radial-gradient(circle_at_12px_12px,var(--screw)_2px,transparent_3px)` at each corner) and three vertical vent slots top-right (`h-6 w-1 rounded-full bg-[var(--well)]` with an inset shadow). Every card carries them.
- Inputs are recessed mono wells `h-14 px-6 rounded-lg`.
- Icons sit in circular housings `h-14 w-14 rounded-full` with the floating shadow.

**Signature moves.**

- A CSS device in the hero: a carbon-fibre bezel, a black inset screen with scanlines, side buttons, a power LED and glowing dashboard content. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. CRT scanlines are a repeating pattern in var(--scanline) over the screen they cover, whose tile is 4px square with a band across its lower 2px.
- LED indicators, 8–12px with `shadow-[0_0_10px_2px_var(--led-glow)]` (or green), always beside a mono label such as "PWR" or "ONLINE".
- Steps joined by recessed pipes `h-3 rounded-full bg-[var(--well)] shadow-[inset_0_1px_3px_var(--pipe-shadow)]`; masking-tape labels `skew-x-12 bg-[var(--tape)]`; push pins on testimonials; punched holes in pricing cards.
- Matte noise over the page at 20–30% with `mix-blend-overlay`, a blueprint grid where technical, and `grayscale` photos. A noise overlay is one pointer-events-none absolute inset-0 layer over the whole artboard holding an SVG feTurbulence filter (type="fractalNoise", base frequency about 0.8, 4 octaves); the style sets its opacity and any blend mode. A line grid is a repeating pattern behind the content whose tile is <gap>px square with lines along its top and left edges at the style's weight (1px unless it says otherwise). Parallel lines keep only the top edge, and stripes widen that one line to a band. A diagonal hatch, stripe or crosshatch rotates the tile with patternTransform="rotate(45)".

**Layout.** `max-w-6xl`, `space-y-24` between sections, 2–4 column grids at `gap-6`–`gap-8`. Hero 60/40 with sides alternating down the page; testimonials tilted `rotate-1` and `-rotate-1`.
