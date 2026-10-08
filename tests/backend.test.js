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
  core.shutdown();
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
  await core.invoke('refresh-projects');
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
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.pid, process.pid);
  assert.equal(health.launcherPid, process.ppid);
  assert.equal(health.services, 5);
  assert.ok(Number.isInteger(health.running));
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('client.js'));
  const { token } = await (await fetch(`${base}/api/session`)).json();
  const post = (headers = {}, action = 'get-dashboard-data', body = JSON.stringify({ args: [] })) => fetch(`${base}/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  assert.equal((await post()).status, 403);
  assert.equal((await post({}, 'restart-panel')).status, 403);
  assert.equal((await post({ 'X-Control-Panel-Token': token, Origin: 'https://example.com' }, 'restart-panel')).status, 403);
  const unmanagedRestart = await post({ 'X-Control-Panel-Token': token }, 'restart-panel');
  assert.equal(unmanagedRestart.status, 400);
  assert.match((await unmanagedRestart.json()).error, /启动脚本管理|启动进程身份不匹配/);
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
  await core.invoke('refresh-projects');
  const results = await core.invoke('start-projects', [[key, running]]);
  assert.equal(results[0].outcome, 'failed');
  assert.ok(results[0].detail.includes('7'));
  assert.ok(results[0].detail.includes('startup-failed'));
  assert.equal(results[1].outcome, 'skipped');
  const payload = await core.invoke('get-dashboard-data');
  assert.equal(payload.projects.find((project) => project.key === key).status, 'error');
});


test('dashboard reads share status checks across clients while explicit refresh invalidates the snapshot', async () => {
  const counter = path.join(temporary, 'status-check-count');
  const key = writeManifest(path.join(root, 'counted'), { name: 'Counted', workingDirectory: '.', statusCommand: `echo check >> '${counter}'; exit 0` });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'control-panel.json'), 'utf8'));
  manifest.children.push({ path: 'counted' }); writeManifest(root, manifest);
  await core.invoke('refresh-projects');
  const reads = await Promise.all(Array.from({ length: 8 }, () => core.invoke('get-dashboard-data')));
  assert.equal(fs.readFileSync(counter, 'utf8').trim().split('\n').length, 1);
  assert.ok(reads.every((payload) => payload.updatedAt === reads[0].updatedAt));
  assert.equal(reads[0].statusRefreshMs, 30000);
  await core.invoke('save-project-organization', [[key], { group: 'New group' }]);
  const changed = await core.invoke('get-dashboard-data');
  assert.equal(changed.projects.find((project) => project.key === key).group, 'New group');
  assert.equal(fs.readFileSync(counter, 'utf8').trim().split('\n').length, 2);
  await core.invoke('refresh-projects');
  assert.equal(fs.readFileSync(counter, 'utf8').trim().split('\n').length, 3);
});

test('duplicate local port reservations block single and batch starts and reject a new conflicting URL', async () => {
  const a = writeManifest(path.join(root, 'port-a'), { name: 'Port A', frontendUrl: 'http://localhost:54321', startCommand: 'exit 0', statusCommand: 'exit 1' });
  const b = writeManifest(path.join(root, 'port-b'), { name: 'Port B', frontendUrl: 'http://127.0.0.1:54321', startCommand: 'exit 0', statusCommand: 'exit 1' });
  const c = writeManifest(path.join(root, 'port-c'), { name: 'Port C', startCommand: 'exit 0', statusCommand: 'exit 1' });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'control-panel.json'), 'utf8'));
  manifest.children.push({ path: 'port-a' }, { path: 'port-b' }, { path: 'port-c' }); writeManifest(root, manifest);
  await core.invoke('refresh-projects');
  const payload = await core.invoke('get-dashboard-data');
  const row = payload.portReport.rows.find((row) => row.port === 54321);
  assert.equal(row.owners.length, 2);
  assert.ok(payload.projects.find((project) => project.key === a).portWarnings[0].includes('重复分配'));
  await assert.rejects(core.invoke('start-project', [a]), /已分配给 Port B/);
  const results = await core.invoke('start-projects', [[a, b]]);
  assert.ok(results.every((result) => result.outcome === 'failed'));
  await assert.rejects(core.invoke('save-project-presentation', [c, { name: 'Port C', frontendUrl: 'http://localhost:54321' }]), /已分配/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'port-c/control-panel.json'), 'utf8')).frontendUrl, undefined);
});

test('port registration persists new discoveries, serializes competing agents and reuses reservations', async () => {
  const first = path.join(temporary, 'registered-a');
  const second = path.join(temporary, 'registered-b');
  writeManifest(first, { name: 'Registered A', workingDirectory: '.', notes: 'preserve me', custom: { value: 42 } });
  writeManifest(second, { name: 'Registered B', workingDirectory: '.' });
  const results = await Promise.all([
    core.invoke('register-project-ports', [{ projectDir: first, count: 2 }]),
    core.invoke('register-project-ports', [{ projectDir: second, count: 2 }]),
  ]);
  assert.equal(new Set(results.flatMap((result) => result.ports)).size, 4);
  for (const result of results) assert.equal(result.status, 'reserved');
  const manifest = JSON.parse(fs.readFileSync(path.join(first, 'control-panel.json'), 'utf8'));
  assert.equal(manifest.notes, 'preserve me');
  assert.deepEqual(manifest.custom, { value: 42 });
  assert.deepEqual(manifest.ports, results[0].ports);
  const config = JSON.parse(fs.readFileSync(process.env.CONTROL_PANEL_CONFIG, 'utf8'));
  assert.ok(config.roots.includes(fs.realpathSync(first)));
  assert.ok(config.roots.includes(fs.realpathSync(second)));
  const again = await core.invoke('register-project-ports', [{ projectDir: first, count: 2 }]);
  assert.deepEqual(again.ports, results[0].ports);
  const inventory = await core.invoke('get-port-allocations');
  assert.ok(inventory.rows.find((row) => row.port === again.ports[0]).owners.some((owner) => owner.name === 'Registered A'));
  const before = fs.readFileSync(path.join(second, 'control-panel.json'), 'utf8');
  await assert.rejects(core.invoke('register-project-ports', [{ projectDir: second, ports: results[0].ports }]), /已分配/);
  assert.equal(fs.readFileSync(path.join(second, 'control-panel.json'), 'utf8'), before);
});

test('registration rejects real occupied ports, collections and invalid requests without reserving them', async () => {
  const net = require('node:net');
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  const directory = path.join(temporary, 'blocked-registration');
  writeManifest(directory, { name: 'Blocked', workingDirectory: '.' });
  const before = fs.readFileSync(path.join(directory, 'control-panel.json'), 'utf8');
  const configBefore = fs.readFileSync(process.env.CONTROL_PANEL_CONFIG, 'utf8');
  try {
    await assert.rejects(core.invoke('register-project-ports', [{ projectDir: directory, ports: [port] }]), /占用|EADDRINUSE/);
    assert.equal(listener.listening, true);
    for (const ports of [[0], [65536], ['4323'], [4323, 4323], []]) {
      await assert.rejects(core.invoke('register-project-ports', [{ projectDir: directory, ports }]), /ports/);
    }
    await assert.rejects(core.invoke('register-project-ports', [{ projectDir: directory, count: 0 }]), /count/);
    await assert.rejects(core.invoke('register-project-ports', [{ projectDir: '.', count: 1 }]), /绝对路径/);
    await assert.rejects(core.invoke('register-project-ports', [{ projectDir: root, count: 1 }]), /集合/);
    assert.equal(fs.readFileSync(path.join(directory, 'control-panel.json'), 'utf8'), before);
    assert.equal(fs.readFileSync(process.env.CONTROL_PANEL_CONFIG, 'utf8'), configBefore);
  } finally { await new Promise((resolve) => listener.close(resolve)); }
});

test('opening an entry propagates script errors and remains retryable', async () => {
  const directory = path.join(temporary, 'entry-test');
  const marker = path.join(directory, 'opened');
  const key = writeManifest(directory, { name: 'Entry test', workingDirectory: '.', openEntryCommand: 'echo "Node.js 24 required" >&2; exit 2' });
  await core.invoke('set-project-roots', [[...JSON.parse(fs.readFileSync(process.env.CONTROL_PANEL_CONFIG, 'utf8')).roots, directory]]);
  await assert.rejects(core.invoke('open-project-homepage', [key]), /打开 Entry test 失败.*退出码 2.*Node.js 24 required/);
  writeManifest(directory, { name: 'Entry test', workingDirectory: '.', openEntryCommand: `touch '${marker}'` });
  await core.invoke('refresh-projects');
  assert.equal(await core.invoke('open-project-homepage', [key]), true);
  assert.equal(fs.existsSync(marker), true);
});
