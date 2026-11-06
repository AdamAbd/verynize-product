# TypeScript migration

The renderer canvas and `web/document-core.js` remain imperative/classic scripts. There is still one runtime document validator.

## Checking JavaScript

`npm run typecheck:ratchet` runs four independent allowJs/checkJs projects: desktop, legacy-web, integrations and cloud. Each checks its complete import graph; totals overlap and must not be summed as unique errors. Existing UI projects remain strict and clean under `npm run typecheck:ui`.

The checked-in baseline limits both each area's total and each file/diagnostic-code count. `npm run typecheck:baseline` can only lower the limits: it rejects increases, including when updating. CI cannot rewrite the baseline. Compiler crashes, unreadable configs and unparseable diagnostic output fail the check. Detailed logs go to ignored `.typecheck/*.log`. Integration test files are not included in the production integration baseline; tests are a later phase.

## IPC and renderer boundaries

`desktop/ipc-contract.ts` maps all 165 invoke channels to the existing renderer API signatures, including nested API groups. Preload's invoke wrapper and main's registration helper use this map via erased JSDoc imports. Raw IPC arguments still cross an untyped Electron boundary; sender-origin checks and runtime payload validation remain essential.

The synchronous `agentBridge.onCall` unsubscribe and `reply` return values are corrected. `listAllowRules` accepts the optional `projectKey` actually forwarded by preload. `createProject` and `openProject` now describe their actual argument/result shapes.

Remaining desktop diagnostics include inferred options/queue types (`repositories` workspacesRoot callback, ChatGPT welcome callback return, Project.repositoryRoot augmentation, usage/memory registration options). These are not demonstrated runtime failures. Other legacy-only methods still use the existing `Untyped` signature: the channel map prevents name drift but does not claim payload completeness for them. Feature registration functions should adopt the shared Handle type as each desktop module is migrated.

`web/types/legacy-globals.d.ts` reuses existing island declarations for design, accounts, preferences and platform, and adds cloud-room/share, history, cache and export helpers. It is an initial boundary inventory, not complete coverage of every canvas extension. Missing canvas/service shapes and DOM narrowing remain visible in the legacy-web baseline; no catch-all Window index signature is used.

## Later phases

Continue the integration migration by dependency cluster, then cloud, desktop, legacy web and tests. Model the shared document/backend and codec types before converting the larger graph. Keep fidelity tests and runtime entry paths intact; do not replace the shared schema with a second implementation.
