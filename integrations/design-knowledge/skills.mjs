// Job-routed workflows. Each skill is markdown an agent reads before starting that kind of job.

const newDesign = `# Skill: new-design

Use when the canvas has no design for this request yet: a new screen, page, component or flow.

## 1. Write the brief (before any tool that draws)
Write it in your reply, five lines:
- **Job:** impress or present clearly.
- **Audience and context:** who, on what device, in what mood.
- **Content:** the real sections and the real copy you will use.
- **Direction:** the source of the look, chosen in this order — (1) the user’s brief or references, (2) tokens and components already in the document (get_design_context, get_design_tokens), (3) the visual language of existing artboards, (4) a named archetype from get_design_guidelines. Name it.
- **Density and viewport:** airy / comfortable / compact, and the canonical size from the playbook.

If the brief is vague, decide; do not ask more than one question. State your assumptions.

## 2. Load the rules
Call get_design_guidelines with \`style\` (the archetype id) and \`domain\` (the playbook). Follow binding parameters: fonts, radius scale, elevation. If the document has no tokens, create them from the archetype (color roles at minimum) with apply_style_tokens (or create_design_tokens), and use \`bg-[var(--color-…)]\` from then on.

## 3. Build a labelled skeleton
create_artboard with the root and every section as a labelled, empty or near-empty frame, two levels deep:
- Level 1: sections (\`data-node-label="Hero"\`, “Proof”, “Features”, “Pricing”, “Footer”).
- Level 2: the main blocks inside each (“Hero / Copy”, “Hero / Media”).
Use flex/grid flow, hug heights, real widths. Screenshot once to confirm the proportions and rhythm.
Sections hug their content: make vertical rhythm with padding and gap (\`py-24\`, \`pt-32 pb-16\`, \`gap-12\`). Per-side padding and margins (pt-*, px-*, mb-*…) and per-corner radius all work. Never pin a section height with \`h-[…]\` to fake spacing; fixed heights are only for media, icons and deliberately sized UI (use \`min-h-*\` for a tall hero).

## 4. Fill one section at a time
For each section, in order:
1. Write it with update_elements (replace the section by id). Real copy, real numbers, real icons (get_icons), art-directed imagery or an intentional fallback.
2. take_screenshot of that section (not only the full page; a downscaled page hides clipping).
3. Fix what you see before moving on: clipped text, overflow, leftover “Title”/“Button”, contrast, misalignment, spacing that breaks the tiers.

## 5. Review
Run the design-review skill on the whole artboard. Apply its fixes. Re-screenshot.

## 6. Finish
Call finish_artboard. Then summarise in 3–5 lines: the direction (archetype, fonts, palette concept), the structure, anything you assumed, and what you would do next.

## Rules
- Never draw before the brief is written.
- One archetype per screen. If you produce variations, use the variations skill.
- No placeholder text, no grey image boxes, no emoji icons.
- No fixed section heights: sections hug, spacing comes from padding and gap.
- Apply the user's saved design preferences (get_design_context) unless the brief overrides them.
- Put finish_artboard's designLink in your summary verbatim so the user can click through to the artboard.
`;

const editDesign = `# Skill: edit-design

Use when the user asks to change something that already exists.

## 1. Diagnose before touching
- take_screenshot of the affected area and read its code with get_element_code (or get_element_tree for structure).
- Say in one sentence what is wrong or what will change, and which element ids are involved.
- Identify the existing direction: fonts, palette, radius, spacing rhythm, tokens. You must preserve it unless the user asks for a new direction.

## 2. Change the minimum
- Edit the smallest element that fixes the problem. Prefer \`edit\` directives that merge classes over \`replace\`.
- Keep ids stable. Do not rebuild a section to change a word.
- Reuse existing tokens and classes from sibling elements; do not invent new colors or font sizes.
- If a change ripples (e.g. a longer headline), check the neighbours and parent still hug and align.
- Spacing changes use per-side padding/margin (pt-*, pb-*, px-*, mt-*) and gap; they all work. When existing code has fixed section heights (\`h-[…]\` on sections or blocks of text, often left by older sessions), replace them with hug + padding (remove the \`h-[…]\`, add \`py-*\`) instead of nudging the fixed height.

## 3. Verify
- take_screenshot of the edited area. Compare with the before shot.
- Check that nothing else moved, clipped or changed color.
- For edits that touch more than one section, run a short design-review on the changed sections.

## 4. Report
List what changed (by element id and in plain words) and anything you noticed but did not change.

## Rules
- Do not “improve” unrelated parts unasked. Mention them instead.
- If the request conflicts with the fundamentals (e.g. 10px body text), do it, and note the trade-off in one line.
- If the user states a lasting preference while asking for the edit ("always…", "from now on…"), save it with save_design_preference.
`;

const designReview = `# Skill: design-review

Mandatory after a new design, after any edit that touches more than one section, and before finish_artboard.

## 1. Look
take_screenshot of the full artboard, then of each section at full resolution. Read the code for anything suspicious.

## 2. Critique against the checklist
Score each item pass / fix. Be specific; cite element ids.
1. **Hierarchy:** one focal point and one primary action per section; three emphasis levels; heading/body ratio holds.
2. **Spacing rhythm:** spacing uses the three tiers; between-group space ≥ 2× within-group; side padding is consistent.
3. **Typography:** archetype fonts loaded; body ≥ 14px (16px marketing); line length ≤ 75ch; display tracking tight; no orphans in headlines.
4. **Color and contrast:** text ≥ 4.5:1 against its real backdrop; accent only on actions/selection; no banned palettes; neutrals tinted consistently.
5. **Alignment:** shared left edges; grid columns respected; icons optically centred with labels.
6. **Density:** matches the brief; no cramped cards; no vast empty areas without purpose.
7. **Content realism:** no lorem, no “Title”/“Button”; uneven realistic numbers; real names; proper quotes and dashes; no invented claims.
8. **States:** empty, loading, error, focus/hover/selected exist where the playbook requires them.
9. **Reduction:** no card-in-card; no redundant wrappers, dividers, badges or subtitles; no repeated identical grids.
10. **Asset readiness:** fonts rendered (not fallback), icons from one set at one size, images art-directed or an intentional fallback; nothing clipped or overflowing.

## 3. Fix
Pick the 1–5 highest-impact fixes. For each: the principle, the element id, the concrete change (classes or copy). Apply them with update_elements.

## 4. Re-verify
Re-screenshot every changed section. If new problems appear, repeat steps 2–4. Stop after **3 repair iterations**; report anything still open instead of looping.

## 5. Report
One short block: what passed, what you fixed (with ids), what remains and why.
`;

const variations = `# Skill: variations

Use when the user asks for options, alternatives or “a few directions”.

## Rules
- Make at most 4. Two strong directions beat four weak ones.
- Each variation must differ on all four axes:
  1. **Type category** (e.g. serif display vs grotesque vs mono vs condensed).
  2. **Color family** (different hue family and light/dark, not a shade shift).
  3. **Layout** (e.g. full-bleed stage vs split vs editorial grid vs centred statement).
  4. **Component styling** (radius family, elevation, button style).
- Pick each from a different archetype (get_design_guidelines with \`brief\` suggests styles) or from a clearly different reading of the brief.
- Keep content identical across variations so the comparison is about design.

## Workflow
1. Write one line per variation: name, archetype, the idea in eight words.
2. Build each as its own artboard, side by side, labelled “A — Name”, “B — Name”.
3. Follow new-design steps 3–5 for each, at least through a hero/key screen. Screenshot each.
4. Run design-review on each (lighter: top 3 fixes).
5. Present them: one line each on what it is good for, and your recommendation with a reason.

## Failure signs
- Same layout with a different accent color.
- Two variations sharing a font family.
- A “safe” variation that is just a weaker version of another.
`;

const codeToDesign = `# Skill: code-to-design

Use when the user gives code (a component, page, repo path, or pasted JSX/HTML) and wants it on the canvas.

## 1. Read the source of truth
- Extract tokens first: colors, font families, sizes, spacing, radii, shadows from Tailwind config, CSS variables or theme files. Create matching design tokens.
- Note the real copy, data shape and states the code renders.

## 2. Translate, do not re-imagine
- Rebuild the structure in Verynize JSX with flex/grid flow, hug/fill sizing and the same class values. Convert runtime logic to static content: write out mapped items explicitly with realistic data.
- Keep component boundaries as labelled frames (\`data-node-label\` = component name).
- Fonts by real family name with font-['Family_Name']; icons via get_icons using the closest match in one set.
- Replace remote images with art-directed imagery or an intentional fallback.

## 3. Verify fidelity
- Screenshot section by section; compare against the code’s intent (and any screenshot the user gave).
- Fix deviations in spacing, type and color before adding anything new.

## 4. Optional uplift
Only if asked: run design-review and propose improvements as a separate artboard, never by silently changing the faithful copy.
`;

const designSystem = `# Skill: design-system

Use when the user asks for a design system, style guide, tokens, a theme, or a component library sheet.

## 1. Decide the foundation
Choose the direction (brief → existing tokens → archetype). Write it in one line.

## 2. Define tokens
Create tokens in this order, with role names, not color names:
- **Color:** background, surface, surface-alt, foreground, muted, border, accent, accent-foreground, success, warning, danger, info (+ focus if needed). Verify foreground/background and accent-foreground/accent ≥ 4.5:1. Dark theme as a separate set, not an inversion.
- **Type:** display, body, mono families; a scale (e.g. 12/14/16/20/24/32/40/56) with line heights and tracking per step; 2–3 weights.
- **Spacing:** 4px base — 4, 8, 12, 16, 24, 32, 48, 64, 96, 128. Name the three tiers (tight, group, section).
- **Radius:** none, sm, md, lg, xl, full with concentric rules.
- **Shadow:** raised and overlay, two layers each, low alpha, one light direction.
Use create_design_tokens for colors; record the other token types in the sheet until typed tokens are available (apply_style_tokens creates the color tokens and returns ready font, radius and shadow classes).

## 3. Build the sheet
One artboard (1440 wide), sections: Color (swatches with role, hex, contrast pair), Type (each step rendered with real copy), Spacing, Radius, Elevation, Components (button set with all states, input with states, select, checkbox/radio/toggle, badge/chip, card, table row, nav item, toast, dialog).

## 4. Verify
Screenshot each section. Run design-review with emphasis on contrast and states. Finish with a short token summary.

## Rules
- Every component shows default, hover, focus, disabled; inputs also show error.
- No orphan values: if a value is not a token, remove it.
`;

export const skills = {
  'new-design': { name: 'new-design', summary: 'Brief → direction/archetype → labelled skeleton → section-by-section with screenshots → design-review → finish.', body: newDesign },
  'edit-design': { name: 'edit-design', summary: 'Diagnose from screenshot + code, make minimal targeted changes, preserve the direction, re-verify.', body: editDesign },
  'design-review': { name: 'design-review', summary: 'Ten-point critique with 1–5 concrete fixes citing element ids; re-screenshot; max 3 repair iterations.', body: designReview },
  variations: { name: 'variations', summary: 'Up to 4 genuinely different directions differing in type category, color family, layout and component styling.', body: variations },
  'code-to-design': { name: 'code-to-design', summary: 'Extract tokens and structure from code and rebuild faithfully on the canvas, then verify.', body: codeToDesign },
  'design-system': { name: 'design-system', summary: 'Define color, type, spacing, radius and shadow tokens and build a component sheet with all states.', body: designSystem },
};

export function listSkills() {
  return Object.values(skills).map(({ name, summary }) => ({ name, summary }));
}

export function getSkill(name) {
  const key = String(name || '').toLowerCase().trim().replace(/[\s_]+/g, '-');
  const skill = skills[key];
  if (!skill) throw new Error(`Unknown skill "${name}". Available: ${Object.keys(skills).join(', ')}`);
  return skill.body;
}
