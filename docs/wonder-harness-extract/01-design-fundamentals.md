# Design Fundamentals

These fundamentals describe what a good design looks like in any style: they decide structure, readability and content, and fill whatever a named style leaves open. A loaded style's own treatments win over these defaults wherever they differ: its palette and grounds, type, textures and gradients, hero art, numbering and labels, layout spine, shadows, charts, and how much boldness it spreads. Readability never yields: contrast, legible sizes and realistic content hold in every style. A style's palette ends with the tokens its examples bind and their values. When two options seem equal, pick the one with less clutter, more space and a clearer hierarchy.

## Direction

Decide first whether the design should **impress** (a brand moment, a portfolio piece, an exploration of directions) or **present clearly** (a product surface, a dashboard, a settings screen); the two succeed differently and should not look like siblings.

- Product and app surfaces lean on clarity: restraint, and information on surfaces rather than in decoration.
- A brief that signals personality (fun, bold, or a category that runs on character: games, food, kids, creator tools, events) starts playful, with one or two fitting moves: a few accents working together, tilted sticker elements, offset hard shadows, hand-drawn marks, a characterful wordmark, quippy copy. Luxury, healthcare, finance and legal briefs stay restrained.
- A short, vague request on an empty canvas gets one design executed exceptionally rather than several done adequately, and an offer to adjust.

**Hierarchy.** Each section has one focal element, built from size, weight and color together, and one fully saturated primary action; no two equal calls to action compete. A section reads in three levels, dominant (heading or hero visual), supporting (body) and tertiary (caption, label, metadata), and its other actions are outlined or ghost. Across the artboard, concentrate boldness in one signature element (an oversized headline, one dramatic image, one block of color) and keep the rest calm around it.

**Composition.**

- The first viewport is one composition: the brand, one headline, one supporting line, one primary action and one dominant visual; stats, logo clouds and badges live below. Without the nav, the hero still clearly belongs to this brand.
- Each section has one job, one headline and one takeaway; a section doing two jobs becomes two.
- Vary the layout family down a page (card grid, full-bleed feature, split text and image, quote or stat band, zigzag rows, in pairs at most).
- Structure tells the truth: cards hold things people act on or choose (a product, a plan, a file), numbered markers appear only for a real sequence, and a heading and paragraph sit directly on the section, unless the style makes its cards or its numbering the signature.
- Eyebrow overlines go on the hero and one or two anchors. Siblings (pricing tiers, product tiles, list rows) share one treatment and align their actions; only the one item a brief or style features stands out, and it keeps the same structure.

## Layout

**Choose the display by the content's shape, then size it.**

- One direction with alignment (a row, a column, a stack): `flex` with `items-*`, `justify-*` and `gap-[Npx]`.
- A two-dimensional field whose items share tracks (card grids, pricing tiers, galleries, bento, dashboards): `grid grid-cols-3 gap-[24px]` or a track list like `grid-cols-[240px_1fr_1fr]`, with `col-span-N` where an item spans. A grid keeps a short last row aligned; wrapped flex cannot.
- Children that simply stack full-width (an article body): `block`; a box inside a line of text (a badge, a counter): `inline-flex`.

**Sizing.** Size each container by what it holds: content that can grow (text, lists, card bodies, sections) takes h-fit or no height; a floor that may grow takes min-h-[Npx]; the space left by siblings takes flex-1 inside a flex flex-col parent; fixed h-[Npx] and w-[Npx] are for intrinsic pieces only (icons, avatars, a navbar bar, a fixed sidebar, a fixed-crop image, a 1px divider leaf) and the root of a fixed format such as a slide or poster, never for any other layout container. Widths fill with w-full or flex-1, and fixed pieces beside a flex-1 sibling take shrink-0. For example, `min-h-[480px]` on a hero still fits a three-line headline, icons take `w-[24px] h-[24px]` and a navbar `h-[64px]`, and a relative size with an offset is `w-[calc(100%-20px)]` (not on an artboard root).

**Rows and alignment.** A row of content is a flex row (flex flex-row items-center gap-[Npx]), as the source code would write it; absolute positioning is only for real overlap, such as a notification dot, a badge over an avatar or a shape behind text. An avatar beside a name and handle is `flex flex-row items-center gap-[12px]`. Sibling cards are `flex flex-col` with the action pinned by `mt-auto` and a `min-h-[Npx]` title block, so their lists and buttons line up.

**Mobile screens.** A full mobile screen designed from scratch opens with the phone status bar as the root's first child: a `h-[54px] px-[24px]` row, `9:41` in 17px semibold system type on the left, signal, Wi-Fi and battery glyphs on the right, white on dark grounds and black on light. Components, sheets, screens reproduced from code and full-screen media have none.

## Spacing and detail

Hold one spacing rhythm per artboard: consistent page-edge and card padding across similar containers, and sections separated by section padding, not inner margins. Pick it by the surface:

- **Generous** for premium marketing and editorial pages: sections `py-20`–`py-32`, gaps `gap-8`–`gap-12`, cards `p-10`–`p-12`.
- **Balanced** for most landing pages and content: sections `py-12`–`py-16`, gaps `gap-6`, cards `p-6`–`p-8`.
- **Tight** for dashboards, settings and dense data: sections `py-6`–`py-10`, gaps `gap-3`–`gap-4`, cards `p-4`–`p-5`.

**Finish.** Shadows are soft and layered (ambient plus directional, 5–15% opacity). Every shadow and highlight on an artboard shares one light direction. Nested radii are concentric: a child inside a padded parent takes the smaller radius. For example, inside a padded `rounded-2xl` parent a child takes `rounded-xl`. Align icons and text optically, by eye.

## Typography

- Choose a distinctive family that suits the style; generic defaults (Inter, Roboto, Arial, system-ui) are for styles that name them, since a default font looks templated fastest.
- Three type tiers per section, running text in a measure of about 60 to 70 characters, and nothing at 12px or below outside dense data or deliberate uppercase labels. The tiers are display or heading, body, and caption or label, with sizes taken from the style.
- Display sizes tighten (`tracking-tight`, `tracking-tighter` at hero scale); small uppercase labels open up (`tracking-wide`–`tracking-widest`).
- Line height about 1.1–1.25 on display, 1.5–1.6 on body, 1.3–1.4 on compact UI labels.
- Running text takes `max-w-xl`–`max-w-2xl`; wide columns are for headings, hero copy and grids.
- Body copy keeps one weight (regular or medium), with bold for real emphasis.
- Body is 16px or larger on marketing, editorial and reading surfaces and 14px on product and dashboard surfaces; captions and metadata 13–14px.

## Color

**Derive the palette from a scene, not a color wheel.** Choose a mood that names a physical condition (sun-bleached, inky, mineral, maritime, bookish, candlelit, alpine, nocturnal, gallery, signage, phosphor) and name the object behind each color role: "mineral" gives limestone for the ground, slate for text, verdigris for the accent. Weigh your first idea against a few candidates and keep it when it fits this brand rather than being the category default (fintech navy, wellness sage, AI violet gradient); fit still wins, so a bank does not turn tropical to avoid navy.

Ground × accent pairings from one scene, to interpret: bone × verdigris, fog gray × deep navy, concrete × safety orange, plaster × ink, warm amber × oxblood, snow × evergreen, wet asphalt × hot pink, CRT black × phosphor green, ink × chrome yellow, pure white × cadmium red, cobalt, hyperlink blue or pure black.

- Lead with one dominant hue and one sharp accent, spent on function. The accent marks the primary action and a key signal. Secondary accents (categories, states, chart series, playful brands) come from the same scene at conservative saturation and replace other decoration.
- **Neutrals.** Pure white `#FFFFFF` is the everyday ground for product, documentation, marketing and light-mode apps; cream and ivory belong to specific moods (candlelit, bookish). Grays come from the scene or stay truly neutral (`#888888`). Pure black suits high-chroma accents and inky moods; other darks lean toward the mood.
- On a tinted ground, borders, secondary text and shadows take a shade of its hue, not gray. A tint scale stays one hue at every step, and a multi-hue set is balanced by perceived vividness (saturated yellow reads brighter than blue).
- Depth comes from alternating sections (a tinted band, an inverted section, an image hero). Gradients, blobs and grain belong to scenes that have them (phosphor, neon); a pure-white ground is finished as it is.
- Skip palettes that read as generated: washed pastels, purple on white, purple-blue gradients, warm off-white with terracotta, red or neon, navy or charcoal with electric purple, lime or teal, earth tones on pure white, and a saturated accent on a tinted warm ground.
- Hero and anchor imagery is real photography of the product, its context or atmosphere: an Unsplash photo (an img from images.unsplash.com, or a bg-[url(…)]) or a generate_image image; a flat placeholder reads as a missing asset.
- Images keep their proportions and focal point, and a grid of images shares one ratio.

**Design tokens.** The file's tokens (the opening context lists them) are its palette and type, and the palette you choose becomes tokens named for their roles. Colour: a file token's cssVar, created first if none holds the value; a literal or palette class only if the user asks. Other values a token holds use its cssVar too. Check the file's tokens and icon catalog before adding to them, and reuse a match by value and by role instead of adding a near-duplicate or a literal beside it. Rename or delete tokens and icons only when the user asks, and add an icon only when the user asks or a design built from their code needs it. A design built from the user's code brings in the repo's own tokens and repo-owned icons it needs, with their exact values and markup, before drawing and without a separate ask.

Icons: the file's library (import { X } from 'wonder-icons'), else react-icons, imported at the top; never emoji. Icons come from one set with one stroke weight and fill convention, sized to their text and equal across siblings.

## Contrast

Everything reads at a glance, without squinting.

- Text, button labels and secondary text included, reaches at least 4.5:1 against what it sits on in every style; below 16px it goes higher, and icons, SVGs and shapes stand off their surface as clearly. Reduced opacity and muted color are for a few elements, not everything that is not a heading.
- Secondary text is `#5a5a5a` or darker on light grounds and correspondingly light on dark ones.
- A dark icon on a dark surface or a white icon on white disappears, which counts as a defect, not polish.

## Content

- **Realistic.** Content is realistic and specific: plausible names, prices and figures, varied and slightly organic rather than round, with no lorem ipsum or invented precision; a design tool shown as an example is Wonder unless the brief names one. For example "Maya Reinhardt", "$24/mo", "2.4M users in 47 countries" and 47.2%.
- **Typeset.** A real ellipsis (…), curly quotes and apostrophes, an em dash for breaks, and a non-breaking space between a value and its unit (10 MB).
- **Short.** Headings of three to eight words, supporting text of one or two sentences, buttons of one to three specific words ("Save API key", not "Continue"), one label per action everywhere. Each idea is said once; most marketing drafts improve when a third of the copy goes.
- **Shaped by the surface.** Marketing runs hero, imagery, product detail, social proof, final call to action. A dashboard runs orientation, status, action, denser.
- **Unhappy paths.** On product surfaces with user data, empty, error and permission-denied states are real compositions: an icon, a heading, a line, a next action ("No projects yet — create your first to get started").
- **Specific microcopy.** "Loading your dashboard…"; "Delete 'Project Alpha'? This can't be undone." with "Delete project" and "Keep editing"; "Email needs an @ symbol — try name@example.com".
- **Long lists.** Past about five items, use labeled groups, a card grid or a featured few, with dividers at group boundaries only.
- **Charts.** Data reads first: quiet gridlines, units on axes, direct labels on small series, bars rather than a pie past about five categories.
