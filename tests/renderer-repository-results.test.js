const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
const render = source.slice(source.indexOf('const repositoryLabels ='), source.indexOf('async function readRepositorySync()'));
function element() {
  return { children: [], textContent: '', className: '', dataset: {}, style: { setProperty() {} }, classList: { toggle() {} },
    append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); },
    replaceChildren() { this.children = []; }, setAttribute() {}, addEventListener() {} };
}
function fixture() {
  const repoEls = new Proxy({}, { get(target, name) { return target[name] ||= element(); } });
  const context = vm.createContext({ repoEls, document: { createElement: element }, repositoryView: 'all', repositoryFocusKey: null,
    updateRepositoryIndicators() {}, formatTimestamp: (value) => value || '-', runRepositoryAction() {} });
  vm.runInContext(render + '\n' + source.slice(source.indexOf('function repositoryNeedsAttention(')), context);
  return { repoEls, context, render: (payload) => context.renderRepositorySync(payload) };
}
function texts(node) { return [node.textContent, ...node.children.flatMap(texts)].filter(Boolean).join('\n'); }

test('repository UI keeps sync failure and skipped causes visible after a fresh scan', () => {
  const f = fixture();
  const failed = { key: 'mac-tool', name: 'mac-tool', outcome: 'failed', detail: 'git merge 失败：final rejection reason' };
  const skipped = { key: 'other', name: 'other', outcome: 'skipped', detail: '分支已分叉，需要先处理合并' };
  const payload = { operation: 'check', repositories: [{ key: 'mac-tool', name: 'mac-tool', services: [], status: 'synced', directory: '/tmp/mac-tool', lastSyncResult: { ...failed, at: 'earlier' } }],
    lastSync: { results: [failed, skipped], finishedAt: 'earlier' }, results: [{ key: 'mac-tool', name: 'mac-tool', outcome: 'checked', detail: '最新检查完成' }] };
  f.render(payload);
  assert.equal(f.repoEls.repositoryOperationSummary.hidden, false);
  assert.match(f.repoEls.repositoryOperationSummary.textContent, /失败 1.*跳过 1/);
  assert.match(texts(f.repoEls.repositoryList), /final rejection reason/);
  assert.match(texts(f.repoEls.repositoryResults), /final rejection reason/);
  assert.match(texts(f.repoEls.repositoryResults), /分支已分叉/);
  assert.match(texts(f.repoEls.repositoryResults), /最新检查完成/);
  f.render({ ...payload, results: [{ name: 'mac-tool', outcome: 'failed', detail: '新的 fetch 错误' }] });
  assert.match(texts(f.repoEls.repositoryResults), /新的 fetch 错误/);
  assert.match(texts(f.repoEls.repositoryResults), /final rejection reason/);
});

test('legacy snapshots render current failures without requiring sync history', () => {
  const f = fixture();
  f.render({ operation: 'pull', repositories: [], results: [{ name: 'mac-tool', outcome: 'failed', detail: '旧格式错误' }] });
  assert.match(texts(f.repoEls.repositoryResults), /旧格式错误/);
  assert.equal(f.repoEls.repositoryOperationSummary.hidden, true);
});

test('concurrent checks show active repositories and completed progress', () => {
  const f = fixture();
  f.render({ busy: true, operation: 'check', currentRepository: 'one、two', progress: { completed: 3, total: 8 }, repositories: [], results: [] });
  assert.match(f.repoEls.repositorySyncStatus.textContent, /正在检查：one、two.*已完成 3\/8/);
});

test('pinned submodules explain parent ownership and do not request intervention unless dirty', () => {
  const f = fixture();
  const repo = { key: 'child', name: 'child', services: [], status: 'pinned', directory: '/tmp/parent/child', head: 'abcdef123456', checkedAt: 'now' };
  f.render({ repositories: [repo], results: [] });
  assert.equal(f.repoEls.repositoryAttentionBtn.textContent, '需要处理 0');
  assert.match(texts(f.repoEls.repositoryList), /由父仓库管理 · abcdef12/);
  assert.match(texts(f.repoEls.repositoryList), /无需操作/);
  assert.doesNotMatch(texts(f.repoEls.repositoryList), /等待检查分支|先切换/);
  f.render({ repositories: [{ ...repo, dirty: 1 }], results: [] });
  assert.equal(f.repoEls.repositoryAttentionBtn.textContent, '需要处理 1');
  assert.match(texts(f.repoEls.repositoryList), /未提交 1 项/);
});


test('project view keeps only the selected repository visible across polling', () => {
  const f = fixture();
  f.context.repositoryView = 'project';
  f.context.repositoryFocusKey = 'target';
  const payload = { repositories: [
    { key: 'other', name: 'Other', services: [], status: 'synced' },
    { key: 'target', name: 'Target', services: [], status: 'synced' },
  ], results: [{ key: 'other', name: 'Other result', outcome: 'checked', detail: 'Other details' }], lastSync: { results: [{ key: 'other', name: 'Other sync', outcome: 'success' }] } };
  f.render(payload);
  assert.doesNotMatch(texts(f.repoEls.repositoryResults), /Other/);
  assert.equal(f.repoEls.repositoryOperationSummary.hidden, true);
  assert.equal(f.repoEls.repositoryList.children.length, 1);
  assert.match(texts(f.repoEls.repositoryList), /Target/);
  assert.doesNotMatch(texts(f.repoEls.repositoryList), /Other/);
  assert.equal(f.repoEls.repositoryProjectBtn.textContent, '当前项目 · Target');
  f.render(payload);
  assert.equal(f.repoEls.repositoryList.children.length, 1);
});
