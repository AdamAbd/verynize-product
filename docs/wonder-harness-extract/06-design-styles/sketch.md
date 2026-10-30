<!-- get_design_guidelines {"style": "sketch"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Hand-Drawn / Sketch

Authentic imperfection: sketches on paper, sticky notes on a wall, a napkin diagram from a brainstorm. Wobbly edges, hard offset shadows and handwritten type give it work-in-progress energy that feels approachable and invites collaboration.

**Palette.**

- Ground `#fdfbf7` warm paper with a notebook dot grain of `#e5e0d8` 1px-radius dots every 24px; cards and buttons `#FFFFFF`; erased-pencil fills `#e5e0d8`. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A dot grid is a repeating pattern behind the content whose tile is <gap>px square around one circle of radius <dot>px.
- Text, every border and every shadow `#2d2d2d` soft pencil.
- Red correction marker `#ff4d4d` for accents, thumbtacks and highlights; blue ballpoint `#2d5da1` for links and secondary accents; post-it yellow `#fff9c4` for feature notes.
- Tokens the examples bind: `--card` #FFFFFF, `--card-shadow` rgba(45,45,45,0.1), `--marker-red` #FF4D4D, `--pencil` #2D2D2D, `--post-it` #FFF9C4, `--tape` #D1D5DB.

**Type.** Headings `Kalam` 700 (felt-tip marker): H1 `text-5xl`, H2 `text-3xl`. Body `Patrick Hand` at `text-lg` and up, since handwriting needs the size. Wavy underlines on links, an exclamation mark tilted `rotate-12` now and then.

**Shape and depth.** Every container, button and input has a wobbly hand-drawn radius instead of a standard `rounded-*`, alternating two patterns between neighbors, one radius per corner:

- A: `rounded-[255px_15px_225px_15px]`
- B: `rounded-[15px_255px_15px_225px]`

Borders `border-2` and up (`border-[3px]` on buttons), `border-dashed` for secondary elements and dividers. Shadows are solid like cut paper: `shadow-[4px_4px_0px_0px_var(--pencil)]`, `shadow-[8px_8px_0px_0px_var(--pencil)]` for emphasis, `shadow-[3px_3px_0px_0px_var(--card-shadow)]` on plain cards. A hard shadow is an unblurred offset down and right, shadow-[<n>px_<n>px_0px_0px_<color>], 4px on small elements and 8px on cards; every element casts it the same way.

**Components.**

- Buttons `border-[3px] border-[var(--pencil)] bg-[var(--card)] px-6 py-3 text-lg shadow-[4px_4px_0px_0px_var(--pencil)]` with pattern A; secondary on `#e5e0d8`.
- Cards `border-2 border-[var(--pencil)] bg-[var(--card)] p-6` with pattern B, decorated with a tape strip (`absolute -top-3 left-1/2 h-6 w-16 -translate-x-1/2 rotate-2 bg-[var(--tape)]/50`), a red thumbtack (`h-5 w-5 rounded-full border-2 bg-[var(--marker-red)]`) or a speech-bubble tail (a rotated bordered square past the bottom edge).
- Post-it cards `rotate-1 bg-[var(--post-it)] border-2 p-6` with the hard shadow.
- Inputs `h-12 border-2 border-[var(--pencil)] bg-[var(--card)] px-4 text-lg` with pattern A.
- Icons in pencil color inside rough circles `rounded-[50%_45%_55%_48%] border-2 bg-[var(--card)]`.

**Signature moves.**

- Hand-drawn SVG: dashed curved arrows pointing at calls to action (a quadratic path with `strokeDasharray="4 4"` and a small arrowhead) and squiggly dashed connectors between steps.
- Elements tilted between `-rotate-2` and `rotate-2`; a dashed circle drawn around the popular pricing tier; overlapping avatars with `-space-x-4`; decorations that reach past their container.

**Layout.** Sketchbook-contained: `max-w-5xl` (`max-w-3xl` focused), sections `py-20`, gaps `gap-8`, stats in irregular shapes rather than perfect circles.
