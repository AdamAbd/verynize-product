<!-- get_design_guidelines {"style": "retro"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Retro / 90s Nostalgia

The early web, unfiltered: GeoCities pages, "Under Construction" banners, hit counters and Windows 95 chrome, crafted as if in 1997. Playful, chaotic, loud and deliberately anti-modern; the ugliness is the beauty, so lean into the cheese rather than modernizing it.

**Palette.** Opaque colors at full saturation (each channel at 0 or 255), no transparency.

- Page `#C0C0C0` silver with a fine `var(--crosshatch)` crosshatch every 4px, never flat. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. A line grid is a repeating pattern behind the content whose tile is <gap>px square with lines along its top and left edges at the style's weight (1px unless it says otherwise). Parallel lines keep only the top edge, and stripes widen that one line to a band. A diagonal hatch, stripe or crosshatch rotates the tile with patternTransform="rotate(45)".
- Text `#000000`; metadata `#404040`; content panels `#FFFFFF` or notepad `#FFFFCC`; table rows alternate `#FFFFFF` and `#E8E8E8`.
- Links always underlined: blue `#0000FF`, visited `#800080`, hover `#FF0000`.
- Red `#FF0000` for NEW! tags, yellow `#FFFF00` for badges and stripes, green `#00AA00` for success, navy `#000080` title bars (gradient to `#1084D0`) and selection.
- Tokens the examples bind: `--bevel-dark` #404040, `--bevel-light` #DFDFDF, `--black` #000000, `--blue` #0000FF, `--blue-light` #5555FF, `--counter-green` #00FF00, `--crosshatch` #B8B8B8, `--gray` #808080, `--green` #00AA00, `--navy` #000080, `--purple` #800080, `--red` #FF0000, `--title-blue` #1084D0, `--white` #FFFFFF, `--yellow` #FFFF00.

**Type.** Body `MS Sans Serif`, `Tahoma`, `Verdana` at 14–16px; headings `Arial Black` or `Impact`, hero 48–96px with a hard `[text-shadow:2px_2px_0_var(--gray)]`; dates, counters and code in `Courier New`; Comic Sans for the rare decorative accent. Bold or black weights, dense line heights (1.2–1.4 headings).

**Shape and depth.** Square corners. Everything interactive, and most containers, is bevelled with four-color borders plus inset shadows:

- raised: `border-2 [border-color:var(--white)_var(--gray)_var(--gray)_var(--white)] [box-shadow:inset_-1px_-1px_0_var(--bevel-dark),inset_1px_1px_0_var(--bevel-light)]`;
- sunken: `border-2 [border-color:var(--gray)_var(--white)_var(--white)_var(--gray)] [box-shadow:inset_1px_1px_0_var(--bevel-dark),inset_-1px_-1px_0_var(--bevel-light)]`.

Gradients appear only in title bars.

**Components.**

- Buttons `font-bold uppercase tracking-wide py-2 px-4` with the raised bevel: silver default; blue `bg-[var(--blue)] text-[var(--white)] [border-color:var(--blue-light)_var(--navy)_var(--navy)_var(--blue-light)]`; red and green use the same pattern with their light and dark tones and `text-[var(--black)]`.
- Window panels: a raised silver frame, a `bg-[linear-gradient(to_right,var(--navy),var(--title-blue))]` title bar in bold white, a sunken white or `#ffffcc` content area with `p-4`.
- Inputs sunken, white, `px-2 py-1`.
- Icons in solid navy, teal or green squares with a bevel.

**Signature moves.**

- A scrolling marquee of announcements in mixed colors (decorative, never essential).
- Rainbow gradient text on accent headlines, `from-[var(--red)] via-[var(--yellow)] via-[var(--green)] via-[var(--blue)] to-[var(--purple)]`. Gradient text is bg-gradient-to-r from-<a> to-<b> bg-clip-text text-transparent on display-size words only (text-5xl and up), most often the headline's last word or two.
- "NEW!" and "HOT!" badges; a hit counter in `text-[var(--counter-green)] font-mono` on black or navy ("Visitors: 0001234").
- A construction-stripe section of 10px yellow and black diagonal bands for the final call to action.
- Groove rules (`#808080` over `#ffffff`) between sections; grids of bevelled primary-color squares as pure decoration.

**Layout.** Dense and compact like an 800×600 screen: `max-w-5xl`, 8px base, sections `py-16 px-4`, table-like grids with visible cell borders and equal columns. Decorative copy stays generic or 90s-themed.
