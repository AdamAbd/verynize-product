<!-- get_design_guidelines {"style": "playful-geometric"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Playful Geometric

"Stable grid, wild decoration": the Memphis Group cleaned up for modern screens. Content lives in clean, readable areas while the space around it is alive with shapes and color. Friendly, tactile and pop, like a well-organized sticker book.

**Palette.** High saturation on warm paper.

- Ground `#FFFDF5`; cards and inputs `#FFFFFF`; muted backgrounds `#F1F5F9`; borders `#E2E8F0`.
- Text, dark borders and hard shadows `#1E293B`; secondary text `#64748B`.
- Violet `#7C3AED` leads for primary actions and focus. Pink `#F472B6`, amber `#FBBF24` and mint `#34D399` rotate as confetti through decorative shapes, icons and emphasized words, in supporting amounts.
- Tokens the examples bind: `--border` #E2E8F0, `--ink` #1E293B, `--input-border` #CBD5E1, `--pink` #F472B6, `--violet` #7C3AED, `--white` #FFFFFF.

**Type.** Headings `Outfit` 700–800 (rounded geometric); body `Plus Jakarta Sans` 400–500; a 1.25 scale. Input labels bold, uppercase, small, `tracking-wide`.

**Shape and depth.** Chunky `border-2` on every interactive element and container. Radii `rounded-lg`, `rounded-2xl`, `rounded-3xl` and pills, often mixed on one shape for character: a speech bubble `rounded-tl-2xl rounded-tr-2xl rounded-br-2xl rounded-bl-none`, an arch `rounded-t-full rounded-b-none`, leaf shapes from opposite rounded corners. Shadows are hard pops: `shadow-[4px_4px_0px_0px_var(--ink)]` on buttons, `shadow-[8px_8px_0px_var(--border)]` on cards, `shadow-[8px_8px_0px_var(--pink)]` on the featured card. A hard shadow is an unblurred offset down and right, shadow-[<n>px_<n>px_0px_0px_<color>], 4px on small elements and 8px on cards; every element casts it the same way.

**Components.**

- The candy button: `bg-[var(--violet)] text-[var(--white)] font-bold rounded-full border-2 border-[var(--ink)] shadow-[4px_4px_0px_var(--ink)]`, with an arrow in a small white circle inside. Secondary `border-2 border-[var(--ink)] rounded-full` on transparent.
- Sticker cards `bg-[var(--white)] border-2 border-[var(--ink)] rounded-xl shadow-[8px_8px_0px_var(--border)]`, with an icon circle sitting half over the top edge.
- Inputs `bg-[var(--white)] border-2 border-[var(--input-border)] rounded-lg`.
- Icons always inside a shape: a white Feather icon in a violet, pink, amber or mint circle with `border-2 border-[var(--ink)]`.

**Signature moves.**

- Primitive shapes everywhere around content: circles, triangles, squares, pills and squiggles as backgrounds, masks, dividers and heading underlines; small confetti shapes behind content blocks.
- Pattern fills: a dot grid, grid lines or diagonal stripes in shapes and backgrounds. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A dot grid is a repeating pattern behind the content whose tile is <gap>px square around one circle of radius <dot>px. A line grid is a repeating pattern behind the content whose tile is <gap>px square with lines along its top and left edges at the style's weight (1px unless it says otherwise). Parallel lines keep only the top edge, and stripes widen that one line to a band. A diagonal hatch, stripe or crosshatch rotates the tile with patternTransform="rotate(45)".
- Hero: text left, image right in a blob mask over a dotted pattern, with a huge amber circle behind the headline.
- Features in three columns linked by dashed lines, card headers alternating violet, pink and amber; the middle pricing card at `scale-110` with a rotated star badge.

**Layout.** `max-w-6xl`, sections `py-24`, a 12-column grid grouped into large 6/6 or 4/4/4 blocks.
