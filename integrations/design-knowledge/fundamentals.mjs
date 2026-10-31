// Design fundamentals returned with every design-context call. Written for Verynize; keep it
// short enough to read on every turn (~1,500 words) and concrete enough to act on.

export const fundamentals = `# Design fundamentals

Defaults for structure, readability and content in any look. **Layering:** a chosen style (get_design_guidelines with \`style\`) overrides them where they disagree: palette, grounds, fonts, texture, hero art, numbering, shadows, charts, loudness. Contrast, legible sizes and realistic content never yield. When two options feel equal, take less clutter, more air and clearer hierarchy. Break other rules only on purpose, and say why.

## 1. Direction
Write a three-line brief before any JSX: **job** (impress or present clearly), **audience**, **density**.
- **Impress** (launch, portfolio, campaign): one bold idea, big type, real imagery, room to breathe. Games, food, kids or events may go playful; finance, health, legal and luxury stay restrained.
- **Present clearly** (app, dashboard, settings): calm surfaces, strict alignment, color for meaning.
- One style, or the file's existing system, per screen. A vague request on an empty canvas gets one excellent design, not several average ones.

## 2. Hierarchy and composition
- One focal point and one filled accent primary action per section; others are outline or ghost. Three emphasis levels: dominant, supporting, tertiary meta. Contrast comes from size and weight first, color second.
- Spend boldness once per artboard (one huge headline, image or color block); keep the rest calm.
- **First viewport** is a single composition: brand, one headline, one supporting line, one primary action, one dominant visual. Stats, logo rows and badges go further down.
- **One job per section:** one headline, one takeaway. If it does two jobs, split it.
- **Vary layout families** down a page (split, card grid, full-bleed feature, stat band, alternating rows); never one family three times running.
- **Structure tells the truth:** cards only for things people pick or act on (a plan, a file, a product); numbered markers only for a real sequence; plain heading and paragraph sit straight on the section. A style may make cards or numbers its signature.
- **Siblings match:** tiers, tiles and rows share one treatment with aligned actions; a featured item keeps the same structure.

## 3. Layout and sizing
- Pick display by content shape: one direction (row, column, stack) → \`flex\` with \`items-*\`, \`justify-*\`, \`gap-*\`; items sharing tracks (cards, pricing, gallery, bento, dashboard) → \`grid grid-cols-N\` or a track list, with \`col-span-*\`; full-width stacked prose → \`block\`; a chip inside text → \`inline-flex\`.
- Size by what a box holds. Growing content (text, lists, sections, card bodies) hugs: \`h-fit\` or no height. A floor that may grow: \`min-h-*\`. Leftover space: \`flex-1\` in a flex parent. Fixed \`h-*\`/\`w-*\` only for intrinsic pieces: icons, avatars, a nav bar, a fixed sidebar, a cropped image, a divider, or the root of a fixed format such as a slide. Pieces beside a \`flex-1\` sibling get \`shrink-0\`.
- \`absolute\` only for real overlap (a badge on an avatar). Sibling cards are \`flex flex-col\` with the action pushed down by \`mt-auto\`.
- 4px grid; one left edge per column; center only short content. Viewports: desktop 1440×900, mobile 390×844, slide 1920×1080.
- **Mobile status bar:** a full mobile screen built from scratch starts with a status bar as the root's first child: an \`h-[54px] px-6\` flex row, the time "9:41" in 17px semibold on the left, signal, wifi and battery icons on the right, colored for the ground. Components, sheets and screens reproduced from code skip it.

## 4. Spacing rhythm
One rhythm per artboard, chosen by surface; similar containers share padding:
- **Generous** (premium marketing, editorial): sections \`py-24\`–\`py-32\`, gaps \`gap-10\`–\`gap-12\`, cards \`p-10\`.
- **Balanced** (most landing and content pages): sections \`py-14\`–\`py-20\`, gaps \`gap-6\`–\`gap-8\`, cards \`p-6\`–\`p-8\`.
- **Tight** (dashboards, settings, dense data): sections \`py-6\`–\`py-10\`, gaps \`gap-3\`–\`gap-4\`, cards \`p-4\`.
Inside components \`gap-1\`–\`gap-2\`. Space between groups is at least 2× the space within. Sections separate by their own padding, not child margins.

## 5. Typography
- Distinctive families that fit the style, via \`font-['Family_Name']\`. Inter, Roboto, Arial and system-ui only when the style, brief or repo names them. Two families plus optional mono; two or three weights; bold only for real emphasis.
- Three tiers per section: heading, body, caption. Scale ratio about 1.2 in apps, 1.25–1.333 in marketing. Body 16px+ on marketing and reading surfaces, 14px in product UI, meta 12–13px; nothing smaller outside dense data or uppercase labels.
- Measure 45–75 characters: cap prose with \`max-w-prose\` or \`max-w-xl\`. Line height: display 1.0–1.15, body 1.5–1.6, compact labels 1.3–1.4.
- Display 40px+ gets \`tracking-tight\`, small caps labels \`tracking-wider\`; stats \`tabular-nums\`, headlines \`text-balance\`.

## 6. Color
- **Start from a scene, not a wheel.** Name a physical condition (sun-bleached, mineral, harbor at night, reading room, workshop) and the object behind each role, e.g. "quarry": pale limestone ground, graphite text, oxidized copper accent. Keep the first idea only if it fits this brand rather than its category default (fintech navy, wellness sage); fit still beats novelty.
- Roles: background, surface, surfaceAlt, foreground, muted, border, accent, accentForeground, success, warning, danger, info. One dominant hue and one sharp accent, spent on actions and key signals. Extra hues (categories, chart series) come from the same scene at modest saturation.
- About 90% neutrals. Plain white is the normal ground for product and docs; tinted grounds suit specific moods. On a tinted ground, borders, muted text and shadows take that hue, not grey. Dark mode is a hued near-black (#0d1014), lighter surfaces instead of shadows, accent desaturated 10–20%.
- Depth comes from alternating sections (tinted band, inverted block, image hero); grain and gradients only where the scene has them.
- **Avoid palettes that look generated:** purple-to-blue or pink-to-purple gradients, purple on white, washed pastels, cream or beige with terracotta or sage, navy or charcoal with electric violet, lime or teal, neon glow on black, gradient body text. Use one only if the brief asks by name.
- **Tokens: reuse before you add.** Read get_design_tokens first; reuse a token that matches by value and role instead of adding a near-duplicate or a literal beside it. New palette values become role-named tokens (create_design_tokens or apply_style_tokens) used as \`bg-[var(--color-…)]\`. Rename or delete tokens only when asked.

## 7. Elevation and shape
- One light source from above. Shadows are layered and low-alpha (contact plus ambient, 4–12%), never one hard dark shadow. Three levels at most: flat, raised, overlay.
- Radii are concentric: inner radius = outer radius − padding (\`rounded-2xl\` with \`p-2\` holds \`rounded-lg\`). One radius family per design. Prefer a 1px border or fill difference over a shadow on flat UI.

## 8. Contrast
- Text, labels and buttons included, reaches 4.5:1 against its real backdrop; aim higher below 16px. Large text (24px+) at least 3:1. Muted grey on light grounds is #5a5a5a or darker. Check muted text on surfaceAlt too.
- Icons and shapes stand off their surface; a dark icon on a dark card is a defect. Reduced opacity is for a few elements only.
- Text on images needs a scrim. Touch targets 44×44 on mobile. Status never by color alone.

## 9. Content
- **Realistic:** real copy for this product; no lorem ipsum, "Title" or "Button". Uneven numbers ($48,210.37, 3.7%), names from several cultures, no invented logos, awards or user counts.
- **Typeset:** curly quotes “ ” and ’, en dash for ranges (9–5), em dash for breaks, ellipsis …, non-breaking units (12 GB).
- **Short:** headings three to eight words, support text one or two sentences, buttons one to three specific words ("Save API key", not "Continue"). Say each idea once; most drafts improve by cutting a third.
- **Microcopy** names the thing: "Loading your invoices…"; "Delete ‘Q3 report’? This can’t be undone." with "Delete report" / "Keep it".
- **Long lists** (over ~5 items) get labeled groups, a grid or a featured few.
- **Charts:** data first, quiet gridlines, units on axes, direct labels on short series, bars instead of a pie past five categories.

## 10. States
- **Unhappy paths** are designed, not skipped: empty, loading, error and no-permission states each get an icon, a heading, one line and a next action.
- Interactive parts show default, hover or focus, disabled and selected; focus rings are visible. Forms show helper text and inline errors.

## 11. Icons
- One set (lucide, ph or tabler) from get_icons, one stroke weight, sized to the text: \`<Icon name="lucide:arrow-right" className="size-5 text-…" />\`. Icons support labels rather than replace them, except universal actions. Never use emoji as icons or bullets.

## 12. Imagery
- Art-direct each image: role, subject, viewpoint, light, crop, quiet area for text. Find photos with search_images; a hero is one stage, not text beside a floating photo card. Images keep proportions; a grid shares one ratio.
- With no fitting photo, degrade with intent: a \`<Shader>\` fill, a gradient in the palette, a large typographic crop or shapes in the accent. Never a grey box labelled "Image".

## 13. The reduction pass
Ask of every element: what gets worse without it? If nothing, delete it.
- No card inside a card; a tinted section needs no bordered card too.
- No decorative dividers, badges or icons that repeat the text. One heading per idea; drop subtitles that restate it.
- No wrapper without padding, background, border or layout role.

## 14. Verify
Screenshot after every section and trust the image over your intent: clipping, overflow, overlap, placeholders, contrast, alignment. Run the design-review skill before finish_artboard.
`;
