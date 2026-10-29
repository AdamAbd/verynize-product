# Verynize pipeline audit

Audit scope: static implementation inspection plus direct JSX codec probes. No competitive output generation or blind taste scoring performed. Findings below are code-backed, not claims about Wonder/Pen quality.

## Current pipeline

User turn + selection/page ids + optional attached images -> AgentRuntime builds a general editor persona -> Claude SDK / Codex app-server / CLI fallback -> live MCP create_artboard/update_elements -> bespoke JSX codec -> flat node document -> live canvas / screenshot -> optional finish_artboard focus. This is an agent execution bridge, not yet an enforced design-quality orchestrator.

## Prioritized findings

1. **P0: Completion is not evidence of visual quality.** `desktop/agent-runtime.cjs:254-259` emits done when provider completes; `integrations/design-tools.mjs:231-237` finish_artboard merely reads, focuses, and returns status finished. Neither requires screenshot of current revision, unresolved-warning checks, overflow checks, reference comparison, or critique. The instructions at `integrations/design-tools.mjs:31` request screenshots only when available. An agent can truthfully finish its tool sequence while producing visually poor UI.

2. **P0: Ordinary Tailwind syntax changes visual intent without warning.** `integrations/jsx-codec.mjs:124` collapses directional padding into one scalar; `:149` collapses per-corner radius into one radius. Direct Node probes returned `px-8 py-3 -> padding:32, ignored:[]` and `rounded-t-[16px] -> radius:16, ignored:[]`. Thus expected 32px horizontal / 12px vertical spacing becomes 32px on every edge; top-only corners round every corner. Fix the representational model and migration before relying on better prompts to achieve fidelity. Also `gap-x-8 gap-y-2` is ignored (regex alternative captures gap first), and `flex-1` is ignored. `min-w-0` produces no property and no warning in the tested combination. Expose a machine-readable supported capability contract.

3. **P1: Typography geometry is estimated rather than measured.** `integrations/design-edit.mjs:110-117` estimates character width as fontSize times .58/.53 plus letter-spacing. `:250` uses it for text node bounds. Font family, glyph-specific widths and shaping are absent from that estimate. Tight headings, mixed scripts, real fonts and long labels can wrap/clip differently from planned bounds. Use actual font metrics and settled-font measurement in the renderer; preserve a measurement provenance flag for headless estimates.

4. **P1: Familiar frontend components become missing visual assets.** `integrations/design-edit.mjs:130` skips icon components; `:156` replaces nonembedded image sources with empty placeholders; `:134` ignores style attrs, and `:444` discards imports. Warnings exist, so this is not entirely silent, but artboard creation succeeds (`integrations/design-tools.mjs:194-195`) and finish does not require repair. Bundled icon assets do exist under web/assets/icons/lucide, but there is no mapping demonstrated from JSX icon components to editable canvas nodes here. Introduce icon/asset resolution before generation and block verified completion on missing assets.

5. **P1: No explicit creative direction or reference contract in the default runtime.** `desktop/agent-runtime.cjs:32-46` includes generic inspect-before-edit and token guidance plus optional user instructions/project memory. `:52-80` passes document, page, selection, image paths; no structured audience, layout archetype, density, typography hierarchy, reference annotations, asset plan, or acceptance rubric. `integrations/design-tools.mjs:39-44` gives five basic layout guidelines. This makes taste contingent on provider defaults and user prompting. Add a concise design brief and reference-derived rules, then plan hierarchy before populating details.

6. **P1: Tests establish functionality, not competitive design quality.** `tests/capture-fidelity.cjs:2` checks document properties, images, borders/shadows, scripts and resource restrictions. These are valuable invariants but do not compare generated screens to a frozen reference or measure human preference. Do not report Wonder/Pen parity from passing this suite.

## Recommended orchestrator contract

Brief -> approved/reference-derived design direction -> asset/font resolution -> layout skeleton -> detailed render -> screenshot tied to document revision -> structural and visual critique -> bounded repair -> verified completion. Store stage artifacts and warnings; expose incomplete verification honestly. The screenshot infrastructure already exists (`integrations/design-tools.mjs:179-187`, live/editor and offscreen paths in `desktop/mcp-bridge.cjs:144-149`), so prioritize consuming it systematically over building another screenshot tool.

## Concrete next implementation order

- P0: strict codec diagnostics + directional padding/corner representation; tests for realistic button/header/card classes.
- P0: change finish result to distinguish edited/unverified/verified; verification receipts bind screenshot and checks to revision, invalidated after edits.
- P1: reference pack and compact brief persisted per task; asset resolution and real typography measurement.
- P1: bounded screenshot critique/repair with explicit structural failures and visual rubric.
- P1: paired evaluation against Wonder and Pen using identical tasks, references, dimensions, assets, provider settings where configurable, and multiple runs. Include a reference-recreation track and an original-design track; 1:1 pixel fidelity is meaningful only for recreation, while taste requires blind human comparisons. Figma/Figcraft remain secondary controls.

No production files modified. Direct codec probes were read-only and reproduced the reported conversions.
