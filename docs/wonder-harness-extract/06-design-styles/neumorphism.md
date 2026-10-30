<!-- get_design_guidelines {"style": "neumorphism"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Neumorphism Soft UI

Soft UI: elements look molded from one continuous surface of matte clay, either extruding from it or pressed into it, lit from the top-left. Shadow pairs do all the visual work. Tactile, calm, physically grounded.

**Palette.** One cool gray surface; color is rare.

- Everything, page and cards alike, is `#E0E5EC`, so elements belong to the surface rather than sitting on it. No gradient on the page.
- Text `#3D4852`; secondary text `#4B5563`; placeholders `#5A6473`.
- Violet `#5A52E6` (`#8B84FF` for gradients) for calls to action, sparingly; teal `#38B2AC` for success and checkmarks.
- Edges come from shadows, never borders. Shadow colors stay translucent: light `rgba(255,255,255,0.5)`, dark `rgb(163,177,198,0.6)`.
- Tokens the examples bind: `--on-violet` #FFFFFF, `--shadow-dark` rgb(163,177,198,0.6), `--shadow-deep` rgb(163,177,198,0.7), `--shadow-light` rgba(255,255,255,0.5), `--shadow-light-strong` rgba(255,255,255,0.6), `--surface` #E0E5EC, `--violet` #5A52E6.

**Type.** Headlines `Plus Jakarta Sans` 700–800 `tracking-tight`, up to `text-7xl`; body `DM Sans` 400–500.

**Shape and depth.** Containers and cards `rounded-[32px]`, buttons and inputs `rounded-2xl`, inner elements `rounded-xl` or `rounded-full`. Extruded and pressed surfaces share one top-left light: a raised element pairs a dark shadow offset down-right with a light one offset up-left, and a recessed one uses the same pair inset; primary elements rise, inputs and wells press in. Every element carries a dual shadow:

- extruded `shadow-[9px_9px_16px_var(--shadow-dark),-9px_-9px_16px_var(--shadow-light)]` (small: 5px and 10px);
- pressed `shadow-[inset_6px_6px_10px_var(--shadow-dark),inset_-6px_-6px_10px_var(--shadow-light)]`;
- deep well `shadow-[inset_10px_10px_20px_var(--shadow-deep),inset_-10px_-10px_20px_var(--shadow-light-strong)]`;
- shallow track `inset 3px 3px 6px` pair.

**Components.** Buttons `rounded-2xl` with the extruded shadow: primary `bg-[var(--violet)] text-[var(--on-violet)]`, secondary surface-colored. Cards `bg-[var(--surface)] rounded-[32px] p-8`–`p-20` extruded. Inputs `bg-[var(--surface)] rounded-2xl` with the pressed shadow.

**Signature moves.**

- Nested depth: an extruded card holding a deep-well icon socket holding the icon, so the icon looks drilled into the card.
- Concentric circles alternating extruded and inset rings as abstract background art.

**Layout.** Open and airy so shadows have room: hero `py-32`, grids `gap-12`, container `max-w-7xl`.
