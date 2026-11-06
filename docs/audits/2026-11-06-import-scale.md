# Large import implementation

Branch: feat/import-scale, based on origin/fix/large-design-import.

## Import contract

MCP import_html and import_jsx default to split: "pages". Whole root artboards are
packed in source order onto the target and newly allocated pages named "<target> 2",
"<target> 3", etc., skipping existing names. Existing pages are not repacked.
The result includes pages with stable ids, names, incoming node counts, and artboard
ids/names/counts. Coordinates honor placement: "auto" or "preserve" on each page.
All changes are made on a private transaction copy and validated before commit;
component expansion is included in the count. Both store and desktop bridge use
this same design-tools transaction implementation.

split: "none" retains atomic page/document preflight. A single artboard above
5,000 nodes fails with its name, node count, limit, and advice to split its sections.
The document limit remains 50,000 nodes. Image data and other large payloads are
still subject to the store's 20 MiB serialized-document limit.

For full HTML documents exceeding a page's element budget, body children become
root artboards, inheriting body style. This deliberately drops the outer viewport
wrapper and body layout context; it suits exported board collections. If a single
body child is itself oversized, explicitly separate its sections in the source.
Small full HTML documents retain their existing viewport/body wrapper.
No arbitrary nested artboard is silently fragmented.

## Guards and performance

HTML and JSX emitted element limits are 50,000; expanded nodes are checked again.
Both parsers cap source length at 5,000,000 characters and nesting at 256.
HTML DOM parsing additionally caps elements at 50,256 (allowing structural metadata).
Existing stylesheet, image, network timeout, and aggregate resource budgets remain.
HTML cascade work has a cooperative 60-second deadline, checked per element.
These bound work but are not a hard process memory ceiling.

CSS pruning indexes DOM tag/id/class names once and removes only selectors whose
mandatory compound terms cannot occur anywhere. Pseudos, attributes, ancestry,
and unsupported syntax are conservatively retained. A 50ms budget retains remaining
rules on expiry. Source order, layer order, and specificity stay unchanged.
Low-level pruneCss: false allows a reference comparison; stats.prunedRules records
the removed rule count.

Synthetic fixture: 20 roots of 1,000 nodes each, imported through runTool and read
back from a real DesignStore, producing four pages and exactly 20,000 stored nodes.
An early unloaded run measured JSX 4.2s and HTML 7.8s; HTML process RSS was 316 MiB.
JSX parse alone measured 12ms with a 10.2 MiB heap delta. A 10,000-unused-rule fixture
measured 146ms without pruning versus 108ms with pruning (10,000 rules removed).
These are observations, not CI thresholds; parallel Electron/build workloads
increase timings substantially. The tests print timing, heap delta, and RSS.

Store serialization is now compact: validation previously measured compact JSON
but wrote pretty JSON, allowing a successful large write that the reader rejected
as over 20 MiB. Compact output makes the write/read budgets agree.

## Fidelity choices

The existing node model stores one circular radius per corner, plus ellipse=true
for a full 50% ellipse. It cannot represent separate horizontal and vertical corner
radii. Slash radii (including rounded-[a/b]) and two-value corner longhands keep
horizontal radii and warn. No schema or renderer change is made.

Image fills support centered, non-repeating cover/contain/fill/none:
background-size cover and contain map directly, 100% 100% maps to fill, and auto
maps to native size (none). Other sizes fall back to cover with a warning.
Centered position and no-repeat need no warning; other positions and repetition
remain approximate and warn. There is no tile fit in the existing renderer.
Deferred JSX remote-background sizing remains approximate and warns; embedded
images and HTML's resolved images use the mapped fit. SVG handling is untouched.

## Validation

See final implementation handoff for exact commands, counts, and log paths.
Regression coverage lives in integrations/import-scale.test.mjs and fidelity
fixture 35-radius-background. No UI was changed, so screenshots are not applicable.
