const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawn } = require('child_process');

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// ── Shell quoting ──────────────────────────────────────
function quoteWindowsArg(value) {
  const normalized = String(value);
  if (!/[\s"]/u.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}

function quotePosixArg(value) {
  const normalized = String(value);
  if (normalized && /^[\w@%+=:,./-]+$/u.test(normalized)) return normalized;
  return `'${normalized.replace(/'/g, `'\\''`)}'`;
}

function quoteShellArg(value) {
  return isWindows ? quoteWindowsArg(value) : quotePosixArg(value);
}

// Expands a leading `~` the way a POSIX shell would; needed when args bypass the shell.
function expandHomeDir(inputPath) {
  const value = String(inputPath || '');
  if (value === '~') return os.homedir();
  if (/^~[\\/]/u.test(value)) return path.join(os.homedir(), value.slice(2));
  return value;
}

// ── PATH lookup ────────────────────────────────────────
function isExecutableFile(candidate) {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function isPathExisting(candidate) {
  try {
    return fs.existsSync(candidate) || fs.lstatSync(candidate).isSymbolicLink() || fs.lstatSync(candidate).isFile();
  } catch (_) {
    return false;
  }
}

// Resolves a bare command name against PATH without going through a shell.
// On Windows, .cmd/.bat shims are preferred over .exe to match `where.exe` usage elsewhere.
function findOnPath(command) {
  if (!command) return null;
  if (path.isAbsolute(command)) return isPathExisting(command) ? command : null;

  if (isWindows) {
    try {
      const output = execFileSync('where.exe', [command], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const matches = output.split(/\r?\n/).filter(Boolean);
      return matches.find((match) => /\.(cmd|bat)$/i.test(match))
        || matches.find((match) => /\.exe$/i.test(match))
        || matches[0]
        || null;
    } catch (_) {
      return null;
    }
  }

  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, command);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

// GUI-launched apps on macOS (Finder/Dock) and some Linux launchers get a minimal PATH that
// lacks Homebrew, nvm, ~/.local/bin, etc. Ask the user's login shell for its PATH and merge it
// in so CLI tools (claude, codex, code, ...) resolve the same way they do in a terminal.
function syncPathFromLoginShell() {
  if (isWindows) return;
  const userShell = process.env.SHELL || (isMac ? '/bin/zsh' : '/bin/bash');
  const marker = '__CODINGSPACE_PATH__';
  try {
    const output = execFileSync(userShell, ['-ilc', `printf '${marker}%s${marker}' "$PATH"`], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const match = output.match(new RegExp(`${marker}(.*)${marker}`, 's'));
    if (!match || !match[1]) return;
    const merged = [...match[1].split(path.delimiter), ...(process.env.PATH || '').split(path.delimiter)]
      .filter(Boolean);
    process.env.PATH = [...new Set(merged)].join(path.delimiter);
  } catch (_) {
    // Keep the inherited PATH if the shell is slow, missing, or prints nothing.
  }
}

// ── Detached app launching ─────────────────────────────
// Starts a GUI app without tying its lifetime to ours. Handles Windows .cmd/.bat shims and
// macOS .app bundles, which cannot be exec'd directly.
function launchDetached(exe, args = [], { cwd }: { cwd?: string } = {}) {
  const ext = path.extname(exe).toLowerCase();
  let file = exe;
  let fileArgs = args;
  let useShell = false;

  if (isWindows && (ext === '.cmd' || ext === '.bat')) {
    file = 'cmd.exe';
    fileArgs = ['/d', '/c', exe, ...args];
  } else if (isMac && ext === '.app') {
    file = 'open';
    fileArgs = ['-a', exe, ...args];
  } else if (!path.isAbsolute(exe)) {
    if (isWindows) {
      useShell = true;
    } else {
      file = findOnPath(exe);
      if (!file) throw new Error(`Executable not found on PATH: ${exe}`);
    }
  }

  const child = spawn(file, fileArgs, { cwd, shell: useShell, detached: true, stdio: 'ignore' });
  child.on('error', (err) => console.error(`Failed to launch ${exe}:`, err));
  child.unref();
}

// ── External terminal ──────────────────────────────────
function escapeAppleScriptString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Linux terminal emulators disagree on flags; each entry maps (cwd, argv) to that emulator's CLI.
const LINUX_TERMINALS = [
  { bin: 'x-terminal-emulator', build: (_cwd, argv) => (argv ? ['-e', ...argv] : []) },
  { bin: 'gnome-terminal', build: (cwd, argv) => [`--working-directory=${cwd}`, ...(argv ? ['--', ...argv] : [])] },
  { bin: 'konsole', build: (cwd, argv) => ['--workdir', cwd, ...(argv ? ['-e', ...argv] : [])] },
  { bin: 'xfce4-terminal', build: (cwd, argv) => [`--working-directory=${cwd}`, ...(argv ? ['-x', ...argv] : [])] },
  { bin: 'kitty', build: (cwd, argv) => ['--directory', cwd, ...(argv || [])] },
  { bin: 'alacritty', build: (cwd, argv) => ['--working-directory', cwd, ...(argv ? ['-e', ...argv] : [])] },
  { bin: 'wezterm', build: (cwd, argv) => ['start', '--cwd', cwd, ...(argv ? ['--', ...argv] : [])] },
  { bin: 'xterm', build: (_cwd, argv) => (argv ? ['-e', ...argv] : []) },
];

// Opens a new OS terminal window at `cwd`, optionally running `shellCommand` and keeping the
// shell open afterwards (like `cmd /k`).
function openExternalTerminal({ cwd, shellCommand }) {
  if (isWindows) {
    const args = shellCommand
      ? ['new-tab', '-d', cwd, 'cmd.exe', '/d', '/k', shellCommand]
      : ['new-tab', '-d', cwd];
    spawn('wt.exe', args, { detached: true, stdio: 'ignore', shell: true }).unref();
    return;
  }

  if (isMac) {
    const script = `cd ${quotePosixArg(cwd)}${shellCommand ? ` && ${shellCommand}` : ''}`;
    const child = spawn('osascript', [
      '-e', `tell application "Terminal" to do script "${escapeAppleScriptString(script)}"`,
      '-e', 'tell application "Terminal" to activate',
    ], { detached: true, stdio: 'ignore' });
    child.on('error', (err) => console.error('Failed to open Terminal:', err));
    child.unref();
    return;
  }

  const terminal = LINUX_TERMINALS.map((entry) => ({ ...entry, file: findOnPath(entry.bin) }))
    .find((entry) => entry.file);
  if (!terminal) {
    throw new Error(`No supported terminal emulator found. Install one of: ${LINUX_TERMINALS.map((t) => t.bin).join(', ')}`);
  }
  const argv = shellCommand
    ? ['/bin/sh', '-c', `${shellCommand}; exec "\${SHELL:-/bin/sh}"`]
    : null;
  const child = spawn(terminal.file, terminal.build(cwd, argv), { cwd, detached: true, stdio: 'ignore' });
  child.on('error', (err) => console.error(`Failed to open ${terminal.bin}:`, err));
  child.unref();
}

module.exports = {
  isWindows,
  isMac,
  quoteShellArg,
  findOnPath,
  syncPathFromLoginShell,
  expandHomeDir,
  launchDetached,
  openExternalTerminal,
};
