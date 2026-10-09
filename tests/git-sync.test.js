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
