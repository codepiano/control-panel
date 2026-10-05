const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const [port, serverPid, launcherPid] = process.argv.slice(2).map(Number);
let command = '';
const timeout = setTimeout(() => process.exit(1), 10000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => { command += data; });
process.stdin.on('end', async () => {
  clearTimeout(timeout);
  if (command !== 'restart') return;
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(10000) })).json();
    const currentLauncher = Number(fs.readFileSync(path.join(root, '.control-panel/control-panel.pid'), 'utf8').trim());
    if (health.pid !== serverPid || health.launcherPid !== launcherPid || currentLauncher !== launcherPid) throw new Error('后端进程已变化，取消此次重启');
    console.log(`[${new Date().toISOString()}] 页面请求重启控制面板 · 后端 PID ${serverPid}`);
    const child = spawn('/bin/bash', [path.join(__dirname, 'restart.sh')], { cwd: root, stdio: 'inherit', env: process.env });
    child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
    child.on('exit', (code) => { process.exitCode = code ?? 1; });
  } catch (error) { console.error(`控制面板自重启失败：${error.message}`); process.exitCode = 1; }
});
