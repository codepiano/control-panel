const { spawn } = require('node:child_process');

const REVISION = /^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,255}$/;
function revision(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !REVISION.test(value)) throw new Error(`${label} 必须是有效的版本标识`);
  return value;
}
function parseVersion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('version 必须返回 JSON 对象');
  return {
    sourceRevision: revision(value.sourceRevision, 'sourceRevision'),
    builtRevision: revision(value.builtRevision, 'builtRevision', true),
    runningRevision: revision(value.runningRevision, 'runningRevision', true),
  };
}
function releaseConfiguration(manifest) {
  if (manifest.release === undefined) return null;
  const config = manifest.release;
  if (!config || config.protocol !== 1) throw new Error('release.protocol 必须是 1');
  if (!manifest.statusCommand && !manifest.scripts?.status) throw new Error('release 需要 statusCommand');
  if (!manifest.stopCommand && !manifest.scripts?.stop) throw new Error('release 需要 stopCommand');
  const scripts = manifest.scripts || {};
  const result = {};
  for (const name of ['version', 'prepare', 'activate']) {
    if (typeof scripts[name] !== 'string' || !scripts[name].trim()) throw new Error(`release 需要 scripts.${name}`);
    result[name] = scripts[name];
  }
  result.prepareTimeoutMs = config.prepareTimeoutMs ?? 1800000;
  result.activateTimeoutMs = config.activateTimeoutMs ?? 60000;
  for (const name of ['prepareTimeoutMs', 'activateTimeoutMs']) {
    if (!Number.isInteger(result[name]) || result[name] < 100 || result[name] > 3600000) throw new Error(`release.${name} 必须为 100–3600000`);
  }
  return result;
}
// Commands must exit; all their output is bounded. Kill only this invocation's process group.
function command(script, cwd, { timeoutMs = 8000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', script], { cwd, detached: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure;
    const kill = (error) => { failure ||= error; try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => kill(new Error('版本命令超时')), timeoutMs);
    child.stdout.on('data', (data) => { stdout += data; if (Buffer.byteLength(stdout) > 262144) kill(new Error('版本命令输出过大')); });
    child.stderr.on('data', (data) => { stderr += data; if (Buffer.byteLength(stderr) > 262144) kill(new Error('版本命令输出过大')); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error(`版本命令失败 (${code})：${stderr.trim().slice(-2000)}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('版本命令必须只向 stdout 输出 JSON')); }
    });
  });
}
async function readVersion(project, run = command) {
  return parseVersion(await run(project.release.version, project.workingDirectory));
}
async function releaseStatus(project) {
  if (!project.release) return { state: 'unsupported' };
  try {
    const value = await readVersion(project);
    const state = value.runningRevision === value.sourceRevision ? 'current'
      : value.builtRevision !== value.sourceRevision ? 'needs-build' : 'needs-restart';
    return { ...value, state: value.runningRevision === null ? 'unknown' : state, needsBuild: value.builtRevision !== value.sourceRevision };
  } catch (error) { return { state: 'unknown', error: error.message }; }
}
async function applyRelease(project, { stop, confirm, phase = () => {}, run = command }) {
  phase('检查代码版本');
  const target = (await readVersion(project, run)).sourceRevision;
  const env = { PROJECT_TARGET_REVISION: target };
  phase('准备新版产物，原服务继续运行');
  const prepared = await run(project.release.prepare, project.workingDirectory, { timeoutMs: project.release.prepareTimeoutMs, env });
  if (!prepared || revision(prepared.builtRevision, 'builtRevision') !== target) throw new Error('准备产物的版本与目标不一致');
  if (typeof prepared.artifactId !== 'string' || !prepared.artifactId || prepared.artifactId.length > 4096 || /[\x00-\x1f]/.test(prepared.artifactId)) throw new Error('prepare 缺少有效的 artifactId');
  // A project prepares an immutable snapshot. Do not silently deploy a moving worktree.
  if ((await readVersion(project, run)).sourceRevision !== target) throw new Error('准备期间代码已改变，请重新执行');
  phase('停止旧服务');
  await stop();
  phase('切换并启动新版');
  const activated = await run(project.release.activate, project.workingDirectory, {
    timeoutMs: project.release.activateTimeoutMs,
    env: { ...env, PROJECT_ARTIFACT_ID: prepared.artifactId },
  });
  if (!activated || activated.runningRevision !== target) throw new Error('activate 未确认目标运行版本');
  await confirm();
  phase('核验实际运行版本');
  const actual = await readVersion(project, run);
  if (actual.runningRevision !== target) throw new Error('服务已启动，但实际运行版本与目标不一致');
  return { targetRevision: target, artifactId: prepared.artifactId };
}
module.exports = { releaseConfiguration, releaseStatus, readVersion, applyRelease, parseVersion, command };
