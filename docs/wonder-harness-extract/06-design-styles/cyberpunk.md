<!-- get_design_guidelines {"style": "cyberpunk"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Cyberpunk / Glitch

"High-tech, low-life": a hacked feed on a malfunctioning CRT in a rain-soaked megacity. Scanlines, RGB splitting and signal noise are features. The void is absolute, neon illuminates rather than colors, and shapes are angular and industrial. Dangerous, electric, rebellious.

**Palette.** Dark only.

- Void `#0a0a0f`; cards and inputs `#12121a`; chrome surfaces `#1c1c2e`; borders `#2a2a3a`.
- Text `#e0e0e0`; secondary text `#9CA3AF`.
- Neons at full saturation: green `#00ff88` (primary), magenta `#ff00ff`, electric blue `#00d4ff`; danger `#ff3366`.
- Tokens the examples bind: `--border` #2A2A3A, `--card` #12121A, `--chrome` #1C1C2E, `--magenta` #FF00FF, `--neon-blue` #00D4FF, `--neon-green` #00FF88, `--neon-green-faint` #00FF8830, `--neon-green-mid` #00FF8860, `--neon-green-soft` #00FF8840, `--scanline` rgba(0,0,0,0.3), `--text-glow` rgba(0,255,136,0.5), `--void` #0A0A0F.

**Type.** Monospace and geometric only. Headings `Orbitron` or `Share Tech Mono`: H1 `text-6xl`–`text-8xl font-black uppercase tracking-widest`, H2 `text-4xl`–`text-5xl` bold uppercase. Body `JetBrains Mono` or `Fira Code`, `tracking-wide leading-relaxed`. Labels `Share Tech Mono text-sm uppercase tracking-[0.2em]`. The hero headline carries chromatic aberration: `[text-shadow:-1px_0_var(--magenta),1px_0_var(--neon-blue)]`.

**Shape and depth.** Square silhouettes (`rounded-sm` on inputs only) with chamfered corners on cards and buttons: `[clip-path:polygon(0_10px,10px_0,calc(100%-10px)_0,100%_10px,100%_calc(100%-10px),calc(100%-10px)_100%,10px_100%,0_calc(100%-10px))]`. Neon borders glow. Glow depth replaces drop shadows with zero-offset colored shadows, shadow-[0_0_<blur>px_<color>], stacked from a tight bright layer to a wide faint one; text glows use drop-shadow-[0_0_<blur>px_<color>]. Here `shadow-[0_0_5px_var(--neon-green),0_0_10px_var(--neon-green-soft)]`, hero `shadow-[0_0_10px_var(--neon-green),0_0_20px_var(--neon-green-mid),0_0_40px_var(--neon-green-faint)]`, magenta and blue variants alike; glowing text `drop-shadow-[0_0_10px_var(--text-glow)]`.

**Components.**

- Buttons `font-mono uppercase tracking-wider`, chamfered: outlined `border-2 border-[var(--neon-green)] text-[var(--neon-green)]` (magenta for secondary); the hero CTA solid `bg-[var(--neon-green)] text-[var(--void)]` with the aberration shadow.
- Cards: default `bg-[var(--card)] border border-[var(--border)]`; terminal cards with a three-dot header bar for blog, FAQ and pricing; holographic cards `bg-[var(--chrome)]/30 border border-[var(--neon-green)]/30 backdrop-blur` with a neon glow and four `w-4 h-4` corner brackets in green.
- Inputs `bg-[var(--card)] border border-[var(--border)] font-mono text-[var(--neon-green)] pl-8` with a green `>` prompt.
- Thin 1.5px stroke icons in bordered, glowing squares or hexagons.

**Signature moves.**

- Scanlines over the page, plus one more texture: faint accent radials in corners, or noise at 5–10%. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. CRT scanlines are a repeating pattern in var(--scanline) over the screen they cover, whose tile is 4px square with a band across its lower 2px. A noise overlay is one pointer-events-none absolute inset-0 layer over the whole artboard holding an SVG feTurbulence filter (type="fractalNoise", base frequency about 0.8, 4 octaves); the style sets its opacity and any blend mode.
- A circuit grid in at least one section: green 1px lines at 3% every 50px. A line grid is a repeating pattern behind the content whose tile is <gap>px square with lines along its top and left edges at the style's weight (1px unless it says otherwise). Parallel lines keep only the top edge, and stripes widen that one line to a band. A diagonal hatch, stripe or crosshatch rotates the tile with patternTransform="rotate(45)".
- At least one terminal section with `>` prefixes and a static `█` cursor mid-line.

**Layout.** `max-w-7xl` with full-bleed sections, `py-24`–`py-32`, dense interiors. Hero at least 60/40; features in a `-skew-y-1` three-column grid; pricing with the middle tier scaled up; stats in one ruled row; one section of overlapping elements and staggered card heights. Rules between grid cells come from gap-px on a container filled with the rule color, each cell keeping its own background.
