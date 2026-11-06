# Integrated switch loading proof

Captured from the merged build (Track A visuals + Track B coordinator) with `node design/pen-parity/switch-loading-audit/integrated/capture.cjs` from the repo root, on a temporary profile with two sample files. Real switches drive the visuals; only the waits are made artificial so the loading frames are visible (local switches finish in ~4 ms, under the 120 ms show delay, so normally nothing flashes).

- `tab-before` → `tab-loading` → `tab-after`: `fileLibrary.open()` with `documentLifecycle.prepareSwitch` delayed 2 s. The workspace shows only the Verynize mark; tabs and panels stay usable.
- `page-loading` → `page-after`: `design.setActivePage()` to a page marked unloaded through `pageLoader.reset()`, released after 2 s. The outgoing page stays rendered under the blur until the target page commits.
