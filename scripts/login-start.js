const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
// launchd starts Node directly so it can access a project in macOS Documents.
const child = spawn('python3', [path.join(root, 'tooling/release/adapter.py'), 'login'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'inherit'],
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
let output = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => { output += chunk; });
child.on('close', (code) => {
  process.exitCode = code ?? 1;
  if (code !== 0) return;
  try {
    const result = JSON.parse(output);
    console.log(result);
    if (result.runningRevision) {
      // launchd reaps a job's descendants when its main process exits, even
      // when the panel detached. Keep the login job alive for this session.
      setInterval(() => {}, 60 * 60 * 1000);
    }
  } catch (error) {
    console.error('无法确认登录启动结果：', error.message);
    process.exitCode = 1;
  }
});
