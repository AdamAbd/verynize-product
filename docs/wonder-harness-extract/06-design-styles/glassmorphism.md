<!-- get_design_guidelines {"style": "glassmorphism"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Glassmorphism

Depth through layered translucency: frosted surfaces that filter saturated color beneath them, like macOS Control Center or a dashboard floating in space. Backdrop blur is the material; light passes through and edges catch highlights. Ethereal, weightless, cinematic.

**Palette.** Dark grounds lit by color orbs.

- Grounds `#050508`, `#0A0A14` and `#0F0F1A` behind panels.
- Glass is neutral white tint so it filters any orb: `bg-[var(--white)]/[0.03]` large containers, `bg-[var(--white)]/5` default, `bg-[var(--white)]/[0.08]` elevated, `bg-[var(--white)]/[0.12]` hover. Edges `border-[var(--white)]/10`, bright `border-[var(--white)]/20`.
- Text `#F8FAFC` on glass; body `#CBD5E1`; captions `#94A3B8`.
- Orbs violet `#7C3AED`, cyan `#06B6D4`, pink `#EC4899` (blue `#3B82F6` for variety) at 30–50% opacity, vivid enough to bleed through. Accents violet `#8B5CF6` and cyan `#06B6D4`; gradient `from-[var(--violet-deep)] to-[var(--cyan)]`. Where an orb brightens behind text, darken that glass with `bg-[var(--black)]/10` or move the orb.
- Tokens the examples bind: `--black` #000000, `--cyan` #06B6D4, `--cyan-deep` #0E7490, `--cyan-light` #A5F3FC, `--modal-highlight` rgba(255,255,255,0.15), `--modal-shadow` rgba(0,0,0,0.4), `--panel-highlight` rgba(255,255,255,0.1), `--panel-shadow` rgba(0,0,0,0.3), `--violet` #8B5CF6, `--violet-deep` #7C3AED, `--violet-glow` rgba(139,92,246,0.5), `--violet-light` #DDD6FE, `--white` #FFFFFF.

**Type.** Headings `Outfit` 500–700, body `Inter` 400/500. Display `text-7xl`–`text-8xl font-bold tracking-tight leading-none`, H1 `text-5xl`–`text-6xl font-semibold`. The hero headline echoes the orbs in a `from-[var(--white)] via-[var(--violet-light)] to-[var(--cyan-light)]` gradient. Gradient text is bg-gradient-to-r from-<a> to-<b> bg-clip-text text-transparent on display-size words only (text-5xl and up), most often the headline's last word or two.

**Shape and depth.** Hero containers `rounded-[32px]`, cards `rounded-[24px]`, buttons `rounded-2xl` or `rounded-full`, inputs `rounded-xl`; `rounded-xl` is the smallest structural radius. Every glass panel has blur, a hairline edge and an inner top highlight: `shadow-[0_8px_32px_var(--panel-shadow),inset_0_1px_1px_var(--panel-highlight)]`; modals and dropdowns `shadow-[0_16px_48px_var(--modal-shadow),inset_0_1px_1px_var(--modal-highlight)]` with `backdrop-blur-2xl`. Glass stacked on glass steps up both tint and border (`--white` at `/5` with a `/10` edge under `/[0.08]` with a `/15` edge).

**Components.**

- Card `bg-[var(--white)]/5 backdrop-blur-xl border border-[var(--white)]/10 rounded-[24px] p-8` with the panel shadow.
- Primary button `bg-gradient-to-r from-[var(--violet-deep)] to-[var(--cyan-deep)] text-[var(--white)] px-8 py-4 rounded-2xl shadow-[0_0_20px_var(--violet-glow)]`; secondary `bg-[var(--white)]/10 backdrop-blur-md border border-[var(--white)]/10 rounded-2xl`.
- Inputs `bg-[var(--black)]/20 backdrop-blur-md border border-[var(--white)]/10 rounded-xl px-5 py-4 placeholder:text-[var(--white)]/60`.
- Badges `bg-[var(--white)]/10 backdrop-blur-sm border border-[var(--white)]/10 rounded-full px-3 py-1 text-xs`, or violet-glow `bg-[var(--violet)]/20 border-[var(--violet)]/30`.
- Code blocks and data tables stay solid for legibility.

**Signature moves.**

- The orb backdrop behind everything: two or three asymmetric 600px orbs, violet at 40% top-left, cyan at 30% bottom-right, pink at 20% mid-page. Ambient orbs are large rounded-full circles of an accent color, 400 to 900px, blurred with blur-3xl to blur-[150px] and placed off the corners in one absolute inset-0 layer behind the content; the style sets their colors, count and opacity.
- A floating pill nav: `fixed top-6 left-1/2 -translate-x-1/2 bg-[var(--white)]/5 backdrop-blur-2xl border border-[var(--white)]/10 rounded-full px-8 py-4`.
- Violet or cyan glow rings on calls to action. Glow depth replaces drop shadows with zero-offset colored shadows, shadow-[0_0_<blur>px_<color>], stacked from a tight bright layer to a wide faint one; text glows use drop-shadow-[0_0_<blur>px_<color>].

**Layout.** `max-w-7xl px-6`, sections `py-24`–`py-32`, cards `p-8`–`p-10`, gaps `gap-6`–`gap-8` so the background shows between panels. Layers from back to front: base, orbs, content, elevated cards, floating nav, modals.
