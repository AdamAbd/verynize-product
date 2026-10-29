// Revision-bound verification receipts and the finish gate. A receipt records that an artboard
// was screenshotted, linted and reviewed at one document revision; any mutation invalidates it.
// finishGate decides whether finish_artboard may report "verified", must report "unverified",
// or is blocked by critical lint problems. Repairs are capped per artboard (MAX_REPAIRS).

import { randomUUID } from 'node:crypto';

export const MAX_REPAIRS = 3;
const ESTIMATED_SOURCE = /headless|estimat|unavailable|none|fallback/i;

const compactLint = lint => lint ? {
  critical: lint.problems.filter(p => p.severity === 'critical').map(p => p.id),
  counts: { critical: lint.stats?.critical ?? 0, major: lint.stats?.major ?? 0, minor: lint.stats?.minor ?? 0 },
  geometry: lint.stats?.geometry,
} : null;

/** Build an immutable receipt. `lint` is a lintArtboard() result (stored compactly). */
export function createReceipt({ documentRevision, pageId, artboardId, screenshot = null, lint = null, reviewNote = '' }) {
  if (!documentRevision || !artboardId) throw new Error('A receipt needs documentRevision and artboardId');
  return Object.freeze({
    id: randomUUID(), documentRevision, pageId: pageId ?? null, artboardId,
    screenshot: screenshot ? Object.freeze({ sha256: screenshot.sha256 || null, width: screenshot.width ?? null, height: screenshot.height ?? null, source: screenshot.source || 'unknown' }) : null,
    lint: compactLint(lint), reviewNote: String(reviewNote || '').trim(), createdAt: new Date().toISOString(),
  });
}

const screenshotReal = shot => !!(shot && shot.sha256 && !ESTIMATED_SOURCE.test(shot.source || ''));
/** A receipt is valid when it matches the current revision and holds a real screenshot. */
export const isReceiptValid = (receipt, currentRevision) => !!receipt && receipt.documentRevision === currentRevision && screenshotReal(receipt.screenshot);

const keyOf = (document, artboardId) => `${document ?? ''}\u0000${artboardId}`;

/** In-memory receipts and repair counters keyed by (document name, artboard id). */
export class ReceiptStore {
  #receipts = new Map();
  #repairs = new Map();
  record(document, receipt) { this.#receipts.set(keyOf(document, receipt.artboardId), receipt); return receipt; }
  latest(document, artboardId) { return this.#receipts.get(keyOf(document, artboardId)) || null; }
  /** Call on every mutation. With an artboardId, an edit after a receipt counts as one repair iteration. */
  invalidate(document, artboardId) {
    if (artboardId !== undefined && artboardId !== null) {
      const key = keyOf(document, artboardId);
      if (this.#receipts.delete(key)) this.#repairs.set(key, (this.#repairs.get(key) || 0) + 1);
      return;
    }
    const prefix = `${document ?? ''}\u0000`;
    for (const key of this.#receipts.keys()) if (key.startsWith(prefix)) this.#receipts.delete(key);
  }
  recordRepair(document, artboardId) { const key = keyOf(document, artboardId); this.#repairs.set(key, (this.#repairs.get(key) || 0) + 1); return this.repairBudget(document, artboardId); }
  repairBudget(document, artboardId, max = MAX_REPAIRS) { const used = this.#repairs.get(keyOf(document, artboardId)) || 0; return { used, max, remaining: Math.max(0, max - used), exhausted: used >= max }; }
  /** Forget receipts and repair counts (artboard deleted or recreated). */
  reset(document, artboardId) {
    const match = artboardId === undefined ? key => key.startsWith(`${document ?? ''}\u0000`) : key => key === keyOf(document, artboardId);
    for (const map of [this.#receipts, this.#repairs]) for (const key of map.keys()) if (match(key)) map.delete(key);
  }
}

/**
 * Decide the finish status. `lint` is the current lintArtboard() result (falls back to the receipt's);
 * `budget` is ReceiptStore#repairBudget(). Returns {status, reasons, allowFinish, critical}.
 */
export function finishGate({ receipt, currentRevision, lint, budget = null, artboardId } = {}) {
  const reasons = [];
  const critical = lint ? lint.problems.filter(p => p.severity === 'critical') : (receipt?.lint?.critical || []).map(id => ({ id }));
  if (!receipt) reasons.push('no verification receipt: take a screenshot and record a design review first');
  else {
    if (artboardId && receipt.artboardId !== artboardId) reasons.push(`receipt belongs to artboard ${receipt.artboardId}`);
    if (receipt.documentRevision !== currentRevision) reasons.push('stale receipt: the document changed after the last screenshot');
    if (!receipt.screenshot?.sha256) reasons.push('screenshot unavailable');
    else if (ESTIMATED_SOURCE.test(receipt.screenshot.source || '')) reasons.push(`screenshot is not a real render (source: ${receipt.screenshot.source})`);
    if (!receipt.reviewNote) reasons.push('no design-review note recorded');
  }
  const exhausted = !!budget?.exhausted;
  if (critical.length) {
    const list = `${critical.length} critical lint problem${critical.length > 1 ? 's' : ''} unresolved (${critical.map(p => p.id).slice(0, 10).join(', ')})`;
    if (!exhausted) return { status: 'blocked', reasons: [list, ...reasons], allowFinish: false, critical };
    return { status: 'unverified', reasons: ['repair budget exhausted', list, ...reasons], allowFinish: true, critical };
  }
  if (reasons.length) return { status: 'unverified', reasons: exhausted ? ['repair budget exhausted', ...reasons] : reasons, allowFinish: true, critical };
  return { status: 'verified', reasons: [], allowFinish: true, critical };
}
