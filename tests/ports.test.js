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
