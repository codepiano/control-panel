const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'control-panel-test-'));
process.env.CONTROL_PANEL_DATA = path.join(temporary, 'data');
process.env.CONTROL_PANEL_CONFIG = path.join(temporary, 'projects.json');
const core = require('../src/backend');
const { createServer } = require('../src/server');
const root = path.join(temporary, 'workspace');
const writeManifest = (directory, manifest) => {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'control-panel.json'), JSON.stringify(manifest));
  return `manifest:${path.join(directory, 'control-panel.json')}`;
};
const running = writeManifest(path.join(root, 'repos', 'one', 'api'), { id: 'shared', name: 'API', workingDirectory: '.', startCommand: 'exit 0', statusCommand: 'exit 0' });
const marker = path.join(temporary, 'started');
const worker = writeManifest(path.join(root, 'repos', 'two', 'apps', 'worker'), { id: 'shared', name: 'Worker', workingDirectory: '.', startCommand: `printf started > '${marker}'`, statusCommand: `test -f '${marker}'` });
const failed = writeManifest(path.join(root, 'broken'), { name: 'Broken', workingDirectory: './not-present', startCommand: 'exit 0', statusCommand: 'exit 1' });
const noStart = writeManifest(path.join(root, 'observed'), { name: 'Observed', workingDirectory: '.', statusCommand: 'exit 1' });
const unrelated = writeManifest(path.join(root, 'unlisted', 'deep'), { name: 'Unlisted', workingDirectory: '.', startCommand: 'exit 0' });
const external = path.join(temporary, 'outside');
writeManifest(external, { name: 'Outside', workingDirectory: '.' });
fs.symlinkSync(external, path.join(root, 'escape'));
writeManifest(root, { id: 'workspace', name: 'Workspace', kind: 'collection', children: [
  { path: 'repos/one/api', role: 'api', notes: 'Backend' },
  { path: 'repos/two/apps/worker', role: 'worker' },
  { path: 'broken' }, { path: 'observed' }, { path: 'missing' }, { path: '../outside' }, { path: 'escape' }, { path: '.' },
] });
fs.writeFileSync(process.env.CONTROL_PANEL_CONFIG, JSON.stringify({ roots: [path.join(root, 'repos/one/api'), root], scan: { maxDepth: 0 }, projectPreferences: { [worker]: { startOnPanelLaunch: true, tags: [' existing ', 'existing'], favorite: true } } }));
let server;
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('declared children preserve structure, skip undeclared deep services, deduplicate overlapping roots and report bad paths', async () => {
  await core.initialize({ autoStart: false });
  const payload = await core.invoke('get-dashboard-data');
  assert.equal(payload.projects.length, 4);
  assert.equal(payload.scanReport.collections.length, 1);
  assert.equal(payload.scanReport.issues.length, 4);
  assert.ok(!payload.projects.some((project) => project.key === unrelated));
  assert.equal(payload.projects.find((project) => project.key === running).relationship.role, 'api');
  assert.equal(payload.projects.find((project) => project.key === worker).group, 'Workspace');
  assert.equal(payload.projects.filter((project) => project.id === 'shared').length, 2);
});

test('personal organization is persisted without touching child manifests or other preferences', async () => {
  const before = fs.readFileSync(path.join(root, 'repos/two/apps/worker/control-panel.json'), 'utf8');
  await core.invoke('save-project-organization', [[running, worker], { group: 'Research' }]);
  const config = JSON.parse(fs.readFileSync(process.env.CONTROL_PANEL_CONFIG, 'utf8'));
  assert.equal(config.projectPreferences[worker].startOnPanelLaunch, true);
  assert.deepEqual(config.projectPreferences[worker].tags, ['existing']);
  assert.equal(config.projectPreferences[worker].favorite, true);
  assert.equal(config.projectPreferences[running].group, 'Research');
  assert.equal(before, fs.readFileSync(path.join(root, 'repos/two/apps/worker/control-panel.json'), 'utf8'));
  await core.invoke('save-project-organization', [[worker], { tags: [' database ', 'database', ''], favorite: false }]);
  const payload = await core.invoke('get-dashboard-data');
  assert.deepEqual(payload.projects.find((project) => project.key === worker).tags, ['database']);
  await assert.rejects(core.invoke('save-project-organization', [[worker], { group: 'x'.repeat(41) }]));
  await assert.rejects(core.invoke('save-project-organization', [[worker, 'missing'], { group: 'Must not save' }]));
  assert.equal(JSON.parse(fs.readFileSync(process.env.CONTROL_PANEL_CONFIG, 'utf8')).projectPreferences[worker].group, 'Research');
});

test('batch launch skips running services, deduplicates keys and continues after a spawn error', async () => {
  const results = await core.invoke('start-projects', [[running, failed, noStart, worker, worker]]);
  assert.deepEqual(results.map((result) => result.outcome), ['skipped', 'failed', 'skipped', 'started']);
  for (let retry = 0; retry < 30 && !fs.existsSync(marker); retry++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fs.readFileSync(marker, 'utf8'), 'started');
  const again = await core.invoke('start-projects', [[worker]]);
  assert.equal(again[0].outcome, 'skipped');
});

test('nested collections are not counted as runtimes and collection lifecycle declarations are rejected', async () => {
  const nested = path.join(root, 'nested');
  writeManifest(nested, { name: 'Nested', kind: 'collection', children: [{ path: 'service', role: 'frontend' }] });
  writeManifest(path.join(nested, 'service'), { name: 'Nested service', workingDirectory: '.', statusCommand: 'exit 1' });
  writeManifest(path.join(root, 'invalid'), { name: 'Invalid collection', kind: 'collection', startCommand: 'exit 0' });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'control-panel.json'), 'utf8'));
  manifest.children.push({ path: 'nested' }, { path: 'invalid' });
  writeManifest(root, manifest);
  const payload = await core.invoke('get-dashboard-data');
  assert.equal(payload.scanReport.collections.length, 2);
  assert.equal(payload.projects.length, 5);
  assert.equal(payload.projects.find((project) => project.name === 'Nested service').group, 'Workspace / Nested');
  assert.ok(payload.scanReport.issues.some((issue) => issue.detail.includes('集合不能声明')));
});

test('web API serves the browser and enforces session, host, origin and static allowlist', async () => {
  server = await createServer({ autoStart: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('client.js'));
  const { token } = await (await fetch(`${base}/api/session`)).json();
  const post = (headers = {}, action = 'get-dashboard-data', body = JSON.stringify({ args: [] })) => fetch(`${base}/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  assert.equal((await post()).status, 403);
  assert.equal((await post({ 'X-Control-Panel-Token': token, Origin: 'https://example.com' })).status, 403);
  const rejectedHost = await new Promise((resolve, reject) => {
    const request = require('node:http').get(`${base}/api/session`, { headers: { Host: 'attacker.example' } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(rejectedHost, 403);
  assert.equal((await post({ 'X-Control-Panel-Token': token }, 'run-shell')).status, 400);
  assert.equal((await post({ 'X-Control-Panel-Token': token }, 'get-dashboard-data', '{')).status, 400);
  const response = await post({ 'X-Control-Panel-Token': token, Origin: base });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.projects.length, 5);
  assert.equal((await fetch(`${base}/backend.js`)).status, 404);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
});


test('batch launch reports lifecycle wrapper exit failures and keeps subsequent services discoverable', async () => {
  const key = writeManifest(path.join(root, 'fails-fast'), { name: 'Fails fast', workingDirectory: '.', startCommand: 'echo startup-failed >&2; exit 7', statusCommand: 'exit 1' });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'control-panel.json'), 'utf8'));
  manifest.children.push({ path: 'fails-fast' }); writeManifest(root, manifest);
  await core.invoke('get-dashboard-data');
  const results = await core.invoke('start-projects', [[key, running]]);
  assert.equal(results[0].outcome, 'failed');
  assert.ok(results[0].detail.includes('7'));
  assert.ok(results[0].detail.includes('startup-failed'));
  assert.equal(results[1].outcome, 'skipped');
  const payload = await core.invoke('get-dashboard-data');
  assert.equal(payload.projects.find((project) => project.key === key).status, 'error');
});
