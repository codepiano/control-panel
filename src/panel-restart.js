const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

async function preparePanelRestart({ root, port, serverPid = process.pid, launcherPid = process.ppid }) {
  const pidPath = path.join(root, '.control-panel/control-panel.pid');
  if (Number(fs.existsSync(pidPath) && fs.readFileSync(pidPath, 'utf8').trim()) !== launcherPid) {
    throw new Error('当前后端不是由启动脚本管理，请先通过 scripts/start.sh 启动后再使用自重启');
  }
  const { stdout } = await run('/bin/ps', ['-p', String(launcherPid), '-o', 'command=']);
  if (!stdout.includes(path.join(root, 'scripts/run.sh'))) throw new Error('启动进程身份不匹配，无法重启');
  const log = fs.openSync(path.join(root, '.control-panel/logs/control-panel.log'), 'a');
  let child;
  try {
    child = spawn(process.execPath, [path.join(root, 'scripts/self-restart.js'), String(port), String(serverPid), String(launcherPid)], {
      cwd: root, detached: true, stdio: ['pipe', log, log],
      env: { ...process.env, CONTROL_PANEL_PORT: String(port), CONTROL_PANEL_NODE: process.execPath },
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  } finally { fs.closeSync(log); }
  child.stdin.on('error', () => {});
  child.unref();
  let sent = false;
  return {
    commit() { if (!sent) { sent = true; child.stdin.end('restart'); } },
    cancel() { if (!sent) { sent = true; child.stdin.end(); } },
  };
}
module.exports = { preparePanelRestart };
