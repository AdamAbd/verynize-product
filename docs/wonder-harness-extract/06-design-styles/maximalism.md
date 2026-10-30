<!-- get_design_guidelines {"style": "maximalism"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Maximalism / Dopamine

More is more: sensory abundance, clashing patterns, screaming color and joyful overlap, a Lisa Frank fever dream crossed with hyperpop album art. If it is not overwhelming in a joyful way, add more.

**Palette.**

- Void `#0D0D1A`; containers `#2D1B4E` at 50–80% opacity; text `#FFFFFF`, or `#0D0D1A` on every accent but purple.
- Five accents in rotation: magenta `#FF3AF2`, cyan `#00F5D4`, yellow `#FFE600`, orange `#FF6B35`, purple `#7B2FFF`. Each section leads with a different one; grid items cycle through all five.
- Borders always clash with what they sit on (magenta fill, yellow border; cyan fill, orange border). Accents are for decoration and display text; body stays white.
- Tokens the examples bind: `--container` #2D1B4E, `--cyan` #00F5D4, `--cyan-glow` rgba(0,245,212,0.3), `--magenta` #FF3AF2, `--magenta-glow` rgba(255,58,242,0.5), `--purple` #7B2FFF, `--void` #0D0D1A, `--yellow` #FFE600.

**Type.** Headings `Outfit` or `Unbounded` 800–900, uppercase, `tracking-tighter`, mixed weights within one headline; body `DM Sans` 400–500 at `text-lg`–`text-xl`; `Bangers` or `Bungee` for the odd callout. Hero `text-7xl`–`text-9xl`, sections `text-5xl`–`text-7xl`. Headlines carry stacked text shadows: `[text-shadow:2px_2px_0px_var(--purple),4px_4px_0px_var(--magenta),6px_6px_0px_var(--cyan)]` (double the offsets for the hero); a fifth to a third of headlines use a `from-[var(--magenta)] via-[var(--cyan)] to-[var(--yellow)]` gradient. Gradient text is bg-gradient-to-r from-<a> to-<b> bg-clip-text text-transparent on display-size words only (text-5xl and up), most often the headline's last word or two.

**Shape and depth.** `border-4` standard and `border-8` for featured elements and dividers, mixing solid, `border-dashed` and `border-double` within a section. Buttons `rounded-full`, cards `rounded-3xl`, containers `rounded-2xl`, with one clipped or squared corner here and there. Shadows stack in several accents: hard `shadow-[12px_12px_0_var(--cyan),24px_24px_0_var(--magenta),36px_36px_0_var(--yellow)]`, glow `shadow-[0_0_20px_var(--magenta-glow),0_0_40px_var(--cyan-glow)]`, both together on hero elements. A hard shadow is an unblurred offset down and right, shadow-[<n>px_<n>px_0px_0px_<color>], 4px on small elements and 8px on cards; every element casts it the same way. Glow depth replaces drop shadows with zero-offset colored shadows, shadow-[0_0_<blur>px_<color>], stacked from a tight bright layer to a wide faint one; text glows use drop-shadow-[0_0_<blur>px_<color>].

**Components.**

- Primary button: gradient `from-[var(--magenta)] to-[var(--cyan)]` with `text-[var(--void)]`, `border-4 border-[var(--yellow)]`, `rounded-full h-14 px-10 font-black uppercase tracking-widest`, glow plus hard shadow. Secondary: transparent with `border-4 border-dashed` in an accent.
- Cards `bg-[var(--container)]/80 backdrop-blur-sm border-4 rounded-3xl p-8`–`p-12` with a hard stacked shadow, tilted `rotate-1` or `rotate-2`, a dashed header rule in another accent and a pattern overlay.
- Inputs `bg-[var(--container)]/50 border-4 rounded-full px-6 py-4 text-lg font-bold`.
- Icons `h-10 w-10`, thick stroke, in accent-bordered circles at `bg-[accent]/20`.

**Signature moves.**

- Two or three layered patterns per section at 5–30% opacity, some with `mix-blend-screen`: a magenta dot grid of 1px-radius dots every 20px, yellow diagonal stripes and an accent gradient mesh. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A dot grid is a repeating pattern behind the content whose tile is <gap>px square around one circle of radius <dot>px. A line grid is a repeating pattern behind the content whose tile is <gap>px square with lines along its top and left edges at the style's weight (1px unless it says otherwise). Parallel lines keep only the top edge, and stripes widen that one line to a band. A diagonal hatch, stripe or crosshatch rotates the tile with patternTransform="rotate(45)".
- Five to ten floating shapes or emoji per section at deliberately uneven sizes.
- A giant background word (WOW, YES, GO) at `text-[12rem]`–`text-[20rem]`, `opacity-20`, bleeding off the edges.

**Layout.** A broken grid: `col-span-2` beside `col-span-1`, every other item `translate-y-8`, negative margins for overlap, occasional `skew-x-2`. Sections `py-24`–`py-32`; hero `max-w-none`, reading `max-w-3xl`.
