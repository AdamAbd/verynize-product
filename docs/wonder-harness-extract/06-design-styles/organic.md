<!-- get_design_guidelines {"style": "organic"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Organic / Natural

Wabi-sabi made digital: the acceptance of imperfection and transience. There are no straight lines in nature, so everything looks eroded by wind and water or shaped by hand. Moss and clay on unbleached paper; peaceful, handcrafted, rooted and welcoming.

**Palette.** Forest floor, clay and paper.

- Ground `#FDFCF8` rice paper; cards `#FEFEFA`; borders `#DED8CF` raw timber.
- Text `#2C2C24` deep loam; secondary text `#606056`.
- Moss `#5D7052` for buttons, links and accents, with `#F3F4F1` text on it; terracotta `#C18C5D` as the second accent; sand `#E6DCCD` and stone `#F0EBE5` for quiet backgrounds; errors `#A85448`.
- Sections alternate rice paper, stone at 30%, sand at 30%, solid moss and solid terracotta.
- Tokens the examples bind: `--card` #FEFEFA, `--clay-shadow` rgba(193,140,93,0.2), `--moss` #5D7052, `--moss-shadow` rgba(93,112,82,0.15), `--on-moss` #F3F4F1, `--terracotta` #C18C5D, `--timber` #DED8CF, `--white` #FFFFFF.

**Type.** Headings `Fraunces` 600–800 (old-style warmth); body `Nunito` or `Quicksand` with rounded terminals. A moderate 1.25 scale with generous line height.

**Shape and depth.** Cards `rounded-[2rem]`, other containers `rounded-2xl`–`rounded-3xl`, buttons and inputs full pills. Feature cards vary their corners so a row never looks stamped out: `rounded-tl-[4rem] rounded-tr-[2rem] rounded-br-[2rem] rounded-bl-[2rem]`, then the large corner moves to another position (up to `5rem`) on the next card. Images take blob masks: four unequal corner radii such as `rounded-[30%_70%_70%_30%]`, one radius per corner. Shadows are tinted with moss or clay: `shadow-[0_4px_20px_-2px_var(--moss-shadow)]`, floating `shadow-[0_10px_40px_-10px_var(--clay-shadow)]`.

**Components.**

- Buttons `rounded-full h-12 px-8`–`px-10`: primary `bg-[var(--moss)] text-[var(--on-moss)] font-bold` with the moss shadow; outline `border-2 border-[var(--terracotta)] text-[var(--terracotta)]`; ghost `text-[var(--moss)]`.
- Cards `rounded-[2rem] border border-[var(--timber)]/50 bg-[var(--card)] p-8` with the moss shadow.
- Inputs `h-12 rounded-full border border-[var(--timber)] bg-[var(--white)]/50 px-5 text-sm`, letting the grain show through.
- A sticky frosted pill nav: `rounded-full border border-[var(--timber)]/50 bg-[var(--white)]/70 px-6 py-3 backdrop-blur-md` with a round moss logo mark.
- Icons in moss (leaf, sprout) inside `h-14 w-14 rounded-2xl bg-[var(--moss)]/10` wells.

**Signature moves.**

- A paper grain over the page with `mix-blend-multiply` at `opacity-[0.03]`–`opacity-[0.05]`. A noise overlay is one pointer-events-none absolute inset-0 layer over the whole artboard holding an SVG feTurbulence filter (type="fractalNoise", base frequency about 0.8, 4 octaves); the style sets its opacity and any blend mode.
- Blurred blobs behind sections, about 300px, moss at 20% and terracotta at 15%. Ambient orbs are large rounded-full circles of an accent color, 400 to 900px, blurred with blur-3xl to blur-[150px] and placed off the corners in one absolute inset-0 layer behind the content; the style sets their colors, count and opacity.
- Product photos in hand-placed frames: `-rotate-2 border-4 border-[var(--white)]` with the clay shadow.
- How-it-works steps joined by curved, dashed, hand-drawn-looking SVG paths.

**Layout.** Container widths vary by section for rhythm (`max-w-7xl` main, `max-w-5xl` intimate, `max-w-4xl` text); sections `py-32`; grids of two to four columns at `gap-8`–`gap-12`, staggered.
