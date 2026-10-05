const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildProjectTree, matchingProjects } = require('../src/project-tree');
const parent = { key: 'gateway', name: 'Gateway', localGroup: 'Backend' };
const child = { key: 'vault', name: 'Vault', localGroup: 'Cookies', ancestors: [{ key: 'gateway', name: 'Gateway' }] };
const sibling = { key: 'worker', name: 'Worker', ancestors: child.ancestors };

test('runtime parents retain their children across independent personal groups', () => {
  const roots = buildProjectTree([child, parent, sibling]);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].project, parent);
  assert.deepEqual(new Set(roots[0].children.map((node) => node.key)), new Set(['vault', 'worker']));
  assert.equal(matchingProjects(roots[0]).length, 3);
});

test('filtering retains ancestor context and excludes unmatched parents and siblings from batch launch', () => {
  const roots = buildProjectTree([parent, child, sibling], [], ['vault']);
  assert.equal(roots[0].key, 'gateway');
  assert.equal(roots[0].matches, false);
  assert.deepEqual(roots[0].children.map((node) => node.key), ['vault']);
  assert.deepEqual(matchingProjects(roots[0]), [child]);
});

test('nested collections add hierarchy without becoming runtimes or merging duplicate names', () => {
  const top = { key: 'workspace', name: 'Workspace' };
  const nested = { key: 'collection', name: 'Collection', ancestors: [top] };
  const ancestor = { key: 'collection', name: 'Collection' };
  const a = { key: 'a', name: 'API', ancestors: [top, ancestor] };
  const b = { key: 'b', name: 'API', ancestors: [top, ancestor] };
  const roots = buildProjectTree([a, b], [top, nested], ['a', 'b']);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].project, null);
  assert.equal(roots[0].children[0].collection, nested);
  assert.equal(roots[0].children[0].children.length, 2);
  assert.deepEqual(matchingProjects(roots[0]), [a, b]);
  assert.deepEqual(buildProjectTree([a, b], [top, nested], []), []);
});
