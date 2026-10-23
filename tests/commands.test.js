const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execCommand } = require('../src/commands');

test('deadline settles and kills a command whose child retains the output pipe', async () => {
  const started = Date.now();
  const result = await execCommand('sleep 30 & wait', process.cwd(), { timeoutMs: 100 });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /命令超时/);
  assert.ok(Date.now() - started < 2000);
});

test('lifecycle commands can use a separate budget and retain failure output', async () => {
  const result = await execCommand('sleep .2; echo stop-refused >&2; exit 7', process.cwd(), { timeoutMs: 2000 });
  assert.equal(result.code, 7);
  assert.match(result.stderr, /stop-refused/);
});
