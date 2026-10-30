<!-- get_design_guidelines {"style": "web3"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Bitcoin DeFi / Web3

Precision engineering, cryptographic trust and digital gold: a cosmic void where data structures glow with Bitcoin-orange warmth, like mining rigs humming in the dark. Light comes from the elements themselves; borders are ultra-thin, data is set in mono, and grids are strict. Secure, technical, valuable, and warmer than generic dark mode.

**Palette.** Dark only and strictly warm.

- Void `#030304`; cards and panels `#0F1115`; sections alternate the two instead of using hard dividers.
- Text `#FFFFFF`; secondary text `#94A3B8`; borders 1px white at 10–20% (`border-[var(--white)]/10`) or `#1E293B`.
- Bitcoin orange `#F7931A` for actions, links and active states; burnt orange `#EA580C` for depth; digital gold `#FFD600` for value and success.
- Gradients `from-[var(--burnt-orange)] to-[var(--orange)]` and `from-[var(--orange)] to-[var(--gold)]`. Every shadow is orange or gold tinted.
- Tokens the examples bind: `--action-glow` rgba(234,88,12,0.5), `--action-glow-strong` rgba(247,147,26,0.6), `--black` #000000, `--burnt-orange` #EA580C, `--card` #0F1115, `--card-glow` rgba(247,147,26,0.1), `--gold` #FFD600, `--gold-glow` rgba(255,214,0,0.3), `--grid-line` rgba(30,41,59,0.5), `--orange` #F7931A, `--text-muted` #94A3B8, `--white` #FFFFFF.

**Type.** Headings `Space Grotesk` (hero `text-7xl leading-tight`), body `Inter` `leading-relaxed`, and `JetBrains Mono` for stats, prices, badges, labels and navigation, uppercase `tracking-wider`. The last one or two hero words take the gold gradient. Gradient text is bg-gradient-to-r from-<a> to-<b> bg-clip-text text-transparent on display-size words only (text-5xl and up), most often the headline's last word or two.

**Shape and depth.** Cards `rounded-2xl` or `rounded-xl`, buttons `rounded-full`, inputs `rounded-lg` or bottom-border only. Depth is colored light. Glow depth replaces drop shadows with zero-offset colored shadows, shadow-[0_0_<blur>px_<color>], stacked from a tight bright layer to a wide faint one; text glows use drop-shadow-[0_0_<blur>px_<color>]. Action glows `shadow-[0_0_20px_-5px_var(--action-glow)]` (intense `shadow-[0_0_30px_-5px_var(--action-glow-strong)]`), card glows `shadow-[0_0_50px_-10px_var(--card-glow)]`, gold `shadow-[0_0_20px_var(--gold-glow)]`. Glass `bg-[var(--black)]/40 backdrop-blur-sm` or `bg-[var(--white)]/5 backdrop-blur-lg` over the grid.

**Components.**

- Primary button `bg-gradient-to-r from-[var(--burnt-orange)] to-[var(--orange)] text-[var(--black)] font-bold uppercase tracking-wider rounded-full` with the orange glow; outline `border-2 border-[var(--white)]/20 rounded-full`.
- Cards are blocks in the chain: `bg-[var(--card)] border border-[var(--white)]/10 rounded-2xl p-8`, title `text-2xl font-semibold`, description `text-[var(--text-muted)] text-sm`. The popular pricing tier `scale-105 border-[var(--orange)]` with a glow.
- Inputs `bg-[var(--black)]/50 border-b-2 border-[var(--white)]/20 h-12 px-4 text-sm`.
- Icons in orange, gold or muted, in node wells `bg-[var(--burnt-orange)]/20 border border-[var(--burnt-orange)]/50 rounded-lg p-3`.

**Signature moves.**

- The blockchain grid: 1px `var(--grid-line)` lines every 50px, faded out from the center with `[mask-image:radial-gradient(circle_at_center,black_40%,transparent_100%)]`. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A line grid is a repeating pattern behind the content whose tile is <gap>px square with lines along its top and left edges at the style's weight (1px unless it says otherwise). Parallel lines keep only the top edge, and stripes widen that one line to a band. A diagonal hatch, stripe or crosshatch rotates the tile with patternTransform="rotate(45)".
- Ambient orange blobs at 10%. Ambient orbs are large rounded-full circles of an accent color, 400 to 900px, blurred with blur-3xl to blur-[150px] and placed off the corners in one absolute inset-0 layer behind the content; the style sets their colors, count and opacity.
- A hero orb inside concentric orbital rings, surrounded by staggered floating stat cards.
- Feature cards with orange corner accents (`border-t border-l` top-left, `border-r border-b` bottom-right) and a large rotated icon watermark at `opacity-20`.
- Trust badges with live status dots; how-it-works as a ledger: a vertical orange-to-transparent line with numbered circular nodes.

**Layout.** `max-w-7xl`, sections `py-24`, gaps `gap-8`–`gap-12`; a subtle `border-y` only around a stats ticker.
