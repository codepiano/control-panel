const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFile, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-lifecycle-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  for (const file of ['start.sh', 'stop.sh', 'status.sh', 'restart.sh', 'run.sh', 'startup-info.js']) {
    fs.copyFileSync(path.join(__dirname, '../scripts', file), path.join(root, 'scripts', file));
  }
  return root;
}

test('public lifecycle scripts use releases without source dist, including inherited runtime environments', () => {
  const root = fixture();
  try {
    for (const action of ['start', 'stop', 'status', 'restart']) {
      fs.writeFileSync(path.join(root, `scripts/release-${action}.sh`), `#!/bin/sh\nprintf '%s\\n' '${action}' "$@"\n`, { mode: 0o755 });
      for (const marker of ['', '/another/release']) {
        const result = spawnSync('/bin/bash', [path.join(root, `scripts/${action}.sh`), '--hidden', 'argument with spaces'], {
          encoding: 'utf8', cwd: os.tmpdir(),
          env: { ...process.env, CONTROL_PANEL_RUNTIME_ROOT: marker, PROJECT_RELEASE_ORIGIN: root },
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, `${action}\n--hidden\nargument with spaces\n`);
      }
    }
    assert.equal(fs.existsSync(path.join(root, 'dist')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('adapter supplies an exact directory marker only to its runtime invocation', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('adapter', 'tooling/release/adapter.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as directory:
    module.run = lambda args, **kwargs: kwargs
    value = module.legacy('status', Path(directory), check=False)
    assert value['env']['CONTROL_PANEL_RUNTIME_ROOT'] == directory
    assert value['cwd'] == Path(directory)
    assert value['check'] is False
`], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, result.stderr);
});

test('runtime launch consumes its marker and retains working status and stop commands', async () => {
  const root = fixture();
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const env = { ...process.env, CONTROL_PANEL_RUNTIME_ROOT: root, CONTROL_PANEL_NODE: process.execPath,
    CONTROL_PANEL_PORT: String(port), CONTROL_PANEL_DATA: path.join(root, 'data'), CONTROL_PANEL_CONFIG: path.join(root, 'config.json') };
  const run = action => exec('/bin/bash', [path.join(root, `scripts/${action}.sh`)], { env, timeout: 20000 });
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/server.js'), `
require('node:http').createServer((req, res) => res.end(JSON.stringify({
  status: 'running', pid: process.pid, launcherPid: process.ppid, uptimeSec: 1,
  services: 0, running: 0, issues: 0, marker: process.env.CONTROL_PANEL_RUNTIME_ROOT || null,
}))).listen(Number(process.env.CONTROL_PANEL_PORT), '127.0.0.1');
`);
  try {
    assert.match((await run('start')).stdout, /控制面板已就绪/);
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.marker, null);
    assert.match((await run('status')).stdout, /运行中/);
    assert.match((await run('stop')).stdout, /已停止/);
    await assert.rejects(run('status'), error => error.code === 1);
  } finally {
    await run('stop').catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});
