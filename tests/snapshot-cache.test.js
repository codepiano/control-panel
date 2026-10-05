const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSnapshotCache } = require('../src/snapshot-cache');

test('clients share a single scan and cache expires after thirty seconds', async () => {
  let time = 0;
  let scans = 0;
  const cache = createSnapshotCache(async () => ({ scan: ++scans }), { now: () => time });
  const clients = await Promise.all(Array.from({ length: 10 }, () => cache.get()));
  assert.equal(scans, 1);
  assert.ok(clients.every((value) => value === clients[0]));
  time = 29999;
  assert.equal((await cache.get()).scan, 1);
  time = 30000;
  assert.equal((await cache.get()).scan, 2);
  assert.equal((await cache.get({ force: true })).scan, 3);
});

test('an operation during a scan waits for a fresh snapshot and never publishes the older result', async () => {
  let release;
  let scans = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const cache = createSnapshotCache(async () => {
    const scan = ++scans;
    if (scan === 1) await gate;
    return { scan };
  });
  const first = cache.get();
  await Promise.resolve();
  const forced = cache.get({ force: true });
  const second = cache.get();
  release();
  const clients = await Promise.all([first, forced, second]);
  assert.equal(scans, 2);
  assert.deepEqual(clients.map((value) => value.scan), [2, 2, 2]);
});

test('a failed scan can be retried without locking the cache', async () => {
  let scans = 0;
  const cache = createSnapshotCache(async () => {
    if (++scans === 1) throw new Error('status unavailable');
    return { scan: scans };
  });
  await assert.rejects(cache.get(), /status unavailable/);
  assert.equal((await cache.get()).scan, 2);
});
