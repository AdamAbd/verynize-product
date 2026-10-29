// Design fundamentals returned with every design-context call. Written for Better Design; keep it
// short enough to read on every turn (~1,300 words) and concrete enough to act on.

export const fundamentals = `# Design fundamentals

Read this before you draw. Each rule is a default. Break one only on purpose, and say why in your summary.

## 1. Decide the direction first
Before any JSX, write a three-line brief: **job** (impress or present clearly), **audience**, **density** (airy, comfortable, compact).
- **Impress** (landing, launch, portfolio, campaign): one bold idea per screen, big type, real imagery, generous space.
- **Present clearly** (app, dashboard, settings, docs): calm surfaces, strong alignment, compact rhythm, color only for meaning.
- Then pick one archetype (get_design_guidelines with \`style\`) or the existing system in the file. Never mix two archetypes on one screen.

## 2. Hierarchy
- One focal point per section. If two things shout, demote one.
- One primary action per section. It is the only filled, accent-colored button. Secondary actions are outline or ghost.
- Use exactly three emphasis levels: **primary** (foreground, heavier weight, bigger), **secondary** (muted color), **tertiary** (smaller and muted, for meta like dates and counts).
- Build contrast with size and weight first, color second. Heading-to-body size ratio is at least 1.5× in apps and 2.5× or more in marketing heroes.

## 3. Layout
- Choose flow by content shape: a row or column of things → \`flex\` with \`gap\`; a matrix of peers → \`grid grid-cols-N gap-*\`; a stack of prose → block flow.
- Containers hug their content. Do not set heights except for intrinsic things: images, media, avatars, icons, charts, the artboard itself.
- Use \`w-full\`/\`flex-1\` to fill; use \`max-w-*\` to cap line length. Use \`absolute\` only for overlays (badges, floating labels, decorative layers) and say so with explicit \`absolute\` classes.
- Align to a 4px grid. One left edge per column. Center only short, symmetric content (hero statements, empty states).
- Standard viewports: desktop 1440×900+, tablet 834×1194, mobile 390×844, slide 1920×1080.

## 4. Spacing tiers
Pick from three tiers and keep each one consistent.
- **Tight** (inside a component — icon to label, label to input): \`gap-1\` to \`gap-2\` (4–8px).
- **Group** (between related items — fields in a form, cards in a row, stacked paragraphs): \`gap-3\` to \`gap-6\` (12–24px). Card padding \`p-4\` to \`p-6\`.
- **Section** (between unrelated blocks): \`gap-12\` to \`gap-16\` in apps, \`py-20\` to \`py-32\` in marketing pages. Page side padding: \`px-6\` mobile, \`px-10\` to \`px-20\` desktop.
- The space between groups must be visibly larger than the space within them, by at least 2×. Equal spacing everywhere reads as a list of unrelated parts.

## 5. Typography
- Use a modular scale (1.2 for apps, 1.25–1.333 for marketing). App: 12 / 14 / 16 / 20 / 24 / 32. Marketing: 14 / 16 / 20 / 28 / 40 / 56 / 72–96.
- Body text is at least 14px in apps and 16px in marketing. Meta text is never below 12px. Mobile body is 15–17px.
- Line length 45–75 characters: cap prose with \`max-w-[60ch]\` or \`max-w-prose\`.
- Line height: body 1.5–1.65 (\`leading-6\` on 16px), headings 1.05–1.2 (\`leading-tight\`), display 0.95–1.05.
- Tracking: display sizes 40px+ get \`tracking-tight\` (−0.02em) or tighter; body stays 0; all-caps labels get \`tracking-wider\` and 11–12px.
- Fonts: load real families with \`font-['Family_Name']\`. Do not default to Inter, Roboto, Arial or system-ui unless the brief or the repo asks for them. The archetype's fonts are binding.
- Use at most two families plus an optional mono. Use two or three weights, not five.
- Numbers in tables and stats: \`tabular-nums\`. Headlines use \`text-balance\`; avoid single-word last lines.

## 6. Color
- Derive the palette from a concrete concept: a material, a scene, or a brand fact ("oxidised copper and slate", "night ferry deck lights", "hospital-grade white and ink"). Name it in your brief.
- Assign semantic roles: background, surface, surfaceAlt, foreground, muted, border, accent, accentForeground, success, warning, danger, info. Use roles, not raw hex, across the screen; bind repeated values to design tokens.
- One accent, reserved for actions and the current selection. Do not use it for decoration, headings or icons in passing.
- About 90% of the screen is neutrals. Tint neutrals slightly toward the accent's hue instead of using pure grey.
- **Banned defaults (these read as machine-made):** purple-to-blue or pink-to-purple gradients; washed-out pastel rainbows; beige, cream or ivory backgrounds paired with terracotta or sage; neon-on-black "cyber" with glow on everything; teal-and-orange stock pairings; gradient text on body copy. Use one only if the brief asks for it by name.
- Dark mode is not inverted light mode: use a near-black with a hue (#0d1014, not #000), lift surfaces with lighter fills instead of shadows, and drop saturation of the accent by 10–20%.

## 7. Elevation and shape
- One light source, from above. Shadows are layered and low-alpha: a 1px contact shadow plus a soft ambient one, each at 4–12% opacity. Example: \`shadow-[0_1px_2px_rgba(15,23,42,0.06),0_8px_24px_rgba(15,23,42,0.08)]\`. Never a single dark hard shadow.
- Use at most three elevation levels: flat, raised (cards, inputs), overlay (menus, dialogs).
- Radii are concentric: inner radius = outer radius − padding. A \`rounded-2xl\` (16px) card with \`p-2\` holds \`rounded-lg\` (8px) children.
- Pick one radius family from the archetype and keep it. Mixing sharp and pill shapes needs a reason.
- Borders are 1px in the \`border\` role. Prefer a border or a fill difference over a shadow on flat UI.

## 8. Contrast and accessibility
- Text contrast is at least 4.5:1; large text (24px+, or 19px+ bold) at least 3:1. Check muted text on surfaceAlt, not only on background.
- Text on images needs a scrim or a quiet image area. Check it in the screenshot.
- Touch targets are at least 44×44 on mobile; desktop controls at least 32px tall.
- Never rely on color alone for status: pair it with an icon or label.

## 9. Content realism
- Write real content for the product in the brief. No lorem ipsum, no "Title", "Button", "Feature 1".
- Use realistic, uneven numbers: $48,210.37, 1,284 orders, 3.7%, "updated 6 min ago". Not 1,000 / 50% / $10,000.
- Use plausible, varied names from more than one culture; avoid celebrity names.
- Use proper typography: curly quotes “ ” and ‘ ’, apostrophes ’, en dash – for ranges (9–5), em dash — for breaks, ellipsis …, × for dimensions, non-breaking units (12 GB).
- Do not invent claims: no fake customer logos, no "Trusted by 10,000+ teams", no made-up awards or percentages for a real brand. Use clearly fictional proof or leave the slot out.

## 10. States
- Every data view designs empty, loading and error states, not only the happy path. Empty states say what the area is for and give one action.
- Interactive components show default, hover or focus, disabled and selected where relevant. Focus rings are visible: 2px in the accent with a 2px offset.
- Forms show helper text, an inline error under the field (danger color plus icon), and a success confirmation.

## 11. Icons
- One icon set per design: lucide, ph (phosphor) or tabler. Fetch names with get_icons, then use \`<Icon name="lucide:arrow-right" className="size-5 text-…" />\`.
- One size per context (16 in dense UI, 20 in standard UI, 24 in navigation) and one stroke weight.
- Icons support labels; they do not replace them, except for universal actions (close, search, more).
- Never use emoji as icons or bullets.

## 12. Imagery
- Art-direct every image: role (hero, texture, product, person), subject, viewpoint, light, crop, and where the quiet area for text sits.
- A hero is one stage: a full-bleed photo or rendered scene with the statement on it. Not a text column next to a floating photo card.
- If no image tool is available, degrade with intent: a gradient mesh in the palette, a \`<Shader>\` fill, a large typographic crop, or abstract shapes cut from the accent and surface colors. Never a grey box labelled "Image" or a broken placeholder.

## 13. The reduction pass
Before you finish, walk every element and ask: what gets harder if this disappears? If nothing, remove it.
- No card inside a card. A section with a background does not also need a bordered card.
- No decorative dividers, badges or icons that repeat what the text already says.
- No three identical feature cards in a row followed by another identical grid. Vary the layout: a large lead item, a list, a split, a stat row.
- One heading per idea; delete subtitles that restate the heading.
- Remove wrappers that have no padding, background, border or layout role.

## 14. Verify
Screenshot after every section. Check clipping, overflow, overlap, leftover placeholder text, contrast and alignment in the image, not in your head. Run the design-review skill before you call finish.
`;
