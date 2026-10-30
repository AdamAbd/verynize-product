<!-- get_design_guidelines {"style": "vaporwave"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Vaporwave / Outrun

1980s retro-futurism drenched in neon: perspective grids receding to the horizon, CRT scanlines, a blurred sunset sun and glowing everything, like commanding a vintage terminal in the year 2088. Depth comes from overlapping gradients, glows and skewed geometry rather than subtlety.

**Palette.** Dark only, full-saturation neon tubes in a void.

- Void `#090014`; glass panels `#1a103c` at 80% with backdrop blur; dividers `#2D1B4E`.
- Text `#E0E0E0` chrome.
- Magenta `#FF00FF` for hero actions, highlights and accent borders; cyan `#00FFFF` for links, secondary borders and card titles; sunset orange `#FF9900` sparingly.
- Gradients: sunset text `from-[var(--orange)] via-[var(--magenta)] to-[var(--cyan)]`; sun `bg-gradient-to-b from-[var(--orange)] to-[var(--magenta)]`; accent bars `from-[var(--magenta)] to-[var(--cyan)]`.
- Tokens the examples bind: `--black` #000000, `--cyan` #00FFFF, `--cyan-glow` rgba(0,255,255,0.2), `--cyan-glow-strong` rgba(0,255,255,0.8), `--magenta` #FF00FF, `--magenta-glow` rgba(255,0,255,0.6), `--orange` #FF9900, `--panel` #1A103C.

**Type.** Headings `Orbitron` up to 900, uppercase: hero `text-7xl`–`text-9xl` split across lines and filled with the sunset gradient, sections `text-5xl`–`text-6xl` black weight. Gradient text is bg-gradient-to-r from-<a> to-<b> bg-clip-text text-transparent on display-size words only (text-5xl and up), most often the headline's last word or two. Body and UI `Share Tech Mono`, labels uppercase `tracking-wider`. Glows: headlines `drop-shadow-[0_0_30px_var(--magenta-glow)]`, cyan card titles `drop-shadow-[0_0_5px_var(--cyan-glow-strong)]`.

**Shape and depth.** Square corners (`rounded-full` only for dots), `border-2` standard. Everything emits light. Glow depth replaces drop shadows with zero-offset colored shadows, shadow-[0_0_<blur>px_<color>], stacked from a tight bright layer to a wide faint one; text glows use drop-shadow-[0_0_<blur>px_<color>]. For example `shadow-[0_0_20px_var(--magenta)]`, or `shadow-[0_0_50px_var(--cyan-glow)]` on large containers. Neon-tube cards stack a bright cyan top border over faint magenta sides.

**Components.**

- Buttons `rounded-none uppercase tracking-wider font-mono h-12`, skewed: primary `-skew-x-12 border-2 border-[var(--cyan)] text-[var(--cyan)]` with the label in a counter-skewed `skew-x-12` span; secondary filled magenta, skewed the same way.
- Cards `border border-[var(--magenta)]/30 border-t-2 border-t-[var(--cyan)] bg-[var(--panel)]/80 backdrop-blur-md p-6`.
- Terminal windows `border-2 border-[var(--cyan)] bg-[var(--black)]/80` with a title bar of three dots in magenta, cyan and orange; file-explorer windows with a status bar.
- Inputs `border-b-2 border-[var(--magenta)] bg-[var(--black)] text-[var(--cyan)] font-mono text-lg`.
- Feature icons inside `rotate-45` diamonds.

**Signature moves.**

- The outrun floor: magenta grid lines every 40px across the lower part of the hero, faded toward the horizon with a mask. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A line grid is a repeating pattern behind the content whose tile is <gap>px square with lines along its top and left edges at the style's weight (1px unless it says otherwise). Parallel lines keep only the top edge, and stripes widen that one line to a band. A diagonal hatch, stripe or crosshatch rotates the tile with patternTransform="rotate(45)".
- A 600px blurred sun (`blur-[100px]`, sun gradient, `opacity-20`).
- CRT scanlines over the whole page, magenta dot patterns, and gradient overlays on images. CRT scanlines are a repeating pattern in var(--scanline) over the screen they cover, whose tile is 4px square with a band across its lower 2px. A dot grid is a repeating pattern behind the content whose tile is <gap>px square around one circle of radius <dot>px.
- Testimonials as IRC chat lines with `<username>`; how-it-works alternating left and right along a central line.

**Layout.** Widths by section: `max-w-7xl` main, `max-w-6xl` pricing, `max-w-5xl` hero, `max-w-4xl` FAQ; sections `py-32`, gaps `gap-8`–`gap-12`. Layers: grid floor, sun, section backgrounds, content, scanlines on top.
