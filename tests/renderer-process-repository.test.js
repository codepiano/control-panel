const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
const update = source.slice(source.indexOf('function updateRepositoryIndicators()'), source.indexOf('function repositoryNeedsAttention('));

test('owned processes omit inherited repository badges while independent child repos retain theirs', () => {
  const cards = ['parent', 'process', 'independent', 'deep-process'].map(key => ({
    dataset: { key }, badges: [], staleRemoved: false,
    querySelector(selector) { return selector === '.repository-indicator' ? { remove: () => { this.staleRemoved = true; } } : { appendChild: badge => this.badges.push(badge) }; },
  }));
  const repository = { key: 'repo', name: 'Parent', services: [{ key: 'parent' }, { key: 'process' }, { key: 'deep-process' }] };
  const context = vm.createContext({
    repositoryPayload: { repositories: [repository, { key: 'own-repo', services: [{ key: 'independent' }] }] },
    latestPayload: { projects: [
      { key: 'parent', ancestors: [] },
      { key: 'process', ancestors: [{ key: 'parent' }] },
      { key: 'independent', ancestors: [{ key: 'parent' }] },
      { key: 'deep-process', ancestors: [{ key: 'parent' }, { key: 'process' }] },
    ] },
    els: { list: { querySelectorAll: () => cards } },
    document: { createElement: () => ({ classList: { toggle() {} }, setAttribute() {}, addEventListener() {} }) },
    repositoryNeedsAttention: () => true, repositoryStatusText: () => '待推送', formatTimestamp: () => '',
  });
  vm.runInContext(update, context); context.updateRepositoryIndicators();
  assert.deepEqual(cards.map(c => c.badges.length), [1, 0, 1, 0]);
  assert.ok(cards.every(c => c.staleRemoved));
});
