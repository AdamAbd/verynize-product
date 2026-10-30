<!-- get_design_guidelines {"style": "claymorphism"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Claymorphism

A world made of premium digital clay: matte vinyl-toy surfaces that absorb light, dense and squeezable, floating with weight over a cool lavender ground. Playful, optimistic, tactile; candy-store colors and no sharp corners.

**Palette.**

- Ground `#F4F1FA` lavender white; text `#332F3A`; secondary text `#635F69` (the lightest gray text goes).
- Violet `#7C3AED` for actions and brand; hot pink `#DB2777` for gradients and secondary emphasis; sky `#0EA5E9` for information and blobs; emerald `#10B981` and amber `#F59E0B` for states and ratings.
- Primary buttons `bg-gradient-to-br from-[var(--violet)] to-[var(--violet-deep)] text-[var(--clay)]`. Icon orbs use a pastel-400 to saturated-600 gradient that varies per card.
- Tokens the examples bind: `--button-highlight` rgba(255,255,255,0.4), `--button-rim` rgba(0,0,0,0.1), `--button-shadow` rgba(139,92,246,0.3), `--card-highlight` rgba(255,255,255,0.9), `--card-shadow` rgba(160,150,180,0.2), `--card-tint` rgba(139,92,246,0.03), `--clay` #FFFFFF, `--violet` #7C3AED, `--violet-deep` #6D28D9, `--well` #EFEBF5, `--well-shadow` #D9D4E3.

**Type.** Headings `Nunito` 700–900 (rounded terminals); body `DM Sans` 400–700. Hero `text-8xl font-black tracking-tight leading-[1.1]`, sections `text-5xl font-extrabold`, card titles `text-xl`–`text-2xl font-bold`, body `text-base`–`text-lg font-medium`. Gradient text is bg-gradient-to-r from-<a> to-<b> bg-clip-text text-transparent on display-size words only (text-5xl and up), most often the headline's last word or two.

**Shape.** Radii are large and step down 8px per nesting level: hero containers `rounded-[48px]`–`rounded-[60px]`, cards `rounded-[32px]` (an image inside at `rounded-[24px]`), pills `rounded-[24px]`, buttons and inputs `rounded-[20px]`, orbs and badges `rounded-full`. Nothing smaller than 20px.

**Depth.** Every primary surface carries a four-layer stack: outer drop, top-left highlight, inner tint, inner rim.

- Floating card: `shadow-[16px_16px_32px_var(--card-shadow),-10px_-10px_24px_var(--card-highlight),inset_6px_6px_12px_var(--card-tint),inset_-6px_-6px_12px_var(--clay)]`
- Convex button: `shadow-[12px_12px_24px_var(--button-shadow),-8px_-8px_16px_var(--button-highlight),inset_4px_4px_8px_var(--button-highlight),inset_-4px_-4px_8px_var(--button-rim)]`
- Pressed well: `shadow-[inset_10px_10px_20px_var(--well-shadow),inset_-10px_-10px_20px_var(--clay)]`

Extruded and pressed surfaces share one top-left light: a raised element pairs a dark shadow offset down-right with a light one offset up-left, and a recessed one uses the same pair inset; primary elements rise, inputs and wells press in.

**Components.** Buttons `h-14` (`h-11` small, `h-16` large), `font-bold tracking-wide`, violet gradient with the convex stack, or white with a softer one. Cards are glass-clay: `bg-[var(--clay)]/70 backdrop-blur-xl rounded-[32px] p-8` with the floating stack, letting the blobs show through; hero features span `col-span-2 row-span-2`. Inputs are borderless recessed wells: `h-16 bg-[var(--well)] px-6 rounded-2xl` with the pressed stack.

**Signature moves.**

- Three or four large background blobs at 10% opacity in violet, pink and sky, about 600px across. Ambient orbs are large rounded-full circles of an accent color, 400 to 900px, blurred with blur-3xl to blur-[150px] and placed off the corners in one absolute inset-0 layer behind the content; the style sets their colors, count and opacity.
- Gradient icon orbs, different per card.
- Bento grids mixing `col-span-1`, `col-span-2` and `row-span-2`; 50/50 splits with an abstract composition of nested clay shapes on one side instead of a photo.
- Badges and decorative shapes break out of their containers with negative margins, so elements seem to hover.
