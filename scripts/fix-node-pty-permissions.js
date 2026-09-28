// node-pty's macOS prebuilds ship a `spawn-helper` binary that is sometimes extracted without
// the executable bit, which makes every terminal fail with "posix_spawnp failed".
// Restore +x after install so both `npm start` and packaged builds work.
const fs = require('fs');
const path = require('path');

if (process.platform === 'win32') process.exit(0);

const ptyRoot = path.join(__dirname, '..', 'node_modules', 'node-pty');
const candidates = [
  path.join(ptyRoot, 'build', 'Release', 'spawn-helper'),
  ...['darwin-arm64', 'darwin-x64'].map((dir) => path.join(ptyRoot, 'prebuilds', dir, 'spawn-helper')),
];

for (const helper of candidates) {
  try {
    fs.chmodSync(helper, 0o755);
  } catch (_) {
    // Missing for this platform/arch — nothing to fix.
  }
}
