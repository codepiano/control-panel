const { test } = require('node:test');
const assert = require('node:assert/strict');
const { releaseConfiguration, parseVersion, applyRelease, command } = require('../src/releases');
const project = { workingDirectory: process.cwd(), release: { version: 'version', prepare: 'prepare', activate: 'activate', prepareTimeoutMs: 3000, activateTimeoutMs: 3000 } };
function fixture({ prepareFailure, sourceChanged, wrongPrepared, stopFailure, wrongActivated, wrongRuntime, confirmFailure } = {}) {
  const events = []; let reads = 0;
  return { events, options: {
    run: async (script, cwd, options) => {
      events.push(script);
      if (script === 'version') { reads++; return { sourceRevision: sourceChanged && reads > 1 ? 'newer' : 'target', builtRevision: null, runningRevision: reads > 2 && !wrongRuntime ? 'target' : 'old' }; }
      assert.equal(options.env.PROJECT_TARGET_REVISION, 'target');
      if (script === 'prepare') {
        if (prepareFailure) throw new Error('build failed');
        return { builtRevision: wrongPrepared ? 'other' : 'target', artifactId: 'release $literal with spaces' };
      }
      assert.equal(options.env.PROJECT_ARTIFACT_ID, 'release $literal with spaces');
      return { runningRevision: wrongActivated ? 'other' : 'target' };
    },
    stop: async () => { events.push('stop'); if (stopFailure) throw new Error('stop failed'); },
    confirm: async () => { events.push('health'); if (confirmFailure) throw new Error('unhealthy'); },
  } };
}
test('prepare before stop, activate exact immutable artifact, then verify health and running revision', async () => {
  const f = fixture();
  assert.equal((await applyRelease(project, f.options)).targetRevision, 'target');
  assert.deepEqual(f.events, ['version', 'prepare', 'version', 'stop', 'activate', 'health', 'version']);
});
for (const [name, options, last] of [
  ['failed build leaves existing service untouched', {prepareFailure:true}, 'prepare'],
  ['wrong artifact leaves existing service untouched', {wrongPrepared:true}, 'prepare'],
  ['moving source leaves existing service untouched', {sourceChanged:true}, 'version'],
  ['failed stop blocks activation', {stopFailure:true}, 'stop'],
  ['wrong activation cannot succeed', {wrongActivated:true}, 'activate'],
  ['health failure cannot succeed', {confirmFailure:true}, 'health'],
  ['healthy old runtime cannot succeed', {wrongRuntime:true}, 'version'],
]) test(name, async () => { const f = fixture(options); await assert.rejects(applyRelease(project, f.options)); assert.equal(f.events.at(-1), last); });
test('release is explicit, complete and bounded', () => {
  assert.equal(releaseConfiguration({}), null);
  assert.throws(() => releaseConfiguration({release:{protocol:2}}));
  assert.throws(() => releaseConfiguration({release:{protocol:1},scripts:{version:'x'}}));
  const valid = {statusCommand:'status',stopCommand:'stop',release:{protocol:1},scripts:{version:'v',prepare:'p',activate:'a'}};
  assert.equal(releaseConfiguration(valid).prepareTimeoutMs, 1800000);
  assert.throws(() => releaseConfiguration({...valid,release:{protocol:1,prepareTimeoutMs:0}}));
  assert.throws(() => parseVersion({sourceRevision:'HEAD',builtRevision:undefined,runningRevision:null}));
  assert.throws(() => parseVersion({sourceRevision:'a\nb',builtRevision:null,runningRevision:null}));
});
test('real command passes revision and artifact literally and rejects invalid JSON, nonzero and timeout', async () => {
  const env = { PROJECT_ARTIFACT_ID: 'literal $() `quotes` " with spaces' };
  const output = await command(`${JSON.stringify(process.execPath)} -e 'console.log(JSON.stringify({id:process.env.PROJECT_ARTIFACT_ID}))'`, process.cwd(), { env });
  assert.equal(output.id, env.PROJECT_ARTIFACT_ID);
  await assert.rejects(command('printf invalid', process.cwd()), /JSON/);
  await assert.rejects(command('exit 2', process.cwd()), /失败/);
  await assert.rejects(command('sleep 10', process.cwd(), {timeoutMs:100}), /超时/);
});
