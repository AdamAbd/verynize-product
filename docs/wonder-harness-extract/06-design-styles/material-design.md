<!-- get_design_guidelines {"style": "material-design"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Material You

Material You (Material Design 3): an organic, expressive system where tonal palettes from one seed color replace stark white, blurred organic shapes replace flat geometry, and pill buttons define the silhouette. Friendly, soft, colorful and personal.

**Palette.** Tonal, from the violet seed `#6750A4`; generous color rather than accent highlights.

- Surface `#FFFBFE` (the ground; tinted, not pure white); cards `#F3EDF7`; inputs and recessed areas `#E7E0EC`. Depth steps through these surfaces, and the steps are visible.
- Text `#1C1B1F`; secondary text and icons `#49454F`; outlines `#79747E`, used sparingly.
- Primary `#6750A4`; secondary container `#E8DEF8` with text `#1D192B` for chips and tonal buttons; tertiary `#7D5260` for the FAB and accents.
- States are opacity layers of the same color (`bg-[var(--primary)]/90`, `/10`); on colored backgrounds, white or black overlays.
- Tokens the examples bind: `--on-primary` #FFFFFF, `--on-secondary-container` #1D192B, `--outline` #79747E, `--primary` #6750A4, `--secondary-container` #E8DEF8, `--surface-container` #F3EDF7, `--surface-variant` #E7E0EC, `--tertiary` #7D5260.

**Type.** `Roboto`: 400 body, 500 headings, 700 bold. Display 56px, headline 48px, title 24px, body 16px, label 12px. Headings at 0 to -0.01em; display line height 1.2–1.3.

**Shape and depth.** Buttons, chips and badges `rounded-full`; cards `rounded-[24px]`; cards nested inside them `rounded-[16px]` and featured cards `rounded-[32px]`; hero containers `rounded-[48px]`. The filled text field has a rounded top and square bottom. Containers separate by tone rather than borders. Elevation is soft: tone alone at level 0, `shadow-sm` cards, `shadow-md` important containers, `shadow-lg` for the FAB.

**Components.**

- Buttons `rounded-full`, `h-10 px-6`: filled `bg-[var(--primary)] text-[var(--on-primary)]`, tonal `bg-[var(--secondary-container)] text-[var(--on-secondary-container)]`, outlined `border border-[var(--outline)] text-[var(--primary)]`, text `text-[var(--primary)]`.
- FAB `bg-[var(--tertiary)] text-[var(--on-primary)] rounded-2xl shadow-md h-14 w-14`.
- Cards `bg-[var(--surface-container)] rounded-[24px] shadow-sm p-6`–`p-8`, borderless.
- Filled text field `h-14 bg-[var(--surface-variant)] rounded-t-lg border-b-2 border-[var(--outline)]`.
- On colored containers, glass panels `bg-[var(--on-primary)]/10 backdrop-blur-sm border border-[var(--on-primary)]/10`.

**Signature moves.**

- Organic blur shapes: large `rounded-[100px]` rectangles or circles in primary, secondary and tertiary at 10–30% opacity, often `mix-blend-multiply`. Ambient orbs are large rounded-full circles of an accent color, 400 to 900px, blurred with blur-3xl to blur-[150px] and placed off the corners in one absolute inset-0 layer behind the content; the style sets their colors, count and opacity.
- Radial washes such as `bg-[radial-gradient(circle_at_top_right,var(--secondary-container)_0%,transparent_40%)]`.
- A featured item lifts with `-translate-y-4` and `ring-2 ring-[var(--primary)]`.

**Layout.** `grid-cols-3 gap-6`–`gap-8`, 4px base unit, sections `py-12`–`py-24`, alternating tonal and default backgrounds; full-width primary or tertiary containers for emphasis now and then. Layers: surface, blur shapes, surface container, content.
