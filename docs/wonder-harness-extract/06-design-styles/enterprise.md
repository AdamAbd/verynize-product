<!-- get_design_guidelines {"style": "enterprise"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Corporate Trust

Modern enterprise SaaS that feels approachable rather than cold, in the manner of the tech unicorns that humanized corporate software. Credibility from clean structure and crisp type; energy from indigo-to-violet gradients, color-tinted shadows and isometric depth.

**Palette.** Indigo, violet and slate.

- Ground `#F8FAFC`; cards `#FFFFFF`; borders `#E2E8F0`, or `#F1F5F9` for the softest.
- Text `#0F172A`; secondary text `#64748B`.
- Primary `#4F46E5` indigo, secondary `#7C3AED` violet; success `#10B981`.
- Gradients: `from-[var(--primary)] to-[var(--secondary)]` for buttons and headline text, `from-[var(--primary-soft)] to-[var(--secondary-soft)]` for soft fills, `from-[var(--primary-deep)] to-[var(--primary-deepest)]` for the dark final CTA section.
- Tokens the examples bind: `--badge-glow` rgba(79,70,229,0.5), `--border` #E2E8F0, `--border-soft` #F1F5F9, `--button-shadow` rgba(79,70,229,0.3), `--card-shadow` rgba(79,70,229,0.1), `--card-shadow-strong` rgba(79,70,229,0.15), `--label` #334155, `--primary` #4F46E5, `--primary-deep` #312E81, `--primary-deepest` #1E1B4B, `--primary-soft` #E0E7FF, `--primary-wash` #EEF2FF, `--secondary` #7C3AED, `--secondary-soft` #EDE9FE, `--white` #FFFFFF.

**Type.** `Plus Jakarta Sans` on a 1.25 scale: hero 800, section headings 700, card titles 600, body 400, navigation and labels 500. Headlines `leading-[1.1] tracking-tight`, body `leading-relaxed`. Split headlines: the first words in slate, the rest in a `from-[var(--primary)] to-[var(--secondary)]` gradient. Gradient text is bg-gradient-to-r from-<a> to-<b> bg-clip-text text-transparent on display-size words only (text-5xl and up), most often the headline's last word or two.

**Shape and depth.** Cards `rounded-xl`, inputs `rounded-lg`, buttons `rounded-full` or `rounded-lg`. Shadows are tinted indigo rather than gray:

- Card `shadow-[0_4px_20px_-2px_var(--card-shadow)]`; emphasized card `shadow-[0_10px_25px_-5px_var(--card-shadow-strong),0_8px_10px_-6px_var(--card-shadow)]` with `-translate-y-1`.
- Primary button `shadow-[0_4px_14px_0_var(--button-shadow)]`; numbered badges glow `shadow-[0_0_20px_var(--badge-glow)]`.

**Components.** Primary button `bg-gradient-to-r from-[var(--primary)] to-[var(--secondary)] text-[var(--white)] rounded-full` with the button shadow; secondary `bg-[var(--white)] border border-[var(--border)] text-[var(--label)] rounded-lg`. Cards `bg-[var(--white)] rounded-xl border border-[var(--border-soft)]` with the card shadow; feature icons in `h-12 w-12 rounded-xl bg-[var(--primary-wash)] text-[var(--primary)]` wells. Inputs `bg-[var(--white)] border border-[var(--border)] rounded-lg` with `text-sm font-semibold text-[var(--label)]` labels. A NEW badge in solid indigo inside a gradient ring.

**Signature moves.**

- Isometric depth: a `perspective-[2000px]` parent with `rotate-x-[5deg] rotate-y-[-12deg]` on the hero card; feature cards alternate `rotate-y-[6deg]` and `rotate-y-[-6deg]`.
- Atmospheric orbs of 400–600px at 20–50% opacity, layered at different depths behind sections. Ambient orbs are large rounded-full circles of an accent color, 400 to 900px, blurred with blur-3xl to blur-[150px] and placed off the corners in one absolute inset-0 layer behind the content; the style sets their colors, count and opacity.
- The center pricing card at `scale-105` with a ring.

**Layout.** `max-w-7xl px-6`, sections `py-16`–`py-24`. Two-column hero with text first, features as alternating zig-zag rows, three-column pricing, four-column stats.
