# Wonder feature parity ledger

Retrieved 2026-10-28 using Agent Reach's Jina Reader route. Sources are vendor declarations, **not runtime verification**. Local installed-version parity and reconstruction verification remain untested for every item below.

Primary sources: [Roadmap](https://wonder.design/roadmap), [Changelog](https://wonder.design/changelog), [October 25 desktop release](https://wonder.design/changelog/introducing-the-new-wonder), [September–October update](https://wonder.design/changelog/headless-ai-and-large-files).

## Roadmap: declared shipped

Each unchecked item is an acceptance obligation, not a claim the reconstruction implements it.

- [ ] CSS Grid, Flex, Block and inline variants: retain browser layout behavior through import, editing and export.
- [ ] Mixed text styles: style character ranges without splitting text nodes; base style edits propagate appropriately.
- [ ] Gradients and CSS masks: editable paint/mask properties persist and export.
- [ ] Shaders: living backgrounds, editable parameters and shader library.
- [ ] Scale tool and z-index: proportional scaling and real stacking control.
- [ ] Measurements and snapping: measurable distances, alignment and precise placement.
- [ ] Figma import: clipboard selections become editable layers; connected-account images survive import.
- [ ] Variables: import code tokens, create canvas tokens, bind and persist properties.
- [ ] Image and vector generation: prompt-to-image/SVG and image-to-vector conversion.
- [ ] Code in/out: copy design code, paste code as editable layers; CSS/Tailwind export.
- [ ] Wonder Capture: webpage/region capture becomes editable layers with fonts, images and layout.
- [ ] Preview: real running app on canvas with interactive responsive viewport.
- [ ] Worktrees: separate project copies for concurrent work.
- [ ] Icon library: organize, swap and export icons.
- [ ] Wonder Chat: local Claude Code/Codex integration using existing plans; account/model switching.
- [ ] Wonder MCP: read, modify and generate designs, including while desktop app is closed.
- [ ] Real-time collaboration: shared editing, cursors and presence.
- [ ] Public profiles: publish creator identity/work.
- [ ] Public/private files: public profile visibility versus private access.

## Latest shipped desktop release expands the acceptance surface

The October 25 release is newer than several feature-specific roadmap links. It explicitly adds:

- [ ] Multiple local agents with worktree isolation and autonomy controls.
- [ ] Message queueing, progress, conversation rewind/resumption; context attachments from canvas/files/folders/images/prior chats.
- [ ] Second-model review; editable project/design memory; existing agent tools/plugins.
- [ ] Move/resize/restyle live app elements and edit text, with an agent applying changes to source.
- [ ] Capture app regions to editable canvas layers.
- [ ] Publish/update running app links and agent-assisted diagnosis of publishing failures.
- [ ] Start projects from ideas, folders and GitHub; reuse machine GitHub authentication; archive/restore projects.
- [ ] Chat alongside canvas or full-window; guided demo onboarding.
- [ ] PDF export, slide templates, file/global search, panel/view shortcuts, and persistent readable defaults.

September–October release additionally declares file/folder/page creation through MCP, token/icon access, moving files across workspaces with history, custom nudge amounts, saved/shared views, and reduced-motion support. These should be tracked separately from merely rendering a visually similar canvas.

## Do not treat these as generally shipped

- **Early access:** shared previews. The October 25 changelog separately advertises publishing; eligibility and exact relationship require runtime/account verification.
- **In progress:** code components, advanced sharing controls, comments.
- **Planned:** vector point/curve editing, cloud agents continuing with laptop closed, semantic design search, marketplace.

## Evidence and verification limits

The roadmap does not identify a desktop build number. Match `/Applications/Wonder.app` metadata and observed behavior before asserting the installed application has all advertised features. No live account, network protocol, collaboration session, generation request, export round-trip, desktop launch or reconstructed app was tested by this research pass. Backend-dependent capabilities need real integrations and end-to-end checks; a UI control or mocked response is not parity.
