const { spawn } = require('node:child_process');

// Settle on the deadline even if a descendant retains an output pipe.
function execCommand(command, cwd, { timeoutMs = 8000 } = {}) {
  if (!command) return Promise.resolve({ code: 0, stdout: '', stderr: '' });
  return new Promise((resolve) => {
    const child = spawn('/bin/zsh', ['-c', command], {
      cwd, detached: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', settled = false;
    const finish = (code, message = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ code, stdout, stderr: [stderr, message].filter(Boolean).join('\n') });
    };
    const abort = (message) => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      finish(1, message);
    };
    const timer = setTimeout(() => abort(`命令超时（${timeoutMs / 1000} 秒）`), timeoutMs);
    child.stdout.on('data', (data) => {
      stdout += data;
      if (Buffer.byteLength(stdout) > 1048576) abort('命令输出过大');
    });
    child.stderr.on('data', (data) => {
      stderr += data;
      if (Buffer.byteLength(stderr) > 1048576) abort('命令输出过大');
    });
    child.once('error', (error) => finish(1, error.message));
    child.once('close', (code) => finish(code ?? 1));
  });
}

module.exports = { execCommand };
