const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('old Corepack fails before attempting to start pnpm 12', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-corepack-'));
  try {
    const marker = path.join(temporary, 'pnpm-started');
    fs.writeFileSync(path.join(temporary, 'corepack'),
      `#!/bin/sh\nif [ "$1" = --version ]; then echo 0.23.0; else touch '${marker}'; fi\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, ['scripts/check-toolchain.cjs'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${temporary}:${process.env.PATH}` },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Requires Corepack 0.36.0/);
    assert.equal(fs.existsSync(marker), false);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('release build uses isolated pnpm 12 configuration and preserves npm cache', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util, os, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('release_adapter', 'tooling/release/adapter.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as directory:
    module.STORE = Path(directory) / 'release'
    keys = ('production', 'store_dir', 'enable_global_virtual_store', 'package_import_method')
    for key in keys:
        os.environ['npm_config_' + key] = 'legacy'
    env = module.build_env(Path(directory))
    assert all('npm_config_' + key not in env for key in keys)
    assert env['pnpm_config_production'] == 'false'
    assert env['pnpm_config_enable_global_virtual_store'] == 'false'
    assert env['pnpm_config_package_import_method'] == 'copy'
    for key in ('pnpm_config_store_dir', 'pnpm_config_cache_dir', 'npm_config_cache', 'COREPACK_HOME', 'PNPM_HOME'):
        assert Path(env[key]).is_relative_to(directory), key
`], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, result.stderr);
});
