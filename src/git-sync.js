const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

function git(directory, args, options = []) {
  return new Promise((resolve, reject) => execFile('git', ['-C', directory, ...options, ...args], {
    timeout: 45000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes -o ConnectTimeout=10' },
  }, (error, stdout, stderr) => {
    if (!error) return resolve(stdout.trim());
    const failure = new Error(gitFailure(args[0], error, stdout, stderr));
    const output = `${stderr || ''}\n${stdout || ''}`;
    const permanent = /permission denied|authentication failed|repository not found|host key verification failed|certificate (?:verification failed|problem)|unable to get local issuer certificate|cannot lock ref|couldn't find remote ref/i.test(output);
    failure.retryable = !permanent && (error.killed === true || /connection (?:closed|reset|refused)|(?:connection|operation) timed out|could not resolve (?:host|hostname)|temporary failure in name resolution|failed to connect|couldn't connect|network is unreachable|no route to host|remote end hung up|early EOF|SSL connect error|TLS connection was non-properly terminated|(?:HTTP[^\n]*|returned error:)\s(?:408|429|500|502|503|504)\b/i.test(output));
    reject(failure);
  }));
}

async function fetchWithRetry(directory, remote, shouldContinue) {
  const delays = [1000, 2000];
  for (let attempt = 0; ; attempt++) {
    try { return await git(directory, ['fetch', '--prune', '--no-tags', '--no-recurse-submodules', remote]); }
    catch (error) {
      if (!error.retryable || attempt === delays.length || !shouldContinue()) {
        if (attempt) error.message += `（已尝试 ${attempt + 1} 次）`;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      if (!shouldContinue()) throw error;
    }
  }
}
function gitFailure(command, error, stdout, stderr) {
  const output = [stderr, stdout].filter((value) => value?.trim()).join('\n').trim() || error.message;
  const safe = output.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1***@');
  const detail = safe.length > 4000 ? `${safe.slice(0, 1800)}\n…输出已截断…\n${safe.slice(-1800)}` : safe;
  return `git ${command} 失败（${error.killed ? '执行超时或被终止' : `退出码 ${error.code}`}）：${detail}`;
}
async function optionalGit(directory, args) { try { return await git(directory, args); } catch { return ''; } }
function readWorkingTree(status) {
  const entries = status.split('\0');
  const submoduleUpdates = [];
  let dirty = 0, pullBlockingChanges = 0;
  for (let index = 0; index < entries.length && entries[index]; index++) {
    const entry = entries[index];
    // A worktree-only gitlink change is handled after the parent fast-forwards.
    const submodule = entry.match(/^1 \.M S([C.])[M.][U.] 160000 160000 160000 \S+ \S+ ([\s\S]+)$/);
    dirty++;
    if (submodule) {
      if (submodule[1] === 'C') submoduleUpdates.push(submodule[2]);
    } else {
      pullBlockingChanges++;
      if (entry.startsWith('2 ')) index++; // A rename or copy has a second path.
    }
  }
  return { dirty, pullBlockingChanges, submoduleUpdates };
}
function dailySlot(date = new Date()) {
  const due = new Date(date); due.setHours(3, 0, 0, 0);
  if (date < due) due.setDate(due.getDate() - 1);
  return due.toISOString();
}
async function inspectRepository(repo) {
  const directory = repo.directory;
  const branch = await optionalGit(directory, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const workingTree = readWorkingTree(await git(directory, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignore-submodules=none']));
  const gitDir = await git(directory, ['rev-parse', '--absolute-git-dir']);
  const inProgress = ['index.lock', 'HEAD.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer'].some((file) => fs.existsSync(path.join(gitDir, file)));
  const upstream = branch ? await optionalGit(directory, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']) : '';
  const remote = branch ? await optionalGit(directory, ['config', '--get', `branch.${branch}.remote`]) : '';
  const mergeRef = branch ? await optionalGit(directory, ['config', '--get', `branch.${branch}.merge`]) : '';
  let ahead = 0, behind = 0;
  if (upstream) [ahead, behind] = (await git(directory, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).split(/\s+/).map(Number);
  const remoteUrl = remote && remote !== '.' ? await optionalGit(directory, ['remote', 'get-url', remote]) : '';
  const head = await optionalGit(directory, ['rev-parse', 'HEAD']);
  const superproject = await optionalGit(directory, ['rev-parse', '--show-superproject-working-tree']);
  const gitlink = superproject ? await git(superproject, ['ls-files', '--stage', '--', path.relative(fs.realpathSync(superproject), fs.realpathSync(directory))]) : '';
  const pinnedCommit = gitlink.match(/^160000 ([0-9a-f]+) 0\t/)?.[1] || '';
  const pinned = !branch && Boolean(pinnedCommit && pinnedCommit === head);
  const status = !branch ? (pinned ? 'pinned' : 'detached') : !upstream || !remoteUrl ? 'untracked' : ahead && behind ? 'diverged' : behind ? 'behind' : ahead ? 'ahead' : 'synced';
  return { ...repo, head, superproject, pinnedCommit, branch, ...workingTree, inProgress, upstream, remote, mergeRef, ahead, behind, status, remoteUrl: remoteUrl.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1***@') };
}
function canProcess(repo, kind) {
  if (!repo.checkedAt || !repo.branch || !repo.upstream || !repo.remoteUrl || !repo.mergeRef?.startsWith('refs/heads/') || repo.error || repo.inProgress) return false;
  const pull = !repo.ahead && !(repo.pullBlockingChanges ?? repo.dirty) && (repo.behind > 0 || repo.submoduleUpdates?.length > 0);
  const push = repo.status === 'ahead' && repo.ahead > 0 && !repo.behind && !repo.dirty;
  return kind === 'pull' ? pull : kind === 'push' ? push : pull || push;
}
function createGitSync({ statePath, getProjects, now = () => new Date(), checkConcurrency = 4 }) {
  if (!Number.isInteger(checkConcurrency) || checkConcurrency < 1 || checkConcurrency > 16) throw new Error('检查并发数应为 1–16');
  let state;
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { state = {}; }
  state = { repositories: [], results: [], lastSync: null, lastAttemptAt: null, completedSlot: null, ...state, busy: false, currentRepository: '', activeRepositoryKeys: [], progress: null };
  let timer = null, job = null, discoveryJob = null, stopped = false, discoverySignature = '';
  const save = () => {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(`${statePath}.tmp`, JSON.stringify({ ...state, busy: false }, null, 2)); fs.renameSync(`${statePath}.tmp`, statePath);
  };
  function discover(options) {
    if (!discoveryJob) discoveryJob = discoverRepositories(options).finally(() => { discoveryJob = null; });
    return discoveryJob;
  }
  async function discoverRepositories({ force = false } = {}) {
    const projects = getProjects();
    const signature = JSON.stringify(projects.map(({ key, name, projectDir, workingDirectory, manifestPath, ancestors }) => ({ key, name, projectDir, workingDirectory, manifestPath, ancestors })));
    if (!force && signature === discoverySignature) return;
    const repositories = new Map();
    for (const project of projects) {
      const source = project.projectDir || project.workingDirectory || (project.manifestPath && path.dirname(project.manifestPath));
      if (!source) continue;
      const directory = await optionalGit(source, ['rev-parse', '--show-toplevel']);
      if (!directory) continue;
      const canonical = fs.realpathSync(directory);
      const key = crypto.createHash('sha256').update(canonical).digest('hex');
      if (!repositories.has(key)) {
        const previous = state.repositories.find((item) => item.key === key);
        const commonDirectory = await optionalGit(source, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
        repositories.set(key, { ...previous, key, directory: canonical, commonDirectory: commonDirectory ? fs.realpathSync(commonDirectory) : canonical, name: path.basename(canonical), services: [], checkedAt: previous?.checkedAt || null, status: previous?.status || 'unchecked' });
      }
      repositories.get(key).services.push({ key: project.key, name: project.name, ancestors: project.ancestors || [] });
    }
    state.repositories = [...repositories.values()];
    discoverySignature = signature;
  }
  const snapshot = () => JSON.parse(JSON.stringify({ ...state, schedule: '03:00', nextCheckAt: (() => { const next = new Date(now()); next.setHours(3, 0, 0, 0); if (next <= now()) next.setDate(next.getDate() + 1); return next.toISOString(); })() }));
  async function checkOne(repo) {
    let inspected;
    try {
      inspected = await inspectRepository(repo);
      if (inspected.remote && inspected.remote !== '.' && !inspected.remote.startsWith('-')) {
        await fetchWithRetry(repo.directory, inspected.remote, () => !stopped);
        inspected = await inspectRepository(repo);
      }
      return { ...inspected, error: '', checkedAt: now().toISOString() };
    } catch (error) { return { ...repo, error: error.message, status: 'error', checkedAt: now().toISOString() }; }
  }
  async function updateSubmodules(parent) {
    let count = 0;
    const warnings = [];
    for (const relative of parent.submoduleUpdates) {
      const directory = path.join(parent.directory, relative);
      const registered = state.repositories.find((repo) => repo.directory === directory);
      try {
        let child = await inspectRepository(registered || { directory });
        if (child.superproject !== parent.directory || !child.pinnedCommit) {
          warnings.push(`跳过子模块 ${relative}（无法确认父仓库指定版本）`);
        } else if (child.inProgress || child.dirty) {
          warnings.push(`跳过子模块 ${relative}（${child.inProgress ? 'Git 操作进行中' : '有未提交改动'}）`);
        } else if (child.head !== child.pinnedCommit) {
          await git(parent.directory, ['submodule', 'update', '--checkout', '--', relative], ['--literal-pathspecs', '-c', 'submodule.recurse=false']);
          count++;
          if (registered) child = await inspectRepository(registered);
        }
        if (registered) {
          state.repositories = state.repositories.map((repo) => repo.key === registered.key
            ? { ...child, checkedAt: now().toISOString(), error: '' } : repo);
        }
      } catch (error) {
        warnings.push(`子模块 ${relative} 更新失败：${error.message}`);
      }
    }
    return { count, warnings };
  }
  async function execute(kind, keys, scheduled = false) {
    if (!['check', 'pull', 'push', 'sync'].includes(kind)) throw new Error('未知仓库操作');
    if (keys !== undefined && (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string'))) throw new Error('仓库参数应为数组');
    await discover({ force: true });
    const retry = scheduled && state.lastAttemptSlot === dailySlot(now()) && state.repositories.some((repo) => repo.error);
    const completed = state.completedSlot === dailySlot(now());
    const selected = keys === undefined ? (kind !== 'check' ? state.repositories.filter((repo) => canProcess(repo, kind)) : scheduled && (retry || completed) ? state.repositories.filter((repo) => repo.error || !repo.checkedAt) : state.repositories) : state.repositories.filter((repo) => keys.includes(repo.key));
    if (keys?.some((key) => !selected.some((repo) => repo.key === key))) throw new Error('仓库不属于当前项目列表');
    state.lastAttemptAt = now().toISOString(); state.lastAttemptSlot = dailySlot(now()); state.results = []; state.operation = kind;
    state.progress = { completed: 0, total: selected.length };
    const slot = dailySlot(now());
    const active = new Map(), results = new Map();
    const updateActive = () => { state.currentRepository = [...active.values()].join('、'); state.activeRepositoryKeys = [...active.keys()]; };
    async function processOne(repo) {
      active.set(repo.key, repo.name); updateActive();
      try {
        let updated = await checkOne(repo);
        let outcome = updated.error ? 'failed' : 'checked', detail = updated.error || (updated.status === 'pinned' ? '子模块与父仓库指定版本一致，无需单独拉取或推送' : updated.upstream && updated.remoteUrl ? '远端状态已更新' : '已检查本地状态；没有可同步的跟踪分支');
        if (kind !== 'check' && !updated.error) {
          const action = kind === 'sync' ? (updated.behind || (!updated.ahead && updated.submoduleUpdates.length) ? 'pull' : 'push') : kind;
          const dirty = (repository) => action === 'pull' ? repository.pullBlockingChanges : repository.dirty;
          const blocked = !updated.branch ? '当前为 detached HEAD' : !updated.upstream || !updated.remoteUrl || !updated.mergeRef.startsWith('refs/heads/') ? '未配置远端跟踪分支' : dirty(updated) ? '有未提交修改' : updated.inProgress ? 'Git 操作进行中' : updated.ahead && updated.behind ? '分支已分叉，需要先处理合并' : action === 'push' && updated.behind ? '远端有新提交，请先拉取' : '';
          if (blocked) { outcome = 'skipped'; detail = blocked; }
          else if (!(action === 'push' ? updated.ahead : !updated.ahead && (updated.behind || updated.submoduleUpdates.length))) { outcome = 'skipped'; detail = '无需同步'; }
          else {
            try {
              // Re-read local state immediately before changing the branch or publishing commits.
              const current = await inspectRepository(repo);
              if (current.head !== updated.head || current.branch !== updated.branch || current.upstream !== updated.upstream || current.ahead !== updated.ahead || current.behind !== updated.behind || dirty(current) || current.inProgress) throw new Error('仓库状态发生变化，请重新检查');
              outcome = 'success';
              if (action === 'pull') {
                if (current.behind) await git(repo.directory, ['merge', '--ff-only', '@{upstream}'], ['-c', 'submodule.recurse=false']);
                const parent = current.behind ? await inspectRepository(repo) : current;
                const { count, warnings } = await updateSubmodules(parent);
                if (warnings.length) outcome = 'partial';
                detail = [
                  current.behind ? '已快进更新' : '父仓库已同步',
                  count ? `已更新 ${count} 个子模块` : '',
                  ...warnings,
                ].filter(Boolean).join('；');
              } else {
                await git(repo.directory, ['push', '--', current.remote, `HEAD:${current.mergeRef}`]);
                detail = '已推送';
              }
              updated = { ...await inspectRepository(repo), checkedAt: now().toISOString(), error: '' };
            } catch (error) { outcome = 'failed'; detail = error.message; updated = { ...updated, status: 'error', error: detail }; }
          }
        }
        const result = { key: repo.key, name: repo.name, outcome, detail };
        if (kind !== 'check') updated.lastSyncResult = { ...result, operation: kind, at: now().toISOString() };
        state.repositories = state.repositories.map((item) => item.key === repo.key ? updated : item);
        results.set(repo.key, result);
        state.results = selected.map((item) => results.get(item.key)).filter(Boolean);
        state.progress.completed = results.size;
        if (kind !== 'check') state.lastSync = { operation: kind, results: [...state.results], finishedAt: null };
        save();
      } finally { active.delete(repo.key); updateActive(); }
    }
    if (kind === 'check') {
      let next = 0;
      const locks = new Map();
      async function worker() {
        while (!stopped && next < selected.length) {
          const repo = selected[next++];
          // Worktrees share refs and fetch locks, so their checks must not overlap.
          const previous = locks.get(repo.commonDirectory) || Promise.resolve();
          const pending = previous.catch(() => {}).then(() => { if (!stopped) return processOne(repo); });
          locks.set(repo.commonDirectory, pending);
          await pending;
        }
      }
      const workers = await Promise.allSettled(Array.from({ length: Math.min(checkConcurrency, selected.length) }, worker));
      const failure = workers.find((result) => result.status === 'rejected');
      if (failure) throw failure.reason;
    } else {
      for (const repo of selected) { if (stopped) break; await processOne(repo); }
    }
    if (kind === 'check' && keys === undefined) state.completedSlot = !state.repositories.some((repo) => repo.error) && !stopped ? slot : null;
    state.currentRepository = ''; state.lastFinishedAt = now().toISOString(); state.scheduled = scheduled;
    if (kind !== 'check' && selected.length) state.lastSync = { operation: kind, results: [...state.results], finishedAt: state.lastFinishedAt };
    save();
  }
  function request(kind = 'check', keys, scheduled = false) {
    if (job) return snapshot();
    state.busy = true; state.operation = kind; state.currentRepository = ''; state.activeRepositoryKeys = kind === 'check' ? (keys || state.repositories.map((repo) => repo.key)) : []; state.progress = null; state.results = [];
    job = execute(kind, keys, scheduled).catch((error) => { state.error = error.message; }).finally(() => { state.busy = false; state.currentRepository = ''; state.activeRepositoryKeys = []; job = null; save(); });
    state.error = '';
    return snapshot();
  }
  function tick() {
    const unchecked = state.repositories.some((repo) => !repo.checkedAt);
    if (stopped || job || (state.completedSlot === dailySlot(now()) && !unchecked)) return;
    if (!unchecked && state.lastAttemptSlot === dailySlot(now()) && state.lastAttemptAt && now() - new Date(state.lastAttemptAt) < 15 * 60 * 1000) return;
    request('check', undefined, true);
  }
  return {
    snapshot, request, discover, tick,
    refresh: async () => { if (!job) { await discover(); if (timer) tick(); } },
    wait: async () => { if (job) await job; return snapshot(); },
    start: () => { stopped = false; tick(); timer = setInterval(tick, 60000); timer.unref(); },
    stop: () => { stopped = true; clearInterval(timer); timer = null; },
  };
}
module.exports = { createGitSync, dailySlot, inspectRepository };
