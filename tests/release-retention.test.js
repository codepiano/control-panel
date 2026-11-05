const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('release lifecycle preserves rollback across prepare, stop, successful and failed activation', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util, json, os, sys, tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('adapter', os.environ.get('RELEASE_ADAPTER_PATH', 'tooling/release/adapter.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as tmp:
    m.STORE = Path(tmp).resolve()
    m.ACTIVE = m.STORE / 'active.json'
    m.BUILT = m.STORE / 'built.json'
    ids = ['sha256:' + format(i, '064x') for i in range(1, 5)]
    for i, identifier in enumerate(ids):
        directory = m.artifact(identifier)
        directory.mkdir()
        ready = directory / '.release-ready.json'
        ready.write_text('{}')
        os.utime(ready, (i + 1, i + 1))
    m.verified = lambda identifier, full=False: True
    m.atomic(m.ACTIVE, dict(artifactId=ids[1], processes=[]))
    m.atomic(m.BUILT, dict(builtRevision=ids[2]))
    m.prepare = lambda: dict(builtRevision=ids[2], artifactId=ids[2])
    m.signature = lambda pid: None
    m.identities = lambda directory: [dict(pid=999999, identity='synthetic')]
    m.legacy = lambda action, directory=m.ROOT, check=True: SimpleNamespace(
        returncode=1 if action == 'status' and directory == m.ROOT else 0,
        stdout=b'', stderr=b'')
    with patch.object(m.ReleaseRetention, '_live', return_value=set()):
        sys.argv = ['adapter.py', 'prepare']
        m.main()
        assert all(m.artifact(identifier).exists() for identifier in ids[:3])
        assert not m.artifact(ids[3]).exists()  # A superseded pending build.
        m.stop()
        os.environ['PROJECT_TARGET_REVISION'] = ids[2]
        os.environ['PROJECT_ARTIFACT_ID'] = ids[2]
        sys.argv = ['adapter.py', 'activate']
        m.main()
        assert not m.artifact(ids[0]).exists()
        assert m.artifact(ids[1]).exists() and m.artifact(ids[2]).exists()
        history = json.loads((m.STORE / 'retention.json').read_text())
        assert history == dict(current=ids[2], rollback=ids[1])
        m.stop()
        m.legacy = lambda *args, **kwargs: SimpleNamespace(returncode=1, stdout=b'', stderr=b'')
        os.environ['PROJECT_TARGET_REVISION'] = ids[1]
        os.environ['PROJECT_ARTIFACT_ID'] = ids[1]
        try:
            m.activate()
            raise AssertionError('Expected failed activation')
        except RuntimeError:
            pass
        assert json.loads((m.STORE / 'retention.json').read_text()) == history
`], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, result.stderr);
});
