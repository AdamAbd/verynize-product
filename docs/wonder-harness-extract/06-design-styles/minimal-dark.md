<!-- get_design_guidelines {"style": "minimal-dark"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Minimalist Dark

Atmospheric depth from layers of darkness, with warm amber glowing like embers: the visual language of premium dark-mode tools such as Linear, Raycast and Vercel. A perfectly lit room at night, calm and nocturnal, where nothing strains the eyes.

**Palette.**

- Three dark tones carry the depth: `#0A0A0F` ground, `#12121A` raised layers, `#1A1A24` cards. Warmer than pure black.
- Text `#FAFAFA`; secondary text `#A1A1AA`; hierarchy comes from size and weight more than color.
- Borders are 1px white at 8% (`rgba(255,255,255,0.08)`), 15% when emphasized.
- Amber `#F59E0B` is the only color, used sparingly; amber glow `rgba(245,158,11,0.15)`. Cold blues stay out.
- Tokens the examples bind: `--amber` #F59E0B, `--amber-edge` rgba(245,158,11,0.3), `--amber-glow` rgba(245,158,11,0.15), `--amber-glow-strong` rgba(245,158,11,0.25), `--border` rgba(255,255,255,0.08), `--border-strong` rgba(255,255,255,0.15), `--drop-shadow` rgba(0,0,0,0.3), `--glass` rgba(26,26,36,0.6), `--ground` #0A0A0F, `--icon` #A1A1AA, `--text` #FAFAFA.

**Type.** Display `Space Grotesk` at `-0.025em`; body `Inter`; `JetBrains Mono` for code, labels and metadata at `0.025em`. Scale 96, 72, 56, 40 and 32px for headings, 16px body, 12px labels.

**Shape and depth.** Softly rounded: `rounded-lg` (8px) for most elements, 12px cards, 16px hero, `rounded-full` for avatars and pills. Drop shadows are low-opacity black (`0 10px 15px var(--drop-shadow)`); the signature depth is ambient amber light. Glow depth replaces drop shadows with zero-offset colored shadows, shadow-[0_0_<blur>px_<color>], stacked from a tight bright layer to a wide faint one; text glows use drop-shadow-[0_0_<blur>px_<color>]. In amber:

- glows `0 0 20px var(--amber-glow)` to `0 0 60px var(--amber-glow-strong)` behind buttons, hero badges and accent lines;
- a border glow `shadow-[0_0_0_1px_var(--amber-edge),0_0_20px_var(--amber-glow)]` on the featured element.

**Components.**

- Buttons `rounded-lg px-6 py-3`: primary `bg-[var(--amber)] text-[var(--ground)] font-medium`; outline `border border-[var(--border-strong)] text-[var(--text)]`; ghost text only.
- Glass cards `bg-[var(--glass)] backdrop-blur-[8px] border border-[var(--border)] rounded-xl`; the featured pricing card adds an amber border at 20% and the border glow.
- Inputs in the same glass, `rounded-lg h-11`, placeholder `#A1A1AA`.
- Feather icons at 20px in `text-[var(--icon)]`, amber when active.

**Signature moves.**

- Ambient orbs in amber at 2–4% opacity, top-center and bottom-right. Ambient orbs are large rounded-full circles of an accent color, 400 to 900px, blurred with blur-3xl to blur-[150px] and placed off the corners in one absolute inset-0 layer behind the content; the style sets their colors, count and opacity.
- A noise overlay at `opacity-[0.02]` and a faint amber radial from the top (`rgba(245,158,11,0.03)`). A noise overlay is one pointer-events-none absolute inset-0 layer over the whole artboard holding an SVG feTurbulence filter (type="fractalNoise", base frequency about 0.8, 4 octaves); the style sets its opacity and any blend mode.
- Optionally a 40px grid of 2% white lines. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A line grid is a repeating pattern behind the content whose tile is <gap>px square with lines along its top and left edges at the style's weight (1px unless it says otherwise). Parallel lines keep only the top edge, and stripes widen that one line to a band. A diagonal hatch, stripe or crosshatch rotates the tile with patternTransform="rotate(45)".

**Layout.** `max-w-6xl px-6`, sections `py-24`, simple two- or three-column grids at `gap-6`–`gap-8`; items float in space without touching.
