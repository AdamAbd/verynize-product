<!-- get_design_guidelines {"style": "saas"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Minimalist Modern SaaS

Clarity through structure, character through bold detail: high-tech SaaS precision crossed with a creative agency's portfolio. Whitespace directs attention, color concentrates into one electric blue gradient, and a serif and sans pairing balances warmth with precision.

**Palette.** One accent, always as its gradient, concentrated rather than sprinkled.

- Ground `#FAFAFA`; cards `#FFFFFF`; quiet surfaces `#F1F5F9`; borders `#E2E8F0`.
- Text `#0F172A` deep slate, also the background of inverted sections; secondary text `#64748B`.
- Accent gradient `bg-gradient-to-r from-[var(--blue)] to-[var(--blue-light)]` on primary buttons, featured badges, icon backgrounds, pricing borders, accent bars and highlighted words.
- Tokens the examples bind: `--blue` #0052FF, `--blue-lift` rgba(0,82,255,0.25), `--blue-lift-strong` rgba(0,82,255,0.35), `--blue-light` #2F66FF, `--blue-wash` rgba(0,82,255,0.15), `--blue-wash-light` rgba(77,124,255,0.1), `--border` #E2E8F0, `--card` #FFFFFF, `--ground` #FAFAFA, `--shadow` rgba(0,0,0,0.1), `--shadow-soft` rgba(0,0,0,0.06), `--text` #0F172A, `--text-muted` #64748B.

**Type.** Display `Calistoga` (normal weight): hero 84px at `tracking-[-0.02em] leading-[1.05]`, sections 52px. UI and body `Inter` (card titles 600, body 16px `leading-relaxed`). Section labels `JetBrains Mono` 12px uppercase `tracking-[0.15em]`. The last word of a headline takes the gradient, and the hero headline sits over a soft gradient bar (`absolute h-4 w-full bg-gradient-to-r from-[var(--blue-wash)] to-[var(--blue-wash-light)]`). Gradient text is bg-gradient-to-r from-<a> to-<b> bg-clip-text text-transparent on display-size words only (text-5xl and up), most often the headline's last word or two.

**Shape and depth.** Cards `rounded-xl`–`rounded-2xl border border-[var(--border)]`, buttons `rounded-xl`, badges `rounded-full`, the odd organic shape `rounded-tl-[4rem] rounded-br-[4rem]`. Layered diffuse shadows from `0 1px 3px var(--shadow-soft)` to `0 20px 25px var(--shadow)`, and blue-tinted lifts `0 4px 14px var(--blue-lift)` (featured `0 8px 24px var(--blue-lift-strong)`). Featured cards and pricing tiers get a 2px gradient border: a `p-[2px] bg-gradient-to-br from-[var(--blue)] via-[var(--blue-light)] to-[var(--blue)] rounded-xl` wrapper around a `rounded-[10px] bg-[var(--card)]` interior.

**Components.**

- Primary button: the gradient, white medium text, `rounded-xl shadow-sm`; outline `border border-[var(--border)]`; ghost `text-[var(--text-muted)]`.
- Cards `bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-md p-6`–`p-10`.
- Inputs `h-12`–`h-14 border border-[var(--border)] rounded-lg`.
- Section label badge opening each section: `inline-flex items-center gap-3 rounded-full border border-[var(--blue)]/30 bg-[var(--blue)]/5 px-5 py-2` with a `h-2 w-2 rounded-full bg-[var(--blue)]` dot and a mono uppercase label in blue.
- Feature icons on full-gradient fills.

**Signature moves.**

- At least one inverted section `bg-[var(--text)] text-[var(--ground)]` with a white dot texture at 3% every 32px. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A dot grid is a repeating pattern behind the content whose tile is <gap>px square around one circle of radius <dot>px.
- An abstract hero graphic: a dashed outer ring, staggered layered cards, geometric shapes, a 3×3 dot grid and a solid blue corner block.
- Texture against sterility: accent glows at 3–6% in section corners and an 8% accent radial over the hero. Ambient orbs are large rounded-full circles of an accent color, 400 to 900px, blurred with blur-3xl to blur-[150px] and placed off the corners in one absolute inset-0 layer behind the content; the style sets their colors, count and opacity.
- Large decorative details: 120px quotation marks, oversized step numbers, timeline steps joined by small blue arrow badges.

**Layout.** `max-w-6xl`, sections `py-28`–`py-44`, gaps `gap-5`–`gap-8`. Asymmetric splits: hero `grid-cols-[1.1fr_0.9fr]`, benefits `grid-cols-[1.2fr_0.8fr]`; the middle testimonial offset vertically, the highlighted pricing tier raised above its neighbors.
