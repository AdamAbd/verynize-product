# Installed Pen reference

Read-only inspection on 2026-10-28 of `/Applications/Pen.app` identifies version **1.2.20**, bundle ID `dev.pencil.desktop`, document extension `.pen`, and description “Desktop app for pen.dev.” No installed files were modified or extracted code executed.

ASAR SHA-256: `dee046c4ed2769fa27cab09e1efe0a6252d495197fc711ee7520b14d0c613004`.

REA manifest-only analysis parent Evidence: `ev_3d2545891f9b92a3086be682f3314c3e8822fade661887a36049593d7eeac68d`; summary Evidence: `ev_efc2a4cde030f61c0a3280b341ec5ce3c7891bfcdbc2c550b8c24b7ff0af243b`.

39 unpacked native-member integrity contradictions were reported, including Claude and Cursor binaries. Analysis used `record-and-continue`; mismatched contents remain observed-untrusted. Signing after packaging is a possible explanation, not a verified cause. The manifest is the only selected source, so code relationships and runtime behavior remain unknown.

Manifest observations: Claude Agent SDK 0.3.293, Codex SDK 0.159.2, local `@ha/schema`, `@ha/headless`, `@ha/mcp`, `@ha/browser-inject`, `@ha/electron-browser-import`, Electron Store, and Chokidar dependencies. These support investigation of document-first editing, headless automation, agent integration, browser import, and local persistence as architectural candidates. They do not prove successful operations or reveal the private .pen schema.

Verynize implements its own documented JSON schema, nested editable frame/layer hierarchy, variable binding, and browser-layout export. No Pen proprietary source or assets were copied; compatibility with native .pen documents is **not established**.

Context7 resolved `/mdn/content` and queried CSS grid/flex positioning: normal-flow children remain relative in layout containers, while freely positioned children use absolute coordinates. Reference: [MDN grid and other layout methods](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout/Relationship_with_other_layout_methods).
