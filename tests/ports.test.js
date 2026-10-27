const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { projectPorts, parseListeners, buildPortReport, assertPortsAvailable } = require('../src/ports');

test('local endpoints reserve default and explicit ports; remote sites do not', () => {
  assert.deepEqual(projectPorts({ frontendUrl: 'http://localhost:4318', metricsUrl: 'http://127.0.0.1:4318/metrics' }), [4318]);
  assert.deepEqual(projectPorts({ frontendUrl: 'https://example.com:4318' }), []);
  assert.deepEqual(projectPorts({ frontendUrl: 'http://[::1]' }), [80]);
  assert.deepEqual(projectPorts({ ports: [8000, 6379, 8000, 0, 65536, '4320'], frontendUrl: 'http://localhost:5181' }), [8000, 6379, 5181]);
});

test('report distinguishes duplicate reservations, multiple listeners and stopped service occupancy', () => {
  const listeners = parseListeners('p12\ncnode\nf4\nn*:4318\np13\ncnode\nn127.0.0.1:4318\np14\ncworker\nn[::1]:4320\n');
  const report = buildPortReport([
    { key: 'a', name: 'Docs', frontendUrl: 'http://localhost:4318', status: 'running' },
    { key: 'b', name: 'Vault', frontendUrl: 'http://127.0.0.1:4318', status: 'stopped' },
    { key: 'c', name: 'Worker', frontendUrl: 'http://localhost:4320', status: 'stopped' },
  ], { listeners });
  assert.equal(report.conflictCount, 2);
  assert.equal(report.rows.find((row) => row.port === 4318).warnings.length, 2);
  assert.equal(report.rows.find((row) => row.port === 4320).warnings.length, 1);
  assert.ok(!report.suggestions.includes(4318));
  assert.ok(!report.suggestions.includes(4320));
});

test('shared macOS sockets keep all PIDs visible without reporting a conflict', () => {
  const listeners = parseListeners('p12\ncPython\nf3\ntIPv4\nd0xc462df6b49bbb8c0\nn127.0.0.1:8000\nf4\ntIPv6\nd0xabcd\nn[::1]:8000\np13\ncPython\nf3\ntIPv4\nd0xc462df6b49bbb8c0\nn127.0.0.1:8000\nf4\ntIPv6\nd0xabcd\nn[::1]:8000\n');
  const report = buildPortReport([], { listeners });
  assert.equal(listeners.length, 4);
  assert.equal(report.rows[0].listeners.length, 4);
  assert.deepEqual(report.rows[0].warnings, []);
  assert.equal(report.conflictCount, 0);
  // Sharing a socket does not cancel duplicate reservations or stopped-service warnings.
  const reserved = buildPortReport([
    { key: 'a', name: 'A', ports: [8000], status: 'stopped' },
    { key: 'b', name: 'B', ports: [8000], status: 'stopped' },
  ], { listeners });
  assert.equal(reserved.rows[0].warnings.length, 2);
  assert.equal(reserved.conflictCount, 1);
});

test('independent sockets and unknown identities still report multiple processes', () => {
  for (const extra of ['d0x1234', '']) {
    const listeners = parseListeners(`p12\ncPython\nf3\ntIPv4\nd0xabcd\nn127.0.0.1:8000\np13\ncPython\nf3\ntIPv4\nd0xabcd\nn127.0.0.1:8000\np14\ncPython\nf3\ntIPv4\n${extra}\nn127.0.0.1:8000\n`);
    assert.deepEqual(buildPortReport([], { listeners }).rows[0].warnings, ['多个进程同时监听']);
  }
});

test('Linux socket inodes identify sharing and file boundaries reset identity fields', () => {
  const listeners = parseListeners('p12\ncserver\nf3\ntIPv4\nD0x9\ni101\nn*:8000\nf4\ntIPv4\nD0x9\ni202\nn*:9000\np13\ncworker\nf3\ntIPv4\nD0x9\ni101\nn*:8000\nf4\ntIPv4\nD0x9\ni303\nn*:9000\nf5\ntIPv4\nn*:10000\n');
  const rows = buildPortReport([], { listeners }).rows;
  assert.deepEqual(rows.find(row => row.port === 8000).warnings, []);
  assert.deepEqual(rows.find(row => row.port === 9000).warnings, ['多个进程同时监听']);
  assert.equal(listeners.at(-1).socketId, undefined);
});

test('startup blocks a stopped reservation and real unrelated listeners without touching them', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const project = { key: 'a', name: 'A', frontendUrl: `http://localhost:${port}` };
  try {
    await assert.rejects(assertPortsAvailable(project, [{ ...project, key: 'b', name: 'B', status: 'stopped' }]), /已分配给 B/);
    await assert.rejects(assertPortsAvailable(project, []), /已被占用|EADDRINUSE/);
    assert.equal(server.listening, true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
  await assertPortsAvailable(project, []);
});
