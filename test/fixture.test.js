import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { validateBoard } from '../src/boards.js';

const source = await readFile(new URL('../examples/fixture.js', import.meta.url), 'utf8');
const snapshot = '2026-10-06T06:21:16.020Z';
const baseBoard = index => ({ id: `board-${index}`, revision: 1, ...validateBoard({ name: `Board ${index}` }) });
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(count = 1) {
  const data = { status: { mode: 'demo', configured: true, sample: true }, portfolio: { asOf: snapshot },
    boards: Array.from({ length: count }, (_, index) => baseBoard(index)) };
  const context = { window: {}, URL, crypto: { randomUUID } };
  runInNewContext(source.replace('/*DATA*/null', () => JSON.stringify(data)), context);
  return context.window.AssetKitFixture.request;
}

test('sample status exposes the synthetic snapshot clock without using today', async () => {
  const request = fixture();
  const status = await request('GET', '/api/status');
  assert.equal(status.mode, 'demo');
  assert.equal(status.sample, true);
  assert.equal(status.sampleAsOf, snapshot);
  status.sampleAsOf = 'changed';
  assert.equal((await request('GET', '/api/status')).sampleAsOf, snapshot);
});

test('sample boards use the same defaults and normalization as BoardStore', async () => {
  const request = fixture();
  for (const input of [{ name: ' Default ' }, { name: ' Scoped ', symbols: ['btc', ' ETH ', 'BTC'], widgets: ['holdings', 'summary'], days: 365, refreshSeconds: 0 }]) {
    const result = await request('POST', '/api/boards', input);
    const { id, revision, updatedAt, ...fields } = plain(result);
    assert.deepEqual(fields, validateBoard(input));
    assert.equal(revision, 1);
    assert.ok(id && Number.isFinite(Date.parse(updatedAt)));
  }
});

test('invalid sample board inputs are rejected before changing state', async () => {
  const request = fixture();
  const invalid = [null, {}, { name: 3 }, { name: ' ' }, { name: 'x'.repeat(49) },
    { name: 'x', symbols: null }, { name: 'x', symbols: ['BTC-USD'] }, { name: 'x', symbols: [12] },
    { name: 'x', symbols: ['X'.repeat(31)] }, { name: 'x', symbols: Array(101).fill('BTC') },
    { name: 'x', widgets: null }, { name: 'x', widgets: [] }, { name: 'x', widgets: ['bad'] },
    { name: 'x', widgets: ['summary', 'summary'] }, { name: 'x', days: '30' },
    { name: 'x', days: 31 }, { name: 'x', refreshSeconds: -1 }, { name: 'x', refreshSeconds: '60' }];
  for (const input of invalid) {
    assert.throws(() => validateBoard(input), { code: 'INVALID_BOARD' });
    await assert.rejects(request('POST', '/api/boards', input), { code: 'INVALID_BOARD', status: 400 });
  }
  assert.equal((await request('GET', '/api/boards')).boards.length, 1);
});

test('sample imports reject malformed batches and leave valid preceding entries unapplied', async () => {
  const request = fixture();
  const before = plain(await request('GET', '/api/boards'));
  for (const body of [null, {}, { boards: {} }, { boards: [] }, { boards: Array.from({ length: 51 }, () => ({ name: 'x' })) },
    { boards: [{ name: 'valid' }, { name: 'invalid', widgets: ['bad'] }] }]) {
    await assert.rejects(request('POST', '/api/boards/import', body), { code: 'INVALID_BOARD', status: 400 });
    assert.deepEqual(plain(await request('GET', '/api/boards')), before);
  }
  const result = await request('POST', '/api/boards/import', { boards: [{ name: 'Imported' }, { name: 'BTC', symbols: ['btc'] }] });
  assert.equal(result.boards.length, 2);
  assert.equal((await request('GET', '/api/boards')).boards.length, 3);
});

test('sample create and import enforce the 50-board capacity atomically', async () => {
  const request = fixture(49);
  await assert.rejects(request('POST', '/api/boards/import', { boards: [{ name: 'fiftieth' }, { name: 'overflow' }] }), { code: 'BOARD_LIMIT', status: 400 });
  assert.equal((await request('GET', '/api/boards')).boards.length, 49);
  await request('POST', '/api/boards', { name: 'fiftieth' });
  await assert.rejects(request('POST', '/api/boards', { name: 'overflow' }), { code: 'BOARD_LIMIT', status: 400 });
  await assert.rejects(request('POST', '/api/boards/import', { boards: [{ name: 'overflow' }] }), { code: 'BOARD_LIMIT', status: 400 });
  assert.equal((await request('GET', '/api/boards')).boards.length, 50);
});

test('sample updates preserve revision and contents on validation failure or conflict', async () => {
  const request = fixture();
  const before = plain(await request('GET', '/api/boards'));
  await assert.rejects(request('PUT', '/api/boards/board-0', { name: 'invalid', widgets: ['bad'], revision: 1 }), { code: 'INVALID_BOARD' });
  assert.deepEqual(plain(await request('GET', '/api/boards')), before);
  const updated = await request('PUT', '/api/boards/board-0', { name: 'Changed', revision: 1 });
  assert.equal(updated.revision, 2);
  await assert.rejects(request('PUT', '/api/boards/board-0', { name: 'Stale', revision: 1 }), { code: 'CONFLICT', status: 409 });
  assert.equal((await request('GET', '/api/boards')).boards[0].name, 'Changed');
  await assert.rejects(request('DELETE', '/api/boards/board-0', { revision: 2 }), { code: 'LAST_BOARD', status: 400 });
});
