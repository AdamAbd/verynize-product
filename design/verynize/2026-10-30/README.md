# Verynize recreation of the Wonder workflow

`workflow.verynize.json` is an editable Verynize document recreated from the observed Wonder composition. It is original fixture data, not an export from Wonder. Open it using Verynize's document-open flow.

The document has eight nodes, six variables across all five types, and the original Spark SVG in its icon library. It exercises surface fill, spacing on radius/padding/gap, font family/weight, SVG accent color and opacity. The Spark instance is an absolute child of the artboard so exporting that artboard includes the icon.

Differences from Wonder are intentional and explicit: the layout uses supported flex/grid semantics, the separated outline is approximated with CSS shadows, and the grid's Brightness filter and hidden mask are omitted. It is a functional recreation, not a claim of pixel-identical parity or complete support for every Wonder configuration.

Wonder reference: `../../wonder/2026-10-30/34-final-design.png`. The workflow and audit are documented in `../../../docs/wonder-design-workflow-2026-10-30.md`.

## Verified product evidence

- `workflow-canvas.png`: actual Verynize canvas in an isolated temporary profile.
- `workflow-export.png`: native 2× PNG, 1600 × 1140, with the complete artboard and SVG icon. `export-verification.json` records dimensions and right/bottom alpha checks.
- `svg-color-variable.png`: actual SVG shape paint bound to a variable.
- `01-individual-corners.png` and `02-individual-border-widths.png`: inspector controls after real UI edits and CSS assertions.
- `workflow-export-before-scale-fix.png`: deliberately retained failing export for the audit; it is not the finished output.

The native render regression checks explicit artwork at 0.5×, 1×, 2× and 4×. The library and binding regressions also pass. These screenshots are product evidence, separate from the Wonder reference images.
