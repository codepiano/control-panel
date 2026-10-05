const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

function git(directory, args) {
  return new Promise((resolve, reject) => execFile('git', ['-C', directory, ...args], {
    timeout: 45000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes -o ConnectTimeout=10' },
  }, (error, stdout, stderr) => error ? reject(new Error((stderr || error.message).trim().replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1***@').slice(0, 1200))) : resolve(stdout.trim())));
}
async function optionalGit(directory, args) { try { return await git(directory, args); } catch { return ''; } }
function dailySlot(date = new Date()) {
  const due = new Date(date); due.setHours(3, 0, 0, 0);
  if (date < due) due.setDate(due.getDate() - 1);
  return due.toISOString();
}
async function inspectRepository(repo) {
  const directory = repo.directory;
  const branch = await optionalGit(directory, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const dirty = (await git(directory, ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'])).split('\n').filter(Boolean).length;
  const gitDir = await git(directory, ['rev-parse', '--absolute-git-dir']);
  const inProgress = ['index.lock', 'HEAD.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer'].some((file) => fs.existsSync(path.join(gitDir, file)));
  const upstream = branch ? await optionalGit(directory, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']) : '';
  const remote = branch ? await optionalGit(directory, ['config', '--get', `branch.${branch}.remote`]) : '';
  const mergeRef = branch ? await optionalGit(directory, ['config', '--get', `branch.${branch}.merge`]) : '';
  let ahead = 0, behind = 0;
  if (upstream) [ahead, behind] = (await git(directory, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).split(/\s+/).map(Number);
  const remoteUrl = remote && remote !== '.' ? await optionalGit(directory, ['remote', 'get-url', remote]) : '';
  const status = !branch ? 'detached' : !upstream || !remoteUrl ? 'untracked' : ahead && behind ? 'diverged' : behind ? 'behind' : ahead ? 'ahead' : 'synced';
  const head = await optionalGit(directory, ['rev-parse', 'HEAD']);
  return { ...repo, head, branch, dirty, inProgress, upstream, remote, mergeRef, ahead, behind, status, remoteUrl: remoteUrl.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1***@') };
}
function createGitSync({ statePath, getProjects, now = () => new Date() }) {
  let state;
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { state = {}; }
  state = { repositories: [], lastAttemptAt: null, completedSlot: null, ...state, busy: false, results: [] };
  let timer = null, job = null, stopped = false;
  const save = () => {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(`${statePath}.tmp`, JSON.stringify({ ...state, busy: false }, null, 2)); fs.renameSync(`${statePath}.tmp`, statePath);
  };
  async function discover() {
    const repositories = new Map();
    for (const project of getProjects()) {
      const source = project.projectDir || project.workingDirectory || (project.manifestPath && path.dirname(project.manifestPath));
      if (!source) continue;
      const directory = await optionalGit(source, ['rev-parse', '--show-toplevel']);
      if (!directory) continue;
      const canonical = fs.realpathSync(directory);
      const key = crypto.createHash('sha256').update(canonical).digest('hex');
      if (!repositories.has(key)) {
        const previous = state.repositories.find((item) => item.key === key);
        repositories.set(key, { ...previous, key, directory: canonical, name: path.basename(canonical), services: [], checkedAt: previous?.checkedAt || null, status: previous?.status || 'unchecked' });
      }
      repositories.get(key).services.push({ key: project.key, name: project.name, ancestors: project.ancestors || [] });
    }
    state.repositories = [...repositories.values()];
  }
  const snapshot = () => JSON.parse(JSON.stringify({ ...state, schedule: '03:00', nextCheckAt: (() => { const next = new Date(now()); next.setHours(3, 0, 0, 0); if (next <= now()) next.setDate(next.getDate() + 1); return next.toISOString(); })() }));
  async function checkOne(repo) {
    let inspected;
    try {
      inspected = await inspectRepository(repo);
      if (inspected.remote && inspected.remote !== '.' && !inspected.remote.startsWith('-')) {
        await git(repo.directory, ['fetch', '--prune', '--no-tags', inspected.remote]);
        inspected = await inspectRepository(repo);
      }
      return { ...inspected, error: '', checkedAt: now().toISOString() };
    } catch (error) { return { ...repo, error: error.message, status: 'error', checkedAt: now().toISOString() }; }
  }
  async function execute(kind, keys, scheduled = false) {
    if (!['check', 'pull', 'push'].includes(kind)) throw new Error('未知仓库操作');
    if (keys !== undefined && (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string'))) throw new Error('仓库参数应为数组');
    await discover();
    const retry = scheduled && state.lastAttemptSlot === dailySlot(now()) && state.repositories.some((repo) => repo.error);
    const selected = keys === undefined ? (retry ? state.repositories.filter((repo) => repo.error) : state.repositories) : state.repositories.filter((repo) => keys.includes(repo.key));
    if (keys?.some((key) => !selected.some((repo) => repo.key === key))) throw new Error('仓库不属于当前项目列表');
    state.lastAttemptAt = now().toISOString(); state.lastAttemptSlot = dailySlot(now()); state.results = []; state.operation = kind;
    const slot = dailySlot(now());
    for (const repo of selected) {
      if (stopped) break;
      state.currentRepository = repo.name;
      let updated = await checkOne(repo);
      let outcome = updated.error ? 'failed' : 'checked', detail = updated.error || (updated.upstream && updated.remoteUrl ? '远端状态已更新' : '已检查本地状态；没有可同步的跟踪分支');
      if (kind !== 'check' && !updated.error) {
        const blocked = !updated.branch ? '当前为 detached HEAD' : !updated.upstream || !updated.remoteUrl || !updated.mergeRef.startsWith('refs/heads/') ? '未配置远端跟踪分支' : updated.dirty ? '有未提交修改' : updated.inProgress ? 'Git 操作进行中' : updated.ahead && updated.behind ? '分支已分叉，需要先处理合并' : kind === 'push' && updated.behind ? '远端有新提交，请先拉取' : '';
        if (blocked) { outcome = 'skipped'; detail = blocked; }
        else if (!(kind === 'push' ? updated.ahead : updated.behind)) { outcome = 'skipped'; detail = '无需同步'; }
        else {
          try {
            // Re-read local state immediately before changing the branch or publishing commits.
            const current = await inspectRepository(repo);
            if (current.head !== updated.head || current.branch !== updated.branch || current.upstream !== updated.upstream || current.dirty || current.inProgress) throw new Error('仓库状态发生变化，请重新检查');
            if (kind === 'pull') await git(repo.directory, ['merge', '--ff-only', '@{upstream}']);
            else await git(repo.directory, ['push', '--', current.remote, `HEAD:${current.mergeRef}`]);
            updated = { ...await inspectRepository(repo), checkedAt: now().toISOString(), error: '' };
            outcome = 'success'; detail = kind === 'pull' ? '已快进更新' : '已推送';
          } catch (error) { outcome = 'failed'; detail = error.message; updated = { ...updated, status: 'error', error: detail }; }
        }
      }
      state.repositories = state.repositories.map((item) => item.key === repo.key ? updated : item);
      state.results.push({ key: repo.key, name: repo.name, outcome, detail }); save();
    }
    if (kind === 'check' && keys === undefined && !state.repositories.some((repo) => repo.error) && !stopped) state.completedSlot = slot;
    state.currentRepository = ''; state.lastFinishedAt = now().toISOString(); state.scheduled = scheduled; save();
  }
  function request(kind = 'check', keys, scheduled = false) {
    if (job) return snapshot();
    state.busy = true; state.operation = kind; state.currentRepository = '';
    job = execute(kind, keys, scheduled).catch((error) => { state.error = error.message; }).finally(() => { state.busy = false; job = null; save(); });
    state.error = '';
    return snapshot();
  }
  function tick() {
    if (stopped || job || state.completedSlot === dailySlot(now())) return;
    if (state.lastAttemptSlot === dailySlot(now()) && state.lastAttemptAt && now() - new Date(state.lastAttemptAt) < 15 * 60 * 1000) return;
    request('check', undefined, true);
  }
  return {
    snapshot, request, discover, tick,
    wait: async () => { if (job) await job; return snapshot(); },
    start: () => { stopped = false; tick(); timer = setInterval(tick, 60000); timer.unref(); },
    stop: () => { stopped = true; clearInterval(timer); timer = null; },
  };
}
module.exports = { createGitSync, dailySlot, inspectRepository };
