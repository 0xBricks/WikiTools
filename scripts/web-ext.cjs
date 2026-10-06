const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const command = process.argv[2];
if (!['lint', 'build'].includes(command)) throw new Error('Use lint or build');
const cli = path.join(root, 'node_modules', 'web-ext', 'bin', 'web-ext.js');
if (!fs.existsSync(cli)) throw new Error('Installez les dépendances avec pnpm install.');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src', 'manifest.json'), 'utf8'));
const args = [cli, command, '--source-dir', path.join(root, 'src'), '--ignore-files', 'tests/**'];
if (command === 'lint') args.push('--self-hosted');
if (command === 'build') args.push('--artifacts-dir', path.join(root, 'dist'), '--filename', 'wikitools-' + manifest.version + '-non-signee.zip', '--overwrite-dest');
const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, NO_UPDATE_NOTIFIER: '1' } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

