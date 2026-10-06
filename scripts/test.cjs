const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const folder = path.join(root, 'src', 'tests');
const tests = fs.readdirSync(folder).filter(name => name.endsWith('.test.cjs')).sort().map(name => path.join(folder, name));
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
