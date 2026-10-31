# Wonder Properties audit — 2026-10-30

**Deliverables: 124 checklist evidence PNGs (including paired-state copies), plus 40 diagnostic/exploratory PNGs excluded from parity conclusions.**

## Scope, provenance, and capture method

Created a **new scratch file through Files → New file**. Wonder assigned the name **Sunbird**; it is the new tab created during this session. An attempted rename did not change the file name. All intentional document edits were confined to Sunbird. Existing Thrush and Porto documents were not edited. No AI prompts, Share, publishing, settings, or account actions were used. The existing chat sidebar was left alone; its content was treated as data.

Used macOS `cliclick` and `screencapture -x -R` at native Retina 2×. The display is 1440×900 logical / 2880×1800 physical pixels. Standard inspector captures use screen rectangle **(1160,183,280,717)**, yielding **560×1434 PNGs**. Wider captures retain the whole inspector plus popovers or canvas evidence; the inspector remains the rightmost 560 physical pixels. Nothing was upscaled. Measure CSS px by dividing physical pixels by 2. Some color-variable captures include the Variables region above Properties.

**Interference:** a separate Electron/Verynize window intermittently took the foreground. Affected shots were excluded or retaken. Exploratory screenshots, interrupted shots, and unsuccessful attempts are retained in `diagnostics/`, not accepted parity evidence. The later capture helper reactivates Wonder before actions and captures. Do not infer behavior from filenames alone: the entries below identify the accepted evidence and limits. Copies of a single capture are used where multiple empty sections or related states were simultaneously visible. `manifest.json` records every accepted PNG, dimensions, and SHA-256.

## Pixel measurements shared across entries

Measured on `C1-position-top-level.png`, `B5-numeric-plain.png`, `B5-numeric-variable-chip.png`, and `C2-display-flex.png`. Values are CSS px, generally ±0.5–1 px for antialiased edges.

- Inspector width **280**; left content x **12**; right edge of standard controls x **268**. Header plus center x **256**, secondary icon center x **224**, third icon center x **192**.
- Empty effect header/band **32** high (64 physical px). Ordinary input/paint row **24** high; typical row pitch **32**. Section separators are approximately **1** CSS px. Paint sections with one row occupy approximately **73** CSS px. Outline/Border with two rows occupy approximately **105** CSS px.
- Standard full paint input x **12**, width **192**; eye center x **224**, minus x **256**. Border two-column controls start x **12** and **112**. Paired layout fields start x **12** and **128**, with a **24** high field and roughly **8** gap.
- Display segmented group x **12**, width **256**, height **24**; four segments **64** wide. Flex direction group about **108×24**; flex alignment grid about **108×56**; padding toggle center x **256**.
- Sampled PNG colors: panel **#1C1C1C**; input fill **#2B2B2B**; segmented track **#262626**; active segment **#363636**; disabled field **#242424**; section divider **#262626**; common header glyph/text pixels **#A8A8A8**. These are actual screenshot RGB values (not inferred CSS declarations); antialiasing adds other shades. Canvas background is **#2B2B2B**. Purple accent’s most common saturated pixel is **#A245D3**; sample details are in `measurements.json`.
- Numeric prefix W occupies approximately x **18–30**; plain value starts x **36**. Bound numeric chip starts x **40**, with its text near x **44**. Thus chip box begins **10 px after the prefix right edge**, versus plain glyphs about **6 px after it**; chip text is about **8 px farther right** than a plain value. See B5.

## A1 — Background Fill

Evidence: `A1-background-empty.png`, `A1-background-added.png`, `A1-background-filled.png`, `A1-background-hover.png`, `A1-background-gradient.png`, `A1-background-variable-bound.png`, `A1-background-multiple.png`, `A1-background-hidden.png`, `A1-background-removed.png`.

Steps: drew a frame; removed its default white paint with row −; clicked header +; hovered the row; added another paint; opened its swatch and selected the dotted gradient icon; separately created color-1 through Variables + → Colors, then selected it in the paint picker’s Variables tab; toggled row eye; removed paints using −.

Empty and filled headers both show the wavy-square paint/animation icon and +. Solid row shows swatch, HEX, percent, eye, −. Gradient changes the row label to **Linear**, removes the inline solid percentage, and opens a stop editor with **Linear**, **Add Stop**, and per-stop percentages. Multiple paints create separate rows and hover exposes drag dots at the left. Additional solid paint initially appeared as black at 20%. Hidden paint uses a closed-eye glyph and changes the canvas; adding/removing/changing paints changes the canvas. Variable-bound row shows color-1 and an unlink icon on interaction, with no inline percent. Geometry: 32-high header, 24-high paint input, x12 input, x224 eye, x256 −. Hover does not introduce additional header icons.

## A2 — Border

Evidence: `A2-border-empty.png`, `A2-border-added.png`, `A2-border-filled.png`, `A2-border-hover.png`, `A2-border-individual-sides.png`, `A2-border-variable-bound.png`, `A2-border-settings.png`, `A2-border-removed.png`.

Steps: clicked Border +; opened sliders; toggled the square sides icon; toggled back; opened color swatch → Variables → color-1; hovered; removed with row −. Empty header has **+ only**. Active header has **sliders, nested-square sides icon, +**. Default is thickness **1**, **All**, black **100%**. Sliders menu reads **Solid**, **Dashed**, **Dotted**. Individual-sides state produces Top and Right rows in the captured viewport; a later scroll captures all four in `A2-border-individual-sides-bottom.png`. Variable-bound color removes its inline opacity field. Hover retains header icons. Removing last border restores + only. Canvas gained a thin border; the bound child with width 0 made later canvas comparisons less useful, so the final bound screenshot uses the other frame. Header 32 high; thickness/sides row and color row each 24 high, pitch32; icon centers x192/224/256.

## A3 — Outline

Evidence: `A3-outline-empty.png`, `A3-outline-added.png`, `A3-outline-filled.png`, `A3-outline-hover.png`, `A3-outline-removed.png`.

Steps: clicked Outline +, hovered its row, clicked row −. Empty header +; active header **sliders only**. Two rows: thickness **1**, offset **0**, eye, −; black paint at 100%. Hover leaves header unchanged. Removal restores + and removes the outline. Measured geometry matches Border’s two 24-high rows and 32-high header; sliders center x256. No separate outline variable state was requested.

## A4 — Shadow

Evidence: `A4-shadow-empty.png`, `A4-shadow-added.png`, `A4-shadow-filled.png`, `A4-shadow-hover.png`, `A4-shadow-multiple.png`, `A4-shadow-editor.png`, `A4-shadow-binding-menu.png`, `A4-shadow-bound.png`, `A4-shadow-removed.png`.

Steps: clicked Shadow +; hovered Box Shadow; clicked + again; removed extra rows; opened row editor, opened color swatch → Variables → color-1; removed final shadow. Header keeps **+** with zero, one, multiple, and bound shadow colors. Each row has Box Shadow icon/text, eye, −. Editor shows **Box**, **Drop**, X **0**, Y **4**, blur **4**, spread **0**, black **25%**, and **Inner shadow**. Bound capture proves color-1 inside the shadow editor and selection colors. Canvas shadow changes are subtle at these sizes; the editor’s live preview is clearer. Row24, header32, x12 row, x224 eye, x256 −. “Bound” here is the shadow’s color bound to a color variable; a whole-shadow variable type was not offered by the Variables menu.

## A5 — Filters

Evidence: `A5-filters-empty.png`, `A5-filters-added.png`, `A5-filters-filled.png`, `A5-filters-hover.png`, `A5-filters-type-menu.png`, `A5-filters-removed.png`; menu continuation in `diagnostics/05-bottom.png`.

Steps: clicked Filters +, hovered row, opened type dropdown, scrolled the menu, dismissed it, removed with −. Header + remains in all states. Default **Blur**, numeric **2**, eye, −. Menu groups are **Layer** and **Backdrop**, each containing **Blur**, **Brightness**, **Contrast**, **Grayscale**, **Hue rotation**, **Invert**, **Saturate**, **Sepia**. Applying Blur visibly softened the frame; removal removed this filter. Type and amount controls are 24 high, row pitch32; type starts x12, amount x142, eye224, −256. The initial `A5-filters-add-menu.png` is an added-filter state, not a menu; the correctly named type-menu shot is authoritative.

## A6 — Mask

Evidence: `A6-mask-empty.png`, `A6-mask-added.png`, `A6-mask-filled.png`, `A6-mask-hover.png`, `A6-mask-removed.png`.

Steps: clicked Mask +, hovered Linear row, clicked −. Header keeps +; added row has mask glyph, **Linear**, eye, −. Mask affects rendered transparency; removal returns the preceding rendering. No new header icon on hover. Header32, row24, row x12, eye224, −256.

## A7 — Export

Evidence: `A7-export-empty.png`, `A7-export-added.png`, `A7-export-filled.png`, `A7-export-hover.png`, `A7-export-removed.png`.

Steps: clicked Export +, scrolled down, hovered the name field, clicked header −. Empty header +; active header **− only**. Rows show **Frame**, **2x**, **PNG**, **Export as PNG**. Name row and format controls are 24 high, 32 pitch; full name/button width256. Header icon x256. Hover does not add icons. Canvas unchanged. Did not execute export or open a save dialog; no Share/publish action.

## A8 — Layer (not reproduced)

Evidence: `A8-layer-frame-top.png`, `A8-layer-frame-bottom.png`, `A8-layer-text-bottom.png`.

Selected top-level frame, nested frame, and text; inspected Properties at top and bottom. **No standalone “Layer” inspector header was found.** The left sidebar has Layers, and the filter menu has a Layer group, neither is the requested inspector section. Therefore empty/+/filled/hover/− states and measurements are unavailable, rather than invented. Evidence shows actual alternate sections. No action specific to an absent section was possible.

## A9 — Selection colors

Evidence: `A9-selection-colors-multiple.png`, `A9-selection-colors-bottom.png`; `diagnostics/28-bottom.png` also shows the parent-with-children case.

Steps: selected all top-level scratch nodes (two frames plus Parity-audit text) with Cmd+A on canvas; scrolled down. Selection colors includes descendant paints as well: white, black at20%, black at25% (shadow), #666666 at20% (gradient stop), and color-1. A parent frame with two text children also shows Selection colors, including black text paint. Header has **no + or −**. Rows show swatch/HEX or variable chip, optional percentage, and a bullseye/target icon at x256. Header/band32; row24; pitch32; row starts x12 and extends to x236. Merely selecting does not mutate the canvas. `A9-selection-colors-hover.png` captures row hover (no added header icons); target-button behavior was not tested; add/remove states are inapplicable because there are no such controls.

## A10 — Typography

Evidence: `A10-typography-text.png`, `A10-typography-settings.png`, `A8-layer-text-bottom.png`.

Steps: used the text tool on the scratch canvas, typed **Parity-audit**, exited editing, inspected Typography, attempted header sliders. Selected text shows **sliders** at x256 and no +/−. Fields: **Inter**, **Regular**, size **12 px**, **Line height Auto**, **Letter spacing 0 px**, horizontal left/center/right/justify, vertical top/center/bottom. Initial horizontal left and vertical top active. Full font row width256; weight and size paired columns (x12 and x144); fields24 high, standard pitch32. Text appears on canvas. Empty/added/removed typography states are not offered for a text layer. The final sliders capture opens **Type settings**: Case glyphs, Wrap **Auto**, Whitespace **Normal**, Truncation **Off / On**, Word Break **Off / All / Word**, Indent **0 px**, Smoothing **Default**, and Decoration glyphs. `A10-typography-hover.png` shows font-row hover; header sliders remain unchanged.

## A11 — Appearance

Evidence: `A11-eye-visible.png`, `A11-eye-hidden.png`, `A11-drop-open.png`, `A11-blend-menu-bottom.png`.

Steps: clicked drop; scrolled menu; closed it; toggled eye twice. Eye toggles layer visibility; closed-eye state hides layer rendering while leaving inspector values. Drop opens **blend modes**, not a visibility or paint toggle. Menu verbatim across two captures: **Normal; Darken; Multiply; Plus darker; Color burn; Lighten; Screen; Plus lighter; Color dodge; Overlay; Soft light; Hard light; Difference; Exclusion; Hue; Saturation; Color; Luminosity**. Header eye x224, drop x256; normal field geometry24. No +/− or empty Appearance state; controls remain for a selected layer. Opening the blend menu alone does not change canvas.

## B1 — Cross-axis gap with wrap off

**Enabled? YES. Can type? YES. Changes this unwrapped canvas? NO.**

Evidence: `B1-before-gap.png`, `B1-after-gap-37.png`, `B1-cross-gap-typed-37.png`.

Steps: set frame Display Flex, row direction, wrap off; create One text child and duplicate it; select parent via layer tree; change lower/cross-axis gap from10 to37 and press Return. Field retains37; both children stay on their single row. Pixel comparison of canvas crop `(210,525,390,890)` in the paired wide images is exactly identical (`ImageChops.difference(...).getbbox() == None`). Earlier empty-frame test independently accepts37. This conclusion is specific to row cross-axis gap without wrapping, not main-axis gap. Gap rows x12, width108, height24; lower gap center y427 within standard crop. Wrap icon is unhighlighted in paired test.

## B2 — W/H labels and menu

**Do Fixed, Hug, and Fill have distinct visible sizing states? YES. Is there one universal menu? NO.**

Evidence: `B2-wh-menu-open.png`, `B2-height-menu.png`, `B2-hug-menu.png`, `B2-flex-child-menu.png`, `B2-fixed-selected.png`, `B2-hug-selected.png`, `B2-fill-selected.png`, `B2-calculate.png`, `B2-min-width-added.png`, `B2-max-height-added.png`.

Steps: opened W menu on empty top-level frame, chose Calculate; created text in a flex parent; opened W menu; chose Fill, Fixed, Hug in sequence; chose Add min width; inspected H menu on frame and attempted Add max height.

Top-level empty frame W menu: **Fixed, Calculate, Add min width, Add max width**. H menu: **Fixed, Calculate, Add min height, Add max height**. Top-level text additionally offers **Hug, Auto**. Flex text child menu: **Fixed, Relative, Hug, Fill, Auto, Calculate, Add min width, Add max width**. Labels: fixed suffix **px**; hug suffix **Hug**; fill suffix **Fill**; Calculate moves the unit into the expression (**270px**) and canvas size badge shows **Calc**.

Fill changed child width to parent width80. Fixed retained80 but changed suffix to px. Hug returned natural text width23.27. Calculate preserved frame size270 while turning value into expression text. Add min width inserts a separate **Min W** field; the captured field was empty and suggestions offered dimension-1. Max-height attempt did not produce a durable Max H row, so its applied behavior is not verified. Final follow-up evidence: `B2-relative-selected.png` selects Relative (percentage unit); `B2-auto-selected.png` selects Auto, returning text width23.27 and height14.5; `B2-max-width-added.png` inserts **Max W**. These are captured states, not an exhaustive sizing algorithm test. Fields24 high, W x12/H x128; popup menu rows approximately24 high with group separators.

## B3 — Variable-bound fill opacity

**Inline opacity field at100%? NO. At50%? NO. Can make the variable translucent? YES.**

Evidence: `B3-variable-100.png`, `B3-variable-alpha-100-editor.png`, `B3-variable-50.png`, `B3-variable-alpha-50-editor.png`, `A1-background-variable-bound.png`.

Steps: Variables + → Colors creates color-1 black; bind fill through swatch → Variables → color-1. Expand Variables, click the color value at the right of color-1 (not its rename field), edit **A** from100 to50, Return. Value becomes **#00000080**, swatch displays alpha checker, and bound canvas paint changes. Later returned A to100 and captured the bound row again. Bound row has chip and interaction-only unlink icon, no inline percent at either alpha. The variable editor has the A percentage and transparency slider. Global layer opacity is independent (37 in later screenshot from an earlier shortcut test); do not mistake that for paint opacity. `B3-variable-50-attempt.png` documents a failed inline attempt that invoked the keyboard opacity shortcut; it is not the method used to edit variable alpha. Row24, chip starts aboutx37 in color row; eye224/−256.

## B4 — Constraints

**Top-level enabled? NO. Nested absolute child enabled? YES. Nested grid/flow child always enabled? NO.**

Evidence: `B4-top-level-dimmed.png`, `B4-grid-child-dimmed.png`, `B4-nested-absolute-constraints.png`, `B4-constraint-menu.png`.

Steps: draw parent; switch parent Grid; draw nested child; inspect dim constraints; toggle child Position header’s absolute-position icon; open Left menu. Absolute toggle enables alignment and constraints; Left menu contains **Left**, **Right**. Diagram marks left/top purple. Top-level and in-flow child diagrams remain dim. X/Y/rotation remain visible; Z is **Auto**. Constraint dropdowns24 high at x12 and100; diagram x188, width80, height56. Absolute icon center x256. Switching positioning changes layout participation and child placement; opening dropdown alone does not.

## B5 — Numeric variable chip offset

**Does the chip start farther right than a plain value? YES.**

Evidence: `B5-numeric-plain.png`, `B5-width-variable-search.png`, `B5-numeric-variable-chip.png`.

Steps: Variables + → Dimensions creates dimension-1; focus W on child; type `dimension`; choose dimension-1 suggestion. W changes from plain80 to truncated **dimen…** chip; default variable value0 collapses child width. Typing into X did not offer this binding suggestion (`B5-variable-search.png`), so measurement uses W, not X. Same field’s W glyph spans roughlyx18–30; plain text beginsx36; chip rectangle startsx40 and chip textx44. Box offset from icon right:10 vs6; chip text8 farther right than plain text. Field24 high; chip about16 high. Chip fill samples #1C1C1C against #2B2B2B field.

## C1 — Position

Evidence: `C1-position-top-level.png`, `C1-position-child.png`, `C5-grid-child.png`.

Steps and enabled states as B4. Top-level header has expand/arrows icon atx256; nested child adds absolute-position control, shifting expand tox224. X/Y/rotation three columns x12/100/188, 24 high; Z Auto spans first two columns (168 wide). Constraints diagram80×56. Top-level values100/−205/0; nested absolute95/0/0. No property was changed merely by capturing.

## C2 — Display segmented control

Evidence: `C2-display-none.png`, `C2-display-flex.png`, `C2-display-block.png`, `C2-display-grid.png`.

Steps: clicked all four segments in order. First/none icon is a three-square cluster; Flex paired bars; Block square outline; Grid four squares. Active segment uses #363636 fill and bright glyph; inactive track #262626 and muted glyph. Group256×24 atx12; four64-wide segments. Flex/Block/Grid reveal their respective controls; empty parent canvas had no child reflow at that stage. “None” is the checklist’s name for the first/no-auto-layout option, not proof of CSS display:none.

## C3 — Flex

Evidence: `C3-flex-controls.png`, `C3-flex-wrap-on.png`, `C3-flex-reverse-on.png`, `C3-flex-column.png`, `C3-flex-align-center.png`, `C3-flex-distribution.png`, B1 pair.

Steps: selected Flex; toggled wrap, reverse, column; clicked alignment center and distribution. Active toggles become purple; direction selected segment #363636. Two gap fields remain visible. Alignment grid9 positions; distribution row3 icon buttons; separate right-hand arrows and wrap/reverse controls. Column changes child arrangement vertically; center/distribution alter positioning. Later distribution screenshot includes padding28/42 and gaps37; it is not a controlled comparison against initial10/0 setup. Direction108×24; align108×56; distribution108×24; toggles24 square. B1 provides the isolated gap test.

## C4 — Grid

Evidence: `C4-grid-controls.png` (same capture as Grid display state).

Steps: selected Grid on parent. Shows track preview **1 × Auto**, two gap fields0, and 3×3 Align dots. Track preview roughly108×60; gaps atx128 with24-high rows; Align108×56 atx12. Display active Grid white glyph/#363636. Nested child subsequently joined grid (C5); no populated track editing was attempted.

## C5 — Grid child

Evidence: `C5-grid-child.png`.

Steps: drew a nested frame using frame toolbar inside Grid parent. Inspector includes **Grid child** with two span fields, both1, vertical/horizontal track glyphs. Each24 high, x12 and128. Constraints dim while participating in Grid. Canvas places child at parent grid origin (X/Y0). Span edits beyond the default were not requested/tested.

## C6 — Padding

Evidence: `C6-padding-collapsed.png`, `C6-padding-expanded.png`.

Steps: selected flex parent; clicked padding sides toggle on/off. Collapsed two fields0px; expanded four sides in2×2 arrangement, adding32 vertical pixels. Toggle centerx256, 24 square; expanded button has highlighted background and nested-rectangle glyph. Fields24 high atx12/x128; second row32 below first. Toggle alone changes inspector representation, not canvas padding values.

## C7 — Margin

Evidence: `C7-margin-unit-menu.png`, `C7-margin-auto.png`.

Steps: selected nested Grid child, opened horizontal margin unit dropdown, selected Auto. Menu verbatim **Fixed**, **Auto**. Fixed displays0 with **px** suffix; Auto displays **Auto** in both value and unit positions. Child moves horizontally to center (later absolute X95 reflects this). Fields24 high, x12/x128; menu about152 CSS px wide with24-high items. Expansion button centerx256.

## C8 — Page, no selection

Evidence: `C8-page-no-selection.png`.

Steps: opened new scratch file before drawing. Properties contains **Page**, swatch, **2B2B2B**, **100%**, eye. No object Position/Layout/Appearance. Page field24 high, x12, width224, eye centerx256. Canvas background matches #2B2B2B. No background edit performed.

## Explicit remaining limits

- A8 standalone Layer section could not be found; all its states remain unavailable.
- A9/A10 generic empty/+/− states do not exist in the observed UI; hover and typography settings were captured on the final pass.
- B2 max-height addition was attempted but not established; max-width insertion and Relative/Auto were captured on the final pass. Fixed/Hug/Fill/Calculate and min-width insertion have direct evidence.
- Some screenshots include a wider canvas/popup region to avoid clipping the evidence. Standard inspector copies are full-width native2×. No claims of exhaustive Wonder behavior beyond these observations.
