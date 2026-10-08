const { execFile } = require('node:child_process');
const net = require('node:net');

// Local URLs reserve ports even when services are stopped. Remote URLs reserve nothing.
function projectPorts(project) {
  const ports = new Set((Array.isArray(project.ports) ? project.ports : []).filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535));
  for (const value of [project.frontendUrl, project.metricsUrl]) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '[::]'].includes(url.hostname)) continue;
      ports.add(Number(url.port || (url.protocol === 'https:' ? 443 : 80)));
    } catch {}
  }
  return [...ports];
}

function parseListeners(output) {
  const listeners = [];
  let pid, command;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (line.startsWith('c')) command = line.slice(1);
    if (line.startsWith('n')) {
      const match = line.slice(1).match(/:(\d+)$/);
      if (match && pid) listeners.push({ pid, command, address: line.slice(1), port: Number(match[1]) });
    }
  }
  return listeners.filter((item, index) => listeners.findIndex((other) => other.pid === item.pid && other.address === item.address) === index);
}

async function readListeners() {
  return new Promise((resolve) => {
    execFile('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'], { timeout: 3000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve({ listeners: parseListeners(stdout || ''), error: error && !(error.code === 1 && !stdout) ? `无法读取监听进程：${error.message}` : '' });
    });
  });
}

function buildPortReport(projects, { listeners = [], error = '' } = {}) {
  const reservations = new Map();
  for (const project of projects) for (const port of projectPorts(project)) {
    if (!reservations.has(port)) reservations.set(port, []);
    reservations.get(port).push({ key: project.key, name: project.name, status: project.status });
  }
  const rows = [...new Set([...reservations.keys(), ...listeners.map((item) => item.port)])].sort((a, b) => a - b).map((port) => {
    const owners = reservations.get(port) || [];
    const active = listeners.filter((item) => item.port === port);
    const warnings = [];
    if (owners.length > 1) warnings.push(`重复分配：${owners.map((item) => item.name).join('、')}`);
    if (new Set(active.map((item) => item.pid)).size > 1) warnings.push('多个进程同时监听');
    if (owners.length && active.length && owners.every((item) => !['running', 'starting', 'stopping'].includes(item.status))) warnings.push('服务未确认运行，但端口已占用');
    return { port, owners, listeners: active, warnings };
  });
  const used = new Set(rows.map((row) => row.port));
  const suggestions = [];
  for (let port = 4310; port <= 65535 && suggestions.length < 5; port++) if (!used.has(port)) suggestions.push(port);
  return { rows, error, suggestions, conflictCount: rows.filter((row) => row.warnings.length).length };
}

async function assertPortsAvailable(project, projects) {
  const ports = projectPorts(project);
  if (!ports.length) return;
  const { listeners } = await readListeners();
  for (const port of ports) {
    const owners = projects.filter((other) => other.key !== project.key && projectPorts(other).includes(port));
    if (owners.length) throw new Error(`端口 ${port} 已分配给 ${owners.map((item) => item.name).join('、')}，请先调整服务启动配置及访问地址`);
    const occupied = listeners.filter((listener) => listener.port === port);
    if (occupied.length) throw new Error(`端口 ${port} 已被占用（${occupied.map((listener) => `${listener.command} PID ${listener.pid}`).join('、')}），请查看端口分配与监听进程`);
    // A real bind also works when lsof is unavailable. Lifecycle still owns the final bind.
    for (const host of ['127.0.0.1', '0.0.0.0', '::1', '::']) {
      const probe = net.createServer();
      await new Promise((resolve, reject) => {
        probe.once('error', (error) => {
          if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) resolve();
          else reject(new Error(`端口 ${port} 无法使用（${error.code}），请查看端口分配与监听进程`));
        });
        probe.listen({ port, host, ipv6Only: host.includes(':') }, () => probe.close(resolve));
      });
    }
  }
}

module.exports = { projectPorts, parseListeners, readListeners, buildPortReport, assertPortsAvailable };
