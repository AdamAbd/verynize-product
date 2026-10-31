'use strict';
// Clipboard placement and duplicate commands (Wonder K2 / TR6), registered on the canvas command registry of
// web/canvas-interactions.js through BetterCanvas.extend, so window.design.runCommand(id, arg), the shortcuts and
// the context menu all reach them.
//
//   clipboard.pasteHere          arg {x, y} (document coords): the pasted bounds' top-left lands on that point.
//   clipboard.pasteToReplace     ⌘⇧R: each selected layer is replaced by the clipboard, same parent, position and stack slot.
//   clipboard.pasteOverSelection ⌘⇧V: same parent as the selection, stacked above it and centred on its bounds.
//   clipboard.copyLink           verynize://node/<document>/<pageId>/<shortId> per selected layer (the finish_artboard
//                                designLink format that web/desktop-panel.js openLink resolves), one per line.
//   clipboard.copyPrompt         ⌘⇧⌥C: a text prompt naming the selection, its links and its Tailwind JSX (the
//                                integrations codec through window.desktop.exportCode; the export HTML outside the desktop app).
//   edit.duplicate               ⌘D: the copy lands to the right of the original with a 40 px gap (Wonder: 120 wide at
//                                X515 → X675), stacked just above it.
// Duplicates (⌘D and Alt-drag) are renamed to the next free "<base> <n>" name on the page (Frame, Frame 2 → Frame 3).
//
// Assumptions where Wonder is unproven (design/wonder/canvas-audit/wonder/notes.md K2): the paste modes read the in-app
// clipboard (last copy or last pasted layers); Paste here pastes at the top level; Paste over selection with nothing
// selected pastes in place; Paste to replace skips locked layers; numbering applies to every duplicated name.
(() => {
  const DUPLICATE_GAP = 40;
  const r2 = v => Math.round(v * 100) / 100;
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** Next free "<base> <n>" for a copy of `name`, given the names already in use ("Frame", "Frame 2" → "Frame 3"). */
  function nextName(name, used) {
    const base = String(name || '').replace(/\s+\d+$/, '').trim() || 'Layer';
    const pattern = new RegExp('^' + escape(base) + '(?:\\s+(\\d+))?$');
    let max = 0;
    for (const n of used) { const m = pattern.exec(String(n ?? '').trim()); if (m) max = Math.max(max, m[1] ? Number(m[1]) : 1); }
    return `${base} ${max + 1}`;
  }

  function extend(c) {
    const {ed} = c;
    const hasClipboard = () => !!c.getClipboard()?.nodes?.length;
    const needsSelection = () => c.sel().size > 0;

    function renameCopies(ids) {
      const used = ed.nodes().map(n => n.name);
      for (const id of ids) { const n = c.find(id); if (!n) continue; n.name = nextName(n.name, used); used.push(n.name); }
    }
    c.hooks.duplicated = renameCopies; // Alt-drag copies (canvas-interactions duplicateNodes)

    // The visible bounds of layers, in their parent's coordinates (rendered size covers hug/fill and rotation).
    function localBounds(list) {
      return c.union(list.map(n => {
        const r = c.worldRect(n.id), w = r ? r.w : Number(n.w) || 0, h = r ? r.h : Number(n.h) || 0;
        return {x: r && !n.parentId ? r.x : Number(n.x) || 0, y: r && !n.parentId ? r.y : Number(n.y) || 0, w, h};
      }));
    }
    // Index just past a layer's subtree in the flat node list (its copies stack directly above it).
    const subtreeEnd = (list, id) => { const ids = ed.descendants(id); let end = -1; list.forEach((n, i) => { if (ids.has(n.id)) end = i; }); return end + 1; };

    // ---------- ⌘D ----------
    function duplicate() {
      const tops = c.topSelected(); if (!tops.length) return false;
      ed.checkpoint();
      const list = ed.nodes(), offsets = new Map();
      for (const parentId of new Set(tops.map(n => n.parentId || null))) {
        const group = tops.filter(n => (n.parentId || null) === parentId && !c.inStack(n));
        const b = localBounds(group); if (b) offsets.set(parentId, r2(b.w + DUPLICATE_GAP));
      }
      const result = [];
      for (const top of tops) {
        const subtree = ed.descendants(top.id), mapping = new Map([...subtree].map(id => [id, ed.uid()]));
        const dx = c.inStack(top) ? 0 : offsets.get(top.parentId || null) || 0;
        const copies = list.filter(n => subtree.has(n.id)).map(n => ({...structuredClone(n), id: mapping.get(n.id), parentId: mapping.get(n.parentId) || n.parentId || null}));
        const root = copies.find(n => n.id === mapping.get(top.id));
        root.x = r2((Number(top.x) || 0) + dx);
        list.splice(subtreeEnd(list, top.id), 0, ...copies);
        result.push(root.id);
      }
      renameCopies(result);
      ed.setSelection(new Set(result)); ed.render();
      return true;
    }
    const legacyDuplicate = document.getElementById('duplicate'); // inspector proxies and older callers click it
    if (legacyDuplicate) legacyDuplicate.onclick = () => duplicate();

    // ---------- Paste modes ----------
    // Fresh copies of the clipboard: roots detached (parentId null), with their offsets from the clipboard bounds.
    function materialize(data) {
      const ids = new Map(data.nodes.map(n => [n.id, ed.uid()])), roots = data.roots.filter(id => ids.has(id)), rootSet = new Set(roots);
      const copies = data.nodes.map(n => ({...structuredClone(n), id: ids.get(n.id), parentId: rootSet.has(n.id) ? null : ids.get(n.parentId) || null}));
      const source = new Map(data.nodes.map(n => [n.id, n]));
      const boxes = roots.map(id => { const n = source.get(id), w = data.world?.[id]; return {x: w ? w.x : Number(n.x) || 0, y: w ? w.y : Number(n.y) || 0, w: Number(n.w) || 0, h: Number(n.h) || 0}; });
      const bounds = c.union(boxes) || {x: 0, y: 0, w: 0, h: 0};
      const placed = roots.map((id, i) => ({node: copies.find(n => n.id === ids.get(id)), dx: boxes[i].x - bounds.x, dy: boxes[i].y - bounds.y}));
      return {copies, placed, bounds};
    }
    // Validates the edit on a copy of the document, then applies it as one undo step. `edit(list, wrap)` mutates a
    // page's node list; it must only locate nodes by id so both runs agree.
    function commit(data, edit, selection) {
      const candidate = structuredClone(ed.design), page = candidate.pages.find(p => p.id === ed.page().id);
      for (const [k, v] of Object.entries(data.tokens || {})) if (!candidate.tokens[k]) candidate.tokens[k] = v;
      edit(page.nodes, n => structuredClone(n));
      try { ed.validate(candidate); } catch (error) { c.footer('Unable to paste: ' + error.message); return false; }
      ed.checkpoint();
      for (const [k, v] of Object.entries(data.tokens || {})) if (!ed.design.tokens[k]) ed.design.tokens[k] = v;
      edit(ed.nodes(), n => ({...ed.defaults, ...structuredClone(n)}));
      ed.setSelection(new Set(selection)); ed.render();
      return true;
    }
    const placeAt = (placed, parentId, x, y) => { for (const {node, dx, dy} of placed) { node.parentId = parentId; node.x = r2(x + dx); node.y = r2(y + dy); } };

    function pasteHere(point) {
      const data = c.getClipboard(); if (!data) return false;
      const {copies, placed, bounds} = materialize(data);
      const p = point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)) ? {x: Number(point.x), y: Number(point.y)} : c.placeInView(bounds.w, bounds.h);
      placeAt(placed, null, p.x, p.y);
      return commit(data, (list, wrap) => list.push(...copies.map(wrap)), placed.map(p => p.node.id));
    }

    function pasteOverSelection() {
      const data = c.getClipboard(); if (!data) return false;
      const tops = c.topSelected();
      if (!tops.length) return c.paste(data, {inPlace: true});
      const parentId = tops[0].parentId || null, group = tops.filter(n => (n.parentId || null) === parentId);
      const {copies, placed, bounds} = materialize(data), target = localBounds(group);
      placeAt(placed, parentId, target.x + (target.w - bounds.w) / 2, target.y + (target.h - bounds.h) / 2);
      const above = group.map(n => n.id);
      return commit(data, (list, wrap) => { const at = Math.max(...above.map(id => subtreeEnd(list, id))); list.splice(at, 0, ...copies.map(wrap)); }, placed.map(p => p.node.id));
    }

    function pasteToReplace() {
      const data = c.getClipboard(); if (!data) return false;
      const targets = c.topSelected().filter(n => !n.locked); if (!targets.length) return false;
      const plans = targets.map(t => {
        const {copies, placed} = materialize(data);
        placeAt(placed, t.parentId || null, Number(t.x) || 0, Number(t.y) || 0);
        return {id: t.id, copies, roots: placed.map(p => p.node.id)};
      });
      return commit(data, (list, wrap) => {
        for (const plan of plans) {
          const removed = ed.descendants(plan.id), at = list.findIndex(n => n.id === plan.id);
          list.splice(at, 0, ...plan.copies.map(wrap));
          for (let i = list.length - 1; i >= 0; i--) if (removed.has(list[i].id)) list.splice(i, 1);
        }
      }, plans.flatMap(p => p.roots));
    }

    // ---------- Copy link / prompt ----------
    function documentName() {
      const library = window.fileLibrary, file = library?.list?.().find(f => f.id === library.currentId);
      return ed.design.name || file?.name || 'editor';
    }
    function linkTo(node) {
      let ref = node.id;
      try { ref = window.agentWorkspace?.searchElements?.(node.id)?.find(m => m.id === node.id)?.shortId || ref; } catch {}
      return `verynize://node/${encodeURIComponent(documentName())}/${encodeURIComponent(ed.page().id)}/${encodeURIComponent(ref)}`;
    }
    function copyLink() {
      const tops = c.topSelected(); if (!tops.length) return false;
      c.writeSystemClipboard(tops.map(linkTo).join('\n'));
      c.footer(tops.length === 1 ? 'Copied link to ' + tops[0].name : `Copied links to ${tops.length} layers`);
      return true;
    }
    async function copyPrompt() {
      const tops = c.topSelected(); if (!tops.length) return false;
      const pageName = ed.page().name || 'Page';
      let code = '', lang = 'jsx';
      try {
        if (window.desktop?.exportCode) code = (await window.desktop.exportCode({flavor: 'tailwind', document: structuredClone(ed.design), pageId: ed.page().id, nodeIds: tops.map(n => n.id), name: tops[0].name})).content;
      } catch {}
      if (!code) { try { code = (await ed.exportArtwork({format: 'HTML', selectionOnly: true})).content; lang = 'html'; } catch {} }
      const names = tops.map(n => `"${n.name}"`).join(', ');
      const prompt = [
        `Implement ${tops.length === 1 ? 'this design' : 'these designs'} from Verynize (${documentName()} › ${pageName}): ${names}.`,
        ...tops.map(n => `- ${n.name} (${n.type}, ${r2(Number(n.w) || 0)}×${r2(Number(n.h) || 0)}): ${linkTo(n)}`),
        ...(code ? ['', lang === 'jsx' ? 'Tailwind JSX of the selection:' : 'HTML of the selection:', '```' + lang, code.trim(), '```'] : []),
      ].join('\n');
      c.writeSystemClipboard(prompt);
      c.footer('Copied prompt for ' + (tops.length === 1 ? tops[0].name : `${tops.length} layers`));
      return true;
    }

    // ---------- Registry ----------
    const canPaste = () => hasClipboard();
    for (const command of [
      {id: 'edit.duplicate', run: duplicate},
      {id: 'edit.pasteInPlace', keys: []}, // ⌘⇧V is Paste over selection (Wonder)
      {id: 'edit.copyStyle', label: 'Copy styles', keys: ['mod+alt+c']},
      {id: 'edit.pasteStyle', label: 'Paste styles', keys: ['mod+alt+v']},
      {id: 'edit.copyCode', label: 'Copy as code', keys: ['mod+shift+c']},
      {id: 'clipboard.pasteHere', label: 'Paste here', section: 'Edit', keys: [], when: canPaste, run: pasteHere},
      {id: 'clipboard.pasteToReplace', label: 'Paste to replace', section: 'Edit', keys: ['mod+shift+r'], when: () => canPaste() && needsSelection(), run: pasteToReplace},
      {id: 'clipboard.pasteOverSelection', label: 'Paste over selection', section: 'Edit', keys: ['mod+shift+v'], when: canPaste, run: pasteOverSelection},
      {id: 'clipboard.copyLink', label: 'Copy link to selection', section: 'Edit', keys: [], when: needsSelection, run: copyLink},
      {id: 'clipboard.copyPrompt', label: 'Copy prompt', section: 'Edit', keys: ['mod+alt+shift+c'], when: needsSelection, run: copyPrompt},
    ]) c.register(command);
  }

  window.BetterCanvas?.extend(extend);
  window.VerynizeClipboard = {nextName};
})();
