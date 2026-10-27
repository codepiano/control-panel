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
  let pid, command, file = {};
  const finishFile = () => {
    const match = file.address?.match(/:(\d+)$/);
    if (!match || !pid) return;
    const listener = { pid, command, address: file.address, port: Number(match[1]) };
    // Linux exposes socket inodes; macOS exposes the kernel socket pointer in d.
    // A PID, FD number or listen address alone cannot identify a shared socket.
    if (file.inode && /^[1-9]\d*$/.test(file.inode)) listener.socketId = `${file.type}:inode:${file.device || ''}:${file.inode}`;
    else if (/^IPv[46]$/.test(file.type) && /^0x[0-9a-f]*[1-9a-f][0-9a-f]*$/i.test(file.pointer || '')) listener.socketId = `${file.type}:socket:${file.pointer}`;
    listeners.push(listener);
  };
  for (const line of output.split('\n')) {
    if (line.startsWith('p') || line.startsWith('f')) { finishFile(); file = {}; }
    if (line.startsWith('p')) { pid = Number(line.slice(1)); command = undefined; }
    if (line.startsWith('c')) command = line.slice(1);
    if (line.startsWith('t')) file.type = line.slice(1);
    if (line.startsWith('d')) file.pointer = line.slice(1);
    if (line.startsWith('D')) file.device = line.slice(1);
    if (line.startsWith('i')) file.inode = line.slice(1);
    if (line.startsWith('n')) file.address = line.slice(1);
  }
  finishFile();
  return listeners.filter((item, index) => listeners.findIndex((other) => other.pid === item.pid && other.address === item.address && other.socketId === item.socketId) === index);
}

async function readListeners() {
  return new Promise((resolve) => {
    execFile('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-FpcftdDin'], { timeout: 3000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve({ listeners: parseListeners(stdout || ''), error: error && !(error.code === 1 && !stdout) ? `无法读取监听进程：${error.message}` : '' });
    });
  });
}

function hasIndependentListeners(listeners) {
  const parents = new Map(listeners.map(({ pid }) => [pid, pid]));
  const root = (pid) => {
    while (parents.get(pid) !== pid) pid = parents.get(pid);
    return pid;
  };
  const sockets = new Map();
  for (const listener of listeners) {
    if (!listener.socketId) continue; // Missing identity must not hide a conflict.
    const key = `${listener.socketId}:${listener.address}`;
    if (sockets.has(key)) parents.set(root(listener.pid), root(sockets.get(key)));
    else sockets.set(key, listener.pid);
  }
  // Multiple inherited IPv4/IPv6 sockets can belong to the same worker group.
  return new Set([...parents.keys()].map(root)).size > 1;
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
    if (hasIndependentListeners(active)) warnings.push('多个进程同时监听');
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
