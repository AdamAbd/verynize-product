import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPreferenceStore, defaultPreferencesPath, MAX_PREFERENCES } from './preferences.mjs';

async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bd-prefs-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }

test('default path honours BETTER_DESIGN_PREFERENCES', () => {
  assert.equal(defaultPreferencesPath({ BETTER_DESIGN_PREFERENCES: '/tmp/x/prefs.json' }), '/tmp/x/prefs.json');
  assert.match(defaultPreferencesPath({}), /Better Design[\\/]design-preferences\.json$/);
});

test('CRUD, dedupe, validation and atomic file format', async t => {
  const file = path.join(await temp(t), 'nested', 'design-preferences.json');
  const store = createPreferenceStore(file);
  assert.deepEqual(await store.list(), []);
  const a = await store.save('  Use 8px   corner radius ');
  assert.equal(a.text, 'Use 8px corner radius'); assert.equal(a.duplicate, false); assert.match(a.id, /^pref_[0-9a-f]{10}$/);
  const again = await store.save('use 8px corner RADIUS');
  assert.equal(again.duplicate, true); assert.equal(again.id, a.id);
  const b = await store.save('Never use purple gradients');
  assert.deepEqual((await store.list()).map(p => p.id), [a.id, b.id]);
  const updated = await store.update(b.id, 'Avoid gradients entirely');
  assert.equal(updated.text, 'Avoid gradients entirely'); assert.ok(updated.updated >= updated.created);
  await assert.rejects(store.update(b.id, 'use 8px corner radius'), /already saved/);
  await assert.rejects(store.update('pref_nope', 'x'), /No design preference/);
  await assert.rejects(store.save(''), /empty/);
  await assert.rejects(store.save('x'.repeat(501)), /500/);
  assert.deepEqual(await store.remove(a.id), { deleted: true, id: a.id });
  assert.deepEqual((await store.list()).map(p => p.text), ['Avoid gradients entirely']);
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(raw.version, 1); assert.equal(raw.preferences.length, 1);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.deepEqual((await fs.readdir(path.dirname(file))).filter(f => f.endsWith('.tmp')), [], 'no temp files left');
});

test('concurrent saves are serialized and the 100 limit is enforced', async t => {
  const store = createPreferenceStore(path.join(await temp(t), 'p.json'));
  await Promise.all(Array.from({ length: MAX_PREFERENCES }, (_, i) => store.save(`Rule number ${i}`)));
  assert.equal((await store.list()).length, MAX_PREFERENCES);
  await assert.rejects(store.save('One too many'), /At most 100/);
  assert.equal((await store.save('Rule number 5')).duplicate, true, 'duplicates are fine at the limit');
});
