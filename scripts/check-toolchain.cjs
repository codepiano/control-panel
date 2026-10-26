const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const pkg = require('../package.json');
const [major, minor] = process.versions.node.split('.').map(Number);
assert.ok((major === 24 && minor >= 15) || major === 26,
  'Requires Node.js 24.15+ (24.x) or 26.x');
const corepack = execFileSync('corepack', ['--version'], { encoding: 'utf8' }).trim();
const [cm, cn] = corepack.split('.').map(Number);
assert.ok(cm > 0 || cn >= 36,
  'Requires Corepack 0.36.0+; upgrade Corepack before starting pnpm 12');
const pnpm = execFileSync('corepack', ['pnpm', '--version'], {
  cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8',
}).trim();
assert.equal(`pnpm@${pnpm}`, pkg.packageManager);
console.log(`Node ${process.versions.node}; Corepack ${corepack}; pnpm ${pnpm}`);
