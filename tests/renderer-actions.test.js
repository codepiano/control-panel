const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the renderer handler without redrawing the card, as snapshot caching does.
const source = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
const handler = source.slice(source.indexOf('async function runProjectAction('), source.indexOf('function renderProject('));
function fixture(status, action, invoke) {
  const project = { key: 'octoscope', name: 'OctoScope', status };
  const messages = [];
  let refreshes = 0;
  const context = vm.createContext({
    api: { [`${action}Project`]: invoke },
    latestPayload: { projects: [project] },
    refresh: async () => { refreshes++; },
    showBatchMessage: (message) => messages.push(message),
    statusLabel: (value) => value === 'starting' ? '启动中' : '停止中',
  });
  vm.runInContext(handler, context);
  const button = { disabled: false, textContent: '' };
  return { project, button, messages, context, refreshes: () => refreshes, run: () => context.runProjectAction(button, project, action) };
}

test('unchanged dashboard snapshots restore start, stop and restart buttons', async () => {
  for (const [status, action, label] of [['stopped', 'start', '启动'], ['running', 'stop', '停止'], ['running', 'restart', '重启']]) {
    let release;
    const f = fixture(status, action, () => new Promise((resolve) => { release = resolve; }));
    const pending = f.run();
    assert.equal(f.button.disabled, true);
    assert.equal(f.button.textContent, `${{start:'启动',stop:'停止',restart:'重启'}[action]}中…`);
    release(true);
    await pending;
    assert.equal(f.button.disabled, false);
    assert.equal(f.button.textContent, label);
    assert.equal(f.refreshes(), 1);
  }
});

test('failed service actions show the reason and remain retryable without a redraw', async () => {
  for (const action of ['start', 'stop', 'restart']) {
    const f = fixture('stopped', action, async () => { throw new Error('端口已占用'); });
    await f.run();
    assert.equal(f.button.disabled, false);
    assert.match(f.messages[0], /OctoScope .*失败：端口已占用/);
    assert.equal(f.refreshes(), 1);
  }
});

test('buttons follow the latest service state after an action', async () => {
  const f = fixture('stopped', 'start', async () => {});
  f.context.latestPayload = { projects: [{ ...f.project, status: 'starting' }] };
  await f.run();
  assert.equal(f.button.disabled, true);
  assert.equal(f.button.textContent, '启动中');
  f.context.latestPayload.projects[0].status = 'running';
  await f.run();
  assert.equal(f.button.disabled, false);
  assert.equal(f.button.textContent, '停止');
});

test('new unchecked repositories appear in the attention list', () => {
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function repositoryNeedsAttention('), source.indexOf('function repositoryStatusText(')), context);
  assert.equal(context.repositoryNeedsAttention({ status: 'unchecked' }), true);
  assert.equal(context.repositoryNeedsAttention({ status: 'synced' }), false);
});
