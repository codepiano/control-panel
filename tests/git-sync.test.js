const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createGitSync, dailySlot } = require('../src/git-sync');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-git-sync-'));
const managers = [];
after(() => { managers.forEach((manager) => manager.stop()); fs.rmSync(temporary, { recursive: true, force: true }); });
function git(directory, ...args) { return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function commit(directory, file, value) { fs.writeFileSync(path.join(directory, file), value); git(directory, 'add', file); git(directory, 'commit', '-m', value); }
function fixture(name) {
  const root = path.join(temporary, name); fs.mkdirSync(root);
  const remote = path.join(root, 'remote.git'); fs.mkdirSync(remote); git(remote, 'init', '--bare', '--initial-branch=main');
  const one = path.join(root, 'one'); const two = path.join(root, 'two');
  git(root, 'clone', remote, one);
  git(one, 'config', 'user.name', 'Test'); git(one, 'config', 'user.email', 'test@example.invalid');
  commit(one, 'file.txt', 'initial'); git(one, 'push', '-u', 'origin', 'main');
  git(root, 'clone', remote, two); git(two, 'config', 'user.name', 'Test'); git(two, 'config', 'user.email', 'test@example.invalid');
  return { root, remote, one, two };
}
function manager(f, options = {}) {
  const result = createGitSync({ statePath: path.join(f.root, 'sync-state.json'), getProjects: () => [{ key: 'project', name: 'Service', projectDir: f.one }], ...options }); managers.push(result); return result;
}
// Tests of individual operations explicitly select their fixture repositories.
async function run(service, kind, keys) {
  if (keys === undefined && ['pull', 'push'].includes(kind)) { await service.discover(); keys = service.snapshot().repositories.map((repo) => repo.key); }
  service.request(kind, keys); return service.wait();
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for Git test process');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('checks run four at a time, publish partial results, isolate failure and retain repository order', async () => {
  const fixtures = Array.from({ length: 5 }, (_, index) => fixture(`concurrent-${index}`));
  const gates = fixtures.map((f, index) => {
    const entered = path.join(f.root, 'entered'); const release = path.join(f.root, 'release');
    const script = path.join(f.root, 'upload-pack.sh');
    fs.writeFileSync(script, `#!/bin/sh\ntouch '${entered}'\nwhile [ ! -f '${release}' ]; do sleep 0.02; done\n${index === 1 ? 'echo controlled-fetch-failure >&2; exit 13' : 'exec git-upload-pack "$@"'}\n`, { mode: 0o755 });
    git(f.one, 'config', 'remote.origin.uploadpack', script);
    return { entered, release };
  });
  const service = manager(fixtures[0], { getProjects: () => fixtures.map((f, index) => ({ key: String(index), projectDir: f.one })) });
  service.request('check'); const finished = service.wait();
  try {
    await waitUntil(() => gates.slice(0, 4).every((gate) => fs.existsSync(gate.entered)));
    assert.equal(fs.existsSync(gates[4].entered), false);
    assert.equal(service.snapshot().busy, true);
    assert.equal(service.snapshot().currentRepository.split('、').length, 4);
    assert.deepEqual(service.snapshot().progress, { completed: 0, total: 5 });
    fs.writeFileSync(gates[1].release, '');
    await waitUntil(() => fs.existsSync(gates[4].entered));
    assert.equal(service.snapshot().results.length, 1);
    assert.equal(service.snapshot().results[0].outcome, 'failed');
    assert.equal(service.snapshot().progress.completed, 1);
    const persisted = JSON.parse(fs.readFileSync(path.join(fixtures[0].root, 'sync-state.json')));
    assert.equal(persisted.results[0].outcome, 'failed');
    // A simultaneous user action does not launch another job.
    service.request('push'); assert.equal(service.snapshot().operation, 'check');
  } finally {
    gates.forEach((gate) => fs.writeFileSync(gate.release, ''));
    await finished;
  }
  const state = service.snapshot();
  assert.equal(state.busy, false); assert.equal(state.currentRepository, '');
  assert.deepEqual(state.progress, { completed: 5, total: 5 });
  assert.deepEqual(state.results.map((result) => result.key), state.repositories.map((repo) => repo.key));
  assert.deepEqual(state.results.map((result) => result.outcome), ['checked', 'failed', 'checked', 'checked', 'checked']);
  assert.match(state.repositories[1].error, /controlled-fetch-failure/);
  assert.equal(state.completedSlot, null);
});

test('checks sharing a Git common directory do not overlap', async () => {
  const f = fixture('concurrent-worktrees');
  const worktree = path.join(f.root, 'worktree');
  git(f.one, 'worktree', 'add', '-b', 'worktree', worktree, 'main');
  git(worktree, 'branch', '--set-upstream-to', 'origin/main');
  const entered = path.join(f.root, 'entered'); const release = path.join(f.root, 'release');
  const lock = path.join(f.root, 'fetch-lock'); const overlap = path.join(f.root, 'overlap');
  const script = path.join(f.root, 'upload-pack.sh');
  fs.writeFileSync(script, `#!/bin/sh\nif ! mkdir '${lock}'; then touch '${overlap}'; exit 12; fi\ntouch '${entered}'\nwhile [ ! -f '${release}' ]; do sleep 0.02; done\ngit-upload-pack "$@"\nresult=$?\nrmdir '${lock}'\nexit "$result"\n`, { mode: 0o755 });
  git(f.one, 'config', 'remote.origin.uploadpack', script);
  const service = manager(f, { getProjects: () => [{ key: 'main', projectDir: f.one }, { key: 'worktree', projectDir: worktree }] });
  service.request('check'); const finished = service.wait();
  try {
    await waitUntil(() => fs.existsSync(entered));
    assert.equal(service.snapshot().currentRepository.split('、').length, 1);
  } finally { fs.writeFileSync(release, ''); await finished; }
  assert.equal(fs.existsSync(overlap), false);
  assert.deepEqual(service.snapshot().results.map((result) => result.outcome), ['checked', 'checked']);
});

test('stopping a check drains active repositories without starting queued checks', async () => {
  const f = fixture('concurrent-stop'); const second = fixture('concurrent-stop-queued');
  const entered = path.join(f.root, 'entered'); const release = path.join(f.root, 'release');
  const script = path.join(f.root, 'upload-pack.sh');
  fs.writeFileSync(script, `#!/bin/sh\ntouch '${entered}'\nwhile [ ! -f '${release}' ]; do sleep 0.02; done\nexec git-upload-pack "$@"\n`, { mode: 0o755 });
  git(f.one, 'config', 'remote.origin.uploadpack', script);
  const service = manager(f, { checkConcurrency: 1, getProjects: () => [{ key: 'one', projectDir: f.one }, { key: 'two', projectDir: second.one }] });
  service.request('check'); const finished = service.wait();
  try { await waitUntil(() => fs.existsSync(entered)); service.stop(); }
  finally { fs.writeFileSync(release, ''); await finished; }
  assert.equal(service.snapshot().busy, false);
  assert.equal(service.snapshot().results.length, 1);
  assert.equal(service.snapshot().repositories[1].checkedAt, null);
  assert.equal(service.snapshot().completedSlot, null);
});

test('check fetches without changing work files; ff-only pull and normal push synchronize two computers', async () => {
  const f = fixture('sync'); const service = manager(f);
  commit(f.two, 'file.txt', 'remote-change'); git(f.two, 'push');
  let state = await run(service, 'check');
  assert.equal(state.repositories[0].behind, 1); assert.equal(state.repositories[0].status, 'behind');
  assert.equal(fs.readFileSync(path.join(f.one, 'file.txt'), 'utf8'), 'initial');
  state = await run(service, 'pull'); assert.equal(state.results[0].outcome, 'success');
  assert.equal(fs.readFileSync(path.join(f.one, 'file.txt'), 'utf8'), 'remote-change');
  commit(f.one, 'local.txt', 'local-change');
  state = await run(service, 'push'); assert.equal(state.results[0].outcome, 'success');
  assert.equal(git(f.remote, 'rev-parse', 'main'), git(f.one, 'rev-parse', 'HEAD'));
});

test('dirty files, divergence and in-progress Git operations are skipped without overwriting either side', async () => {
  const f = fixture('blocked'); const service = manager(f);
  commit(f.two, 'remote.txt', 'remote'); git(f.two, 'push');
  fs.writeFileSync(path.join(f.one, 'file.txt'), 'unfinished');
  let state = await run(service, 'pull'); assert.equal(state.results[0].outcome, 'skipped');
  assert.match(state.results[0].detail, /未提交/); assert.equal(fs.readFileSync(path.join(f.one, 'file.txt'), 'utf8'), 'unfinished');
  git(f.one, 'restore', 'file.txt'); commit(f.one, 'local.txt', 'local');
  const head = git(f.one, 'rev-parse', 'HEAD'); const remote = git(f.remote, 'rev-parse', 'main');
  state = await run(service, 'push'); assert.equal(state.results[0].outcome, 'skipped'); assert.equal(state.repositories[0].status, 'diverged');
  assert.equal(git(f.one, 'rev-parse', 'HEAD'), head); assert.equal(git(f.remote, 'rev-parse', 'main'), remote);
  git(f.one, 'reset', '--hard', 'origin/main');
  const gitDir = git(f.one, 'rev-parse', '--absolute-git-dir'); fs.writeFileSync(path.join(gitDir, 'MERGE_HEAD'), remote);
  state = await run(service, 'pull'); assert.match(state.results[0].detail, /Git 操作/);
});

test('repositories deduplicate shared services, include independent nested repos and reject arbitrary repository keys', async () => {
  const f = fixture('inventory'); const nested = path.join(f.one, 'nested'); fs.mkdirSync(nested); git(nested, 'init', '--initial-branch=main');
  const app = path.join(f.one, 'app'); fs.mkdirSync(app);
  const service = manager(f, { getProjects: () => [{ key: 'outer', name: 'Outer', projectDir: f.one }, { key: 'same', name: 'Same', projectDir: app }, { key: 'child', name: 'Child', projectDir: nested }] });
  await service.discover(); const state = service.snapshot();
  assert.equal(state.repositories.length, 2); assert.equal(state.repositories[0].services.length, 2);
  const invalid = await run(service, 'pull', ['not-a-repository']); assert.match(invalid.error, /不属于/);
});

test('daily 03:00 checks catch up after wake/restart, persist success, and run once for each due slot', async () => {
  const f = fixture('schedule'); let date = new Date(2026, 9, 5, 2, 59);
  const service = manager(f, { now: () => date });
  await service.discover(); service.tick(); let state = await service.wait();
  assert.equal(state.completedSlot, dailySlot(date)); assert.equal(state.lastAttemptAt, date.toISOString());
  date = new Date(2026, 9, 5, 3, 0); service.tick(); state = await service.wait(); assert.equal(state.completedSlot, dailySlot(date));
  const finished = state.lastFinishedAt;
  date = new Date(2026, 9, 5, 12, 0); service.tick(); state = await service.wait(); assert.equal(state.lastFinishedAt, finished);
  const restarted = manager(f, { now: () => date }); await restarted.discover(); restarted.tick(); assert.equal(restarted.snapshot().busy, false);
  date = new Date(2026, 9, 7, 10, 0); restarted.tick(); state = await restarted.wait(); assert.equal(state.completedSlot, dailySlot(date));
  assert.equal(state.lastAttemptAt, date.toISOString()); assert.equal(state.results.length, 1);
});

test('failed daily checks retain failure and retry after backoff without treating remote data as current', async () => {
  const f = fixture('retry'); let date = new Date(2026, 9, 5, 4, 0); const service = manager(f, { now: () => date });
  git(f.one, 'remote', 'set-url', 'origin', path.join(f.root, 'missing.git'));
  service.tick(); let state = await service.wait(); assert.equal(state.repositories[0].status, 'error'); assert.equal(state.completedSlot, null);
  date = new Date(2026, 9, 5, 4, 10); service.tick(); assert.equal(service.snapshot().busy, false);
  git(f.one, 'remote', 'set-url', 'origin', f.remote); date = new Date(2026, 9, 5, 4, 16);
  service.tick(); state = await service.wait(); assert.equal(state.completedSlot, dailySlot(date)); assert.equal(state.repositories[0].error, '');
});


test('detached HEAD, missing tracking branches and untracked files cannot be published automatically', async () => {
  const f = fixture('branches'); const service = manager(f);
  git(f.one, 'config', 'status.showUntrackedFiles', 'no');
  fs.writeFileSync(path.join(f.one, 'untracked.txt'), 'unfinished');
  const dirty = await run(service, 'push'); assert.equal(dirty.repositories[0].dirty, 1); assert.match(dirty.results[0].detail, /未提交/);
  fs.unlinkSync(path.join(f.one, 'untracked.txt'));
  git(f.one, 'checkout', '--detach');
  let state = await run(service, 'push'); assert.equal(state.repositories[0].status, 'detached'); assert.equal(state.results[0].outcome, 'skipped');
  git(f.one, 'checkout', '-b', 'unpublished');
  state = await run(service, 'push'); assert.equal(state.repositories[0].status, 'untracked'); assert.equal(state.results[0].outcome, 'skipped');
  assert.equal(git(f.remote, 'branch', '--list', 'unpublished'), '');
});


test('a failed push keeps remote history intact and does not stop other repositories', async () => {
  const first = fixture('failed-push'); const second = fixture('continued-push');
  commit(first.one, 'first.txt', 'first'); commit(second.one, 'second.txt', 'second');
  const previous = git(first.remote, 'rev-parse', 'main');
  const hook = path.join(first.remote, 'hooks/pre-receive'); fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const service = manager(first, { getProjects: () => [{ key: 'one', name: 'One', projectDir: first.one }, { key: 'two', name: 'Two', projectDir: second.one }] });
  const state = await run(service, 'push');
  assert.deepEqual(state.results.map((result) => result.outcome), ['failed', 'success']);
  assert.equal(git(first.remote, 'rev-parse', 'main'), previous);
  assert.equal(git(second.remote, 'rev-parse', 'main'), git(second.one, 'rev-parse', 'HEAD'));
});

test('process all only selects scanned actionable repositories and leaves other snapshots untouched', async () => {
  const pull = fixture('all-pull');
  const push = fixture('all-push');
  const dirty = fixture('all-dirty');
  const diverged = fixture('all-diverged');
  commit(pull.two, 'remote.txt', 'pull-new'); git(pull.two, 'push');
  commit(push.one, 'local.txt', 'push-new');
  commit(dirty.two, 'remote.txt', 'dirty-remote'); git(dirty.two, 'push');
  fs.writeFileSync(path.join(dirty.one, 'file.txt'), 'unfinished');
  commit(diverged.two, 'remote.txt', 'diverged-remote'); git(diverged.two, 'push');
  commit(diverged.one, 'local.txt', 'diverged-local');
  const dirtyHead = git(dirty.one, 'rev-parse', 'HEAD');
  const localHead = git(diverged.one, 'rev-parse', 'HEAD');
  const remoteHead = git(diverged.remote, 'rev-parse', 'main');
  const service = manager(pull, { getProjects: () => [pull, push, dirty, diverged].map((f, index) => ({ key: String(index), projectDir: f.one })) });
  const scanned = await run(service, 'check');
  const untouched = scanned.repositories.slice(2);
  const state = await run(service, 'sync');
  assert.equal(state.operation, 'sync');
  assert.deepEqual(state.results.map((item) => [item.outcome, item.detail]), [
    ['success', '已快进更新'], ['success', '已推送'],
  ]);
  assert.equal(git(pull.one, 'rev-parse', 'HEAD'), git(pull.remote, 'rev-parse', 'main'));
  assert.equal(git(push.one, 'rev-parse', 'HEAD'), git(push.remote, 'rev-parse', 'main'));
  assert.equal(git(dirty.one, 'rev-parse', 'HEAD'), dirtyHead);
  assert.equal(fs.readFileSync(path.join(dirty.one, 'file.txt'), 'utf8'), 'unfinished');
  assert.equal(git(diverged.one, 'rev-parse', 'HEAD'), localHead);
  assert.equal(git(diverged.remote, 'rev-parse', 'main'), remoteHead);
  assert.deepEqual(state.repositories.slice(2), untouched);
  const again = await run(service, 'sync');
  assert.deepEqual(again.results, []);
});

test('bulk sync does not fetch synced or newly discovered unchecked repositories', async () => {
  const synced = fixture('bulk-synced'); const pending = fixture('bulk-pending'); const unchecked = fixture('bulk-unchecked');
  let projects = [synced, pending].map((f, index) => ({ key: String(index), projectDir: f.one }));
  const service = manager(synced, { getProjects: () => projects });
  commit(pending.two, 'remote.txt', 'pending'); git(pending.two, 'push');
  const scanned = await run(service, 'check');
  const before = scanned.repositories.find((repo) => repo.status === 'synced');
  git(synced.one, 'remote', 'set-url', 'origin', path.join(synced.root, 'missing.git'));
  git(unchecked.one, 'remote', 'set-url', 'origin', path.join(unchecked.root, 'missing.git'));
  projects = [...projects, { key: 'new', projectDir: unchecked.one }];
  const result = await run(service, 'sync');
  assert.deepEqual(result.results.map((item) => item.outcome), ['success']);
  assert.deepEqual(result.repositories.find((repo) => repo.key === before.key), before);
  const newRepo = result.repositories.find((repo) => repo.directory === fs.realpathSync(unchecked.one));
  assert.equal(newRepo.status, 'unchecked'); assert.equal(newRepo.checkedAt, null);
});

test('newly registered repositories are discovered and checked after the daily scan already completed', async () => {
  const existing = fixture('discovery-existing'); const added = fixture('discovery-added');
  const date = new Date(2026, 9, 13, 10, 0);
  let projects = [{ key: 'existing', projectDir: existing.one }];
  const service = manager(existing, { now: () => date, getProjects: () => projects });
  await run(service, 'check');
  const previous = service.snapshot().repositories[0];
  commit(added.one, 'local.txt', 'unpublished');
  projects.push({ key: 'added', projectDir: added.one });
  await service.refresh();
  assert.equal(service.snapshot().repositories.length, 2);
  assert.equal(service.snapshot().repositories[1].status, 'unchecked');
  assert.equal(service.snapshot().busy, false); // autoStart is disabled in this fixture.
  service.tick();
  const state = await service.wait();
  assert.equal(state.busy, false);
  assert.equal(state.repositories[1].status, 'ahead');
  assert.equal(state.repositories[1].ahead, 1);
  assert.deepEqual(state.repositories[0], previous);
  assert.deepEqual(state.results.map((item) => item.key), [state.repositories[1].key]);
  assert.equal(git(added.remote, 'rev-parse', 'main'), git(added.one, 'rev-parse', 'HEAD~1'));
});

test('a new repository failing after a completed scan still retries with backoff', async () => {
  const existing = fixture('new-retry-existing'); const added = fixture('new-retry-added');
  let date = new Date(2026, 9, 13, 10, 0);
  const projects = [{ key: 'existing', projectDir: existing.one }];
  const service = manager(existing, { now: () => date, getProjects: () => projects });
  await run(service, 'check');
  git(added.one, 'remote', 'set-url', 'origin', path.join(added.root, 'missing.git'));
  projects.push({ key: 'added', projectDir: added.one });
  await service.refresh(); service.tick();
  const failed = await service.wait();
  assert.equal(failed.completedSlot, null);
  assert.equal(failed.repositories[1].status, 'error');
  service.tick(); assert.equal(service.snapshot().busy, false);
  git(added.one, 'remote', 'set-url', 'origin', added.remote);
  date = new Date(2026, 9, 13, 10, 16); service.tick();
  const retried = await service.wait();
  assert.equal(retried.repositories[1].error, '');
  assert.equal(retried.completedSlot, dailySlot(date));
  assert.deepEqual(retried.results.map((item) => item.key), [retried.repositories[1].key]);
});

test('bulk pull and push select only scanned matching direction and still recheck local changes', async () => {
  const pull = fixture('bulk-direction-pull'); const push = fixture('bulk-direction-push');
  commit(pull.two, 'remote.txt', 'pull'); git(pull.two, 'push');
  commit(push.one, 'local.txt', 'push');
  const service = manager(pull, { getProjects: () => [pull, push].map((f, index) => ({ key: String(index), projectDir: f.one })) });
  await run(service, 'check');
  fs.writeFileSync(path.join(pull.one, 'file.txt'), 'changed-after-scan');
  service.request('pull'); const pulled = await service.wait();
  assert.deepEqual(pulled.results.map((item) => item.outcome), ['skipped']);
  assert.match(pulled.results[0].detail, /未提交/);
  assert.equal(fs.readFileSync(path.join(pull.one, 'file.txt'), 'utf8'), 'changed-after-scan');
  service.request('push'); const pushed = await service.wait();
  assert.deepEqual(pushed.results.map((item) => item.outcome), ['success']);
  assert.equal(git(push.remote, 'rev-parse', 'main'), git(push.one, 'rev-parse', 'HEAD'));
});

test('a pull that becomes diverged reports the skipped reason through later scans and restart', async () => {
  const blocked = fixture('report-diverged'); const healthy = fixture('report-healthy');
  commit(blocked.two, 'remote.txt', 'remote'); git(blocked.two, 'push');
  commit(healthy.two, 'remote.txt', 'healthy'); git(healthy.two, 'push');
  const options = { getProjects: () => [blocked, healthy].map((f, index) => ({ key: String(index), projectDir: f.one })) };
  const service = manager(blocked, options);
  await run(service, 'check');
  commit(blocked.one, 'local.txt', 'local-after-scan');
  const localHead = git(blocked.one, 'rev-parse', 'HEAD');
  const state = await run(service, 'sync');
  assert.deepEqual(state.lastSync.results.map((item) => item.outcome), ['skipped', 'success']);
  assert.match(state.lastSync.results[0].detail, /分叉/);
  assert.equal(state.repositories[0].lastSyncResult.outcome, 'skipped');
  assert.equal(git(blocked.one, 'rev-parse', 'HEAD'), localHead);
  const recorded = state.lastSync;
  const result = state.repositories[0].lastSyncResult;
  const checked = await run(service, 'check');
  assert.deepEqual(checked.lastSync, recorded);
  assert.deepEqual(checked.repositories[0].lastSyncResult, result);
  const restarted = manager(blocked, options); await restarted.discover();
  assert.deepEqual(restarted.snapshot().lastSync, recorded);
  assert.deepEqual(restarted.snapshot().repositories[0].lastSyncResult, result);
});

test('Git command failures preserve the final error, redact credentials and survive checks and restart', async () => {
  const f = fixture('report-command-failure');
  commit(f.one, 'local.txt', 'local');
  const previous = git(f.remote, 'rev-parse', 'main');
  const hook = path.join(f.remote, 'hooks/pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\nprintf "%s\\n" "https://user:secret@example.invalid/repo" >&2\ni=0\nwhile [ "$i" -lt 500 ]; do printf "progress output %s\\n" "$i" >&2; i=$((i+1)); done\nprintf "%s\\n" "fatal: final rejection reason" >&2\nexit 1\n', { mode: 0o755 });
  const service = manager(f);
  const state = await run(service, 'push');
  assert.equal(state.lastSync.results[0].outcome, 'failed');
  const detail = state.lastSync.results[0].detail;
  assert.match(detail, /git push 失败.*退出码/);
  assert.match(detail, /final rejection reason/);
  assert.ok(!detail.includes('user:secret'));
  assert.match(detail, /输出已截断/);
  assert.equal(git(f.remote, 'rev-parse', 'main'), previous);
  const checked = await run(service, 'check');
  assert.equal(checked.repositories[0].error, '');
  assert.equal(checked.repositories[0].lastSyncResult.detail, detail);
  const restarted = manager(f);
  assert.equal(restarted.snapshot().lastSync.results[0].detail, detail);
});
