const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { execSync, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');
const { getWorktrees: readWorktrees, getGitInfo: readGitInfo } = require('./git/gitInfo');
const { createWorkspaceConfigStore } = require('../application/workspaceConfigStore');
const { createWorkspaceService } = require('../application/workspaceService');
const { registerWorkspaceIpc } = require('./ipc/workspaceIpc');
const { installPtyShutdownLifecycle, killPtyProcess } = require('./process/ptyLifecycle');

// ── State ──────────────────────────────────────────────
const configPath = path.join(app.getPath('userData'), 'workspaces.json');
const workspaceConfigStore = createWorkspaceConfigStore({ configPath });
const workspaceService = createWorkspaceService({
  configStore: workspaceConfigStore,
  getWorktrees: (projectPath) => readWorktrees(projectPath, execSync, path, Buffer),
});
let mainWindow = null;
const ptyProcesses = new Map(); // id -> pty process

// ── Git Helpers ────────────────────────────────────────
function getGitInfo(dirPath) {
  return readGitInfo(dirPath, execSync);
}

function shellQuoteWindowsArg(value) {
  const normalized = String(value);
  if (!/[\s"]/u.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}

function buildShellCommand(commandOrPath, args = []) {
  return [commandOrPath, ...args].map(shellQuoteWindowsArg).join(' ');
}

function resolveToolLaunch(command, extraArgs = []) {
  const launchArgs = Array.isArray(extraArgs) ? extraArgs.map((arg) => String(arg)) : [];

  if (process.platform !== 'win32') {
    return {
      file: command,
      args: launchArgs,
      shellCommand: buildShellCommand(command, launchArgs),
    };
  }

  try {
    const output = execFileSync('where.exe', [command], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    const matches = output.split(/\r?\n/).filter(Boolean);
    const resolvedPath = matches.find((match) => /\.(cmd|bat)$/i.test(match))
      || matches.find((match) => /\.exe$/i.test(match))
      || matches[0];
    if (!resolvedPath) {
      throw new Error(`Tool not found on PATH: ${command}`);
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (ext === '.cmd' || ext === '.bat') {
      return {
        file: 'cmd.exe',
        args: ['/d', '/c', resolvedPath, ...launchArgs],
        shellCommand: buildShellCommand(resolvedPath, launchArgs),
      };
    }

    return {
      file: resolvedPath,
      args: launchArgs,
      shellCommand: buildShellCommand(resolvedPath, launchArgs),
    };
  } catch (error) {
    throw new Error(error?.message || `Tool not found on PATH: ${command}`);
  }
}

function getRecentCommits(dirPath, count = 5) {
  try {
    const output = execSync(`git log -${count} --format="%h|%s|%cr|%an"`, {
      cwd: dirPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    return output.split('\n').filter(Boolean).map((line) => {
      const [hash, message, date, author] = line.split('|');
      return { hash, message, date, author };
    });
  } catch (_) {
    return [];
  }
}

function normalizeWorktreePath(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function findWorktree(projectPath, wtPath) {
  const normalizedWtPath = normalizeWorktreePath(wtPath);
  return readWorktrees(projectPath, execSync, path, Buffer)
    .find((worktree) => worktree.path && normalizeWorktreePath(worktree.path) === normalizedWtPath);
}

function isLocalBranch(projectPath, branchName) {
  if (!branchName) {
    return false;
  }

  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
      cwd: projectPath,
      stdio: 'ignore',
      timeout: 10000,
    });
    return true;
  } catch (_) {
    return false;
  }
}

function isLockRelatedRemoveError(error) {
  const message = `${error?.stderr || ''}\n${error?.message || ''}`.toLowerCase();
  return message.includes('permission denied')
    || message.includes('access is denied')
    || message.includes('device or resource busy')
    || message.includes('used by another process')
    || message.includes('file is being used by another process');
}

function closePtyById(id) {
  const proc = ptyProcesses.get(id);
  if (!proc) {
    return false;
  }

  killPtyProcess(proc, execSync);
  ptyProcesses.delete(id);
  return true;
}

function removeWorktreeWithOptionalBranchDelete({ projectPath, wtPath, force = false, deleteBranch = false }) {
  if (!projectPath || !wtPath) {
    return { success: false, error: 'Project path and worktree path are required' };
  }

  if (normalizeWorktreePath(projectPath) === normalizeWorktreePath(wtPath)) {
    return { success: false, error: 'Cannot remove the primary project worktree' };
  }

  const worktree = findWorktree(projectPath, wtPath);
  if (!worktree) {
    return { success: false, error: 'Worktree path was not found in this repository' };
  }

  if (deleteBranch) {
    if (!worktree.branch || worktree.detached || worktree.bare) {
      return { success: false, error: 'Cannot delete branch: worktree does not have a local branch' };
    }
    if (!isLocalBranch(projectPath, worktree.branch)) {
      return { success: false, error: 'Cannot delete branch: only local branches can be deleted' };
    }
  }

  let removeOutput = '';
  try {
    const removeArgs = ['worktree', 'remove'];
    if (force) removeArgs.push('--force');
    removeArgs.push(wtPath);
    removeOutput = execFileSync('git', removeArgs, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 30000,
    }) || '';
  } catch (e) {
    const errorMessage = e.stderr || e.message;
    if (isLockRelatedRemoveError(e)) {
      return {
        success: false,
        error: `${errorMessage}\nClose terminals, editors, Explorer windows, or other apps using this worktree, then retry. Admin rights usually do not fix active file locks.`,
      };
    }
    return { success: false, error: errorMessage };
  }

  if (!deleteBranch) {
    return { success: true, output: removeOutput.trim() };
  }

  try {
    const branchOutput = execFileSync('git', ['branch', '--delete', worktree.branch], {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 30000,
    }) || '';
    const output = [removeOutput, branchOutput].filter(Boolean).join('\n').trim();
    return { success: true, output, branchDeleted: true };
  } catch (e) {
    const branchDeleteError = e.stderr || e.message;
    return {
      success: false,
      error: `Worktree removed but branch deletion failed: ${branchDeleteError}`,
      output: removeOutput.trim(),
      removedWorktree: true,
      branchDeleted: false,
    };
  }
}

// ── Detect default shell ───────────────────────────────
function getDefaultShell() {
  if (process.platform === 'win32') {
    // Prefer PowerShell 7+ if available, then pwsh, then powershell
    const pwshPaths = [
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Program Files\\PowerShell\\pwsh.exe',
    ];
    for (const p of pwshPaths) {
      if (fs.existsSync(p)) return p;
    }
    // Check if pwsh is on PATH
    try {
      execSync('where pwsh', { encoding: 'utf-8', timeout: 3000 });
      return 'pwsh.exe';
    } catch (_) {}
    return 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

// ── External links ─────────────────────────────────────
// Only http/https reach the OS handler; other schemes (file:, javascript:, custom
// protocols) are ignored so terminal output can't launch arbitrary apps.
function openExternalUrl(url) {
  if (typeof url !== 'string') return { success: false, error: 'Invalid URL' };
  if (!/^https?:\/\//iu.test(url)) return { success: false, error: 'Unsupported URL scheme' };
  shell.openExternal(url).catch((err) => {
    console.error('Failed to open external link:', err);
  });
  return { success: true };
}

// ── Window ─────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#08080d',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Intercept window.open calls (e.g. from xterm web-links addon or target="_blank" links).
  // Note: some callers (xterm's WebLinksAddon) call window.open() with no URL and then assign
  // location.href, so `url` here can be about:blank — never let that spawn a child window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });

  // Intercept standard navigation in the main window (e.g. clicks on normal HTTP/HTTPS links)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });

  mainWindow.loadFile(path.join(app.getAppPath(), 'src', 'renderer', 'index.html'));
  return mainWindow;
}

// ── App lifecycle ──────────────────────────────────────
app.whenReady().then(() => {
  workspaceConfigStore.loadConfig();
  createWindow();
  registerWorkspaceIpc({
    ipcMain,
    dialog,
    mainWindow,
    workspaceService,
  });

  ipcMain.handle('get-git-info', (_, dirPath) => getGitInfo(dirPath));
  ipcMain.handle('get-recent-commits', (_, dirPath) => getRecentCommits(dirPath));

  ipcMain.handle('symlink:check-status', (_, { worktreePath, name, targetPath }) => {
    const linkPath = path.join(worktreePath, name);
    try {
      const stats = fs.lstatSync(linkPath);
      let currentTarget = null;
      let isLink = stats.isSymbolicLink();
      
      if (isLink) {
        currentTarget = fs.readlinkSync(linkPath);
      } else if (stats.isDirectory()) {
        try {
          currentTarget = fs.readlinkSync(linkPath);
          isLink = true;
        } catch (e) {}
      }
      
      if (isLink && currentTarget) {
        const resolvedCurrent = path.resolve(worktreePath, currentTarget).toLowerCase();
        const resolvedTarget = path.resolve(targetPath).toLowerCase();
        if (resolvedCurrent === resolvedTarget) {
          return { exists: true, pointsToTarget: true };
        } else {
          return { exists: true, pointsToTarget: false, currentTarget: resolvedCurrent };
        }
      } else {
        return { exists: true, isRealDirectory: !isLink && stats.isDirectory(), pointsToTarget: false };
      }
    } catch (e) {
      return { exists: false, pointsToTarget: false };
    }
  });

  ipcMain.handle('symlink:create', (_, { worktreePath, name, targetPath }) => {
    const linkPath = path.join(worktreePath, name);
    try {
      try {
        const stats = fs.lstatSync(linkPath);
        let isLink = stats.isSymbolicLink();
        if (!isLink && stats.isDirectory()) {
          try {
            fs.readlinkSync(linkPath);
            isLink = true;
          } catch (e) {}
        }
        
        if (isLink) {
          fs.unlinkSync(linkPath);
        } else {
          return { success: false, error: `A real file or folder already exists at "${name}". Please delete or rename it first.` };
        }
      } catch (e) {}
      
      const type = process.platform === 'win32' ? 'junction' : 'dir';
      fs.symlinkSync(targetPath, linkPath, type);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('symlink:delete', (_, { worktreePath, name }) => {
    const linkPath = path.join(worktreePath, name);
    try {
      const stats = fs.lstatSync(linkPath);
      let isLink = stats.isSymbolicLink();
      if (!isLink && stats.isDirectory()) {
        try {
          fs.readlinkSync(linkPath);
          isLink = true;
        } catch (e) {}
      }
      
      if (isLink) {
        fs.unlinkSync(linkPath);
        return { success: true };
      } else {
        return { success: false, error: `Refusing to delete: "${name}" is a real file or folder, not a symlink.` };
      }
    } catch (e) {
      return { success: true };
    }
  });

  ipcMain.handle('symlink:scan', (_, { worktreePath }) => {
    if (!worktreePath) return [];
    try {
      const files = fs.readdirSync(worktreePath);
      const discovered = [];
      for (const file of files) {
        const linkPath = path.join(worktreePath, file);
        try {
          const stats = fs.lstatSync(linkPath);
          let isLink = stats.isSymbolicLink();
          let target = null;
          if (isLink) {
            target = fs.readlinkSync(linkPath);
          } else if (stats.isDirectory()) {
            try {
              target = fs.readlinkSync(linkPath);
              isLink = true;
            } catch (e) {}
          }
          
          if (isLink && target) {
            discovered.push({
              name: file,
              targetPath: path.resolve(worktreePath, target),
            });
          }
        } catch (e) {}
      }
      return discovered;
    } catch (err) {
      console.error('Failed to scan symlinks:', err);
      return [];
    }
  });

  ipcMain.handle('git:update-exclude', (_, { worktreePath, patterns, action }) => {
    try {
      let excludePath;
      try {
        const gitExcludeRel = execSync('git rev-parse --git-path info/exclude', {
          cwd: worktreePath,
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        excludePath = path.resolve(worktreePath, gitExcludeRel);
      } catch (e) {
        excludePath = path.join(worktreePath, '.git', 'info', 'exclude');
      }

      const infoDir = path.dirname(excludePath);
      
      let lines = [];
      if (fs.existsSync(excludePath)) {
        lines = fs.readFileSync(excludePath, 'utf-8')
          .split(/\r?\n/)
          .map(l => l.trim());
      }

      if (action === 'add') {
        if (!fs.existsSync(infoDir)) {
          fs.mkdirSync(infoDir, { recursive: true });
        }
        
        let changed = false;
        const newLines = [...lines];
        
        const header = '# Agent toolkit (auto-added by coding-space)';
        if (!newLines.includes(header) && !newLines.includes('# SkillHub toolkit (auto-added by coding-space)')) {
          if (newLines.length > 0 && newLines[newLines.length - 1] !== '') {
            newLines.push('');
          }
          newLines.push(header);
          changed = true;
        }
        
        for (const pattern of patterns) {
          if (!newLines.includes(pattern)) {
            newLines.push(pattern);
            changed = true;
          }
        }
        
        if (changed) {
          fs.writeFileSync(excludePath, newLines.join('\n') + '\n', 'utf-8');
        }
      } else if (action === 'remove') {
        if (fs.existsSync(excludePath)) {
          let changed = false;
          const filteredLines = lines.filter(line => {
            if (patterns.includes(line)) {
              changed = true;
              return false;
            }
            if (line === '# SkillHub toolkit (auto-added by coding-space)' || line === '# Agent toolkit (auto-added by coding-space)') {
              changed = true;
              return false;
            }
            return true;
          });
          
          const finalLines = [];
          for (let i = 0; i < filteredLines.length; i++) {
            if (filteredLines[i] === '' && (i === 0 || filteredLines[i-1] === '')) {
              changed = true;
              continue;
            }
            finalLines.push(filteredLines[i]);
          }
          
          if (changed) {
            fs.writeFileSync(excludePath, finalLines.join('\n') + '\n', 'utf-8');
          }
        }
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('dir:create', (_, { dirPath }) => {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('path:exists', (_, targetPath) => {
    return fs.existsSync(targetPath);
  });

  ipcMain.handle('project:write-file', (_, { worktreePath, filename, content }) => {
    try {
      if (!worktreePath || !filename) {
        throw new Error('Worktree path and filename are required.');
      }
      const targetFilePath = path.join(worktreePath, filename);
      const parentDir = path.dirname(targetFilePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(targetFilePath, content, 'utf-8');
      return { success: true, filePath: targetFilePath };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('project:download-file', async (_, { url, targetFilePath }) => {
    try {
      if (!url || !targetFilePath) {
        throw new Error('URL and targetFilePath are required.');
      }
      if (fs.existsSync(targetFilePath) && fs.statSync(targetFilePath).size > 0) {
        return { success: true, cached: true, filePath: targetFilePath };
      }
      const parentDir = path.dirname(targetFilePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} (${response.statusText})`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(targetFilePath, buffer);
      return { success: true, cached: false, filePath: targetFilePath };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  // Directory recursive copy helper
  function copyFolderSync(from, to) {
    if (!fs.existsSync(from)) return;
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      const entries = fs.readdirSync(from, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(from, entry.name);
        const destPath = path.join(to, entry.name);
        copyFolderSync(srcPath, destPath);
      }
    } else {
      const parentDir = path.dirname(to);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.copyFileSync(from, to);
    }
  }

  // File/directory attribute reset helper for read-only files
  function clearReadOnlyAttributes(targetPath) {
    if (!fs.existsSync(targetPath)) return;
    try {
      const stat = fs.statSync(targetPath);
      fs.chmodSync(targetPath, 0o666);
      if (stat.isDirectory()) {
        const items = fs.readdirSync(targetPath);
        for (const item of items) {
          clearReadOnlyAttributes(path.join(targetPath, item));
        }
      }
    } catch (e) {
      // Ignore errors resetting attributes
    }
  }

  // Safe recursive remove helper
  function safeRmSync(targetPath) {
    if (!fs.existsSync(targetPath)) return;
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        clearReadOnlyAttributes(targetPath);
        try {
          fs.rmSync(targetPath, { recursive: true, force: true });
        } catch (retryErr) {
          throw retryErr;
        }
      } else {
        throw err;
      }
    }
  }

  ipcMain.handle('toolkit:get-default-sources', () => {
    const toolkitsDir = app.isPackaged
      ? path.join(process.resourcesPath, 'toolkits')
      : path.join(app.getAppPath(), 'toolkits');
    return {
      openspecPath: path.join(toolkitsDir, 'OpenSpec'),
      bmadPath: path.join(toolkitsDir, 'BMAD-METHOD')
    };
  });

  ipcMain.handle('toolkit:check-status', (_, { worktreePath, name, sourcePath }) => {
    const targetPath = path.join(worktreePath, name);
    try {
      if (sourcePath && fs.existsSync(sourcePath)) {
        const stats = fs.statSync(sourcePath);
        if (stats.isDirectory()) {
          if (!fs.existsSync(targetPath)) {
            return { exists: false };
          }
          const items = fs.readdirSync(sourcePath);
          if (items.length === 0) {
            return { exists: fs.existsSync(targetPath) };
          }
          for (const item of items) {
            const itemDest = path.join(targetPath, item);
            if (!fs.existsSync(itemDest)) {
              return { exists: false };
            }
          }
          return { exists: true };
        } else {
          return { exists: fs.existsSync(targetPath) };
        }
      } else {
        const exists = fs.existsSync(targetPath);
        return { exists };
      }
    } catch (e) {
      return { exists: false };
    }
  });

  ipcMain.handle('toolkit:deploy', (_, { worktreePath, name, sourcePath }) => {
    const destPath = path.join(worktreePath, name);
    try {
      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: `Source path does not exist: ${sourcePath}` };
      }
      const stats = fs.statSync(sourcePath);
      if (stats.isDirectory()) {
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true });
        }
        const items = fs.readdirSync(sourcePath);
        for (const item of items) {
          const itemSrc = path.join(sourcePath, item);
          const itemDest = path.join(destPath, item);
          if (fs.existsSync(itemDest)) {
            safeRmSync(itemDest);
          }
          copyFolderSync(itemSrc, itemDest);
        }
      } else {
        if (!fs.existsSync(path.dirname(destPath))) {
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
        }
        if (fs.existsSync(destPath)) {
          safeRmSync(destPath);
        }
        fs.copyFileSync(sourcePath, destPath);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('toolkit:remove', (_, { worktreePath, name, sourcePath }) => {
    const destPath = path.join(worktreePath, name);
    try {
      if (sourcePath && fs.existsSync(sourcePath)) {
        const stats = fs.statSync(sourcePath);
        if (stats.isDirectory()) {
          if (fs.existsSync(destPath)) {
            const items = fs.readdirSync(sourcePath);
            for (const item of items) {
              const itemDest = path.join(destPath, item);
              if (fs.existsSync(itemDest)) {
                safeRmSync(itemDest);
              }
            }
            try {
              if (fs.readdirSync(destPath).length === 0) {
                safeRmSync(destPath);
              }
            } catch (e) {
              // Ignore failure to remove empty directory
            }
          }
        } else {
          if (fs.existsSync(destPath)) {
            safeRmSync(destPath);
          }
        }
      } else {
        if (fs.existsSync(destPath)) {
          safeRmSync(destPath);
        }
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });


  // ── PTY / Embedded Terminal ──────────────────────────

  ipcMain.handle('pty:create', (_, { cwd, id }) => {
    try {
      const shellPath = getDefaultShell();
      const shellArgs = shellPath.includes('pwsh') || shellPath.includes('powershell')
        ? ['-NoLogo']
        : [];

      const ptyProc = pty.spawn(shellPath, shellArgs, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: cwd || os.homedir(),
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      ptyProcesses.set(id, ptyProc);

      ptyProc.onData((data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('pty:data', { id, data });
        }
      });

      ptyProc.onExit(({ exitCode }) => {
        ptyProcesses.delete(id);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('pty:exit', { id, exitCode });
        }
      });

      return { success: true, pid: ptyProc.pid };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('pty:create-tool', (_, { cwd, id, command, args = [] }) => {
    try {
      const { file: toolPath, args: toolArgs } = resolveToolLaunch(command, args);

      const ptyProc = pty.spawn(toolPath, toolArgs, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: cwd || os.homedir(),
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      ptyProcesses.set(id, ptyProc);

      ptyProc.onData((data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('pty:data', { id, data });
        }
      });

      ptyProc.onExit(({ exitCode }) => {
        ptyProcesses.delete(id);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('pty:exit', { id, exitCode });
        }
      });

      return { success: true, pid: ptyProc.pid };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('tool:resolve-launch', (_, { command, args = [] }) => {
    try {
      const { shellCommand } = resolveToolLaunch(command, args);
      return { success: true, shellCommand };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.on('pty:write', (_, { id, data }) => {
    const proc = ptyProcesses.get(id);
    if (proc) proc.write(data);
  });

  ipcMain.on('pty:resize', (_, { id, cols, rows }) => {
    const proc = ptyProcesses.get(id);
    if (proc) {
      try {
        proc.resize(cols, rows);
      } catch (_) {}
    }
  });

  ipcMain.handle('pty:kill', (_, { id }) => {
    closePtyById(id);
    return { success: true };
  });

  // ── Launch Actions (kept for external terminal) ──────

  ipcMain.handle('open-wt', (_, { cwd, launchCommand, launchArgs = [] }) => {
    try {
      const args = launchCommand
        ? ['new-tab', '-d', cwd, 'cmd.exe', '/d', '/k', resolveToolLaunch(launchCommand, launchArgs).shellCommand]
        : ['new-tab', '-d', cwd];
      spawn('wt.exe', args, { detached: true, stdio: 'ignore', shell: true });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('open-in-editor', (_, dirPath) => {
    try {
      const settings = workspaceService.getSettings();
      const exe = settings.vscodePath || findVsCodeExecutable();
      const ext = path.extname(exe).toLowerCase();
      let spawnFile;
      let spawnArgs;
      if (ext === '.cmd' || ext === '.bat') {
        spawnFile = 'cmd.exe';
        spawnArgs = ['/d', '/c', exe, dirPath];
      } else {
        spawnFile = exe;
        spawnArgs = [dirPath];
      }
      const useShell = !path.isAbsolute(exe);
      spawn(spawnFile, spawnArgs, { cwd: dirPath, shell: useShell, detached: true, stdio: 'ignore' });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('open-external', (_, url) => openExternalUrl(url));

  ipcMain.handle('open-in-explorer', (_, dirPath) => {
    void shell.openPath(dirPath);
    return { success: true };
  });

  // ── Launch tool actions ──────────────────────────────

  ipcMain.handle('open-in-android-studio', (_, dirPath) => {
    try {
      const settings = workspaceService.getSettings();
      const exe = settings.androidStudioPath || findAndroidStudioExecutable();
      const ext = path.extname(exe).toLowerCase();
      let spawnFile;
      let spawnArgs;
      if (ext === '.cmd' || ext === '.bat') {
        spawnFile = 'cmd.exe';
        spawnArgs = ['/d', '/c', exe, dirPath];
      } else {
        spawnFile = exe;
        spawnArgs = [dirPath];
      }
      const useShell = !path.isAbsolute(exe);
      spawn(spawnFile, spawnArgs, { cwd: dirPath, shell: useShell, detached: true, stdio: 'ignore' });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  function detectPath(command, possiblePaths) {
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    if (process.platform === 'win32') {
      try {
        const output = execFileSync('where.exe', [command], {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const matches = output.split(/\r?\n/).filter(Boolean);
        const resolvedPath = matches.find((match) => /\.(cmd|bat)$/i.test(match))
          || matches.find((match) => /\.exe$/i.test(match))
          || matches[0];
        if (resolvedPath && fs.existsSync(resolvedPath)) {
          return resolvedPath;
        }
      } catch (_) {}
    } else {
      try {
        const output = execSync(`which ${command}`, {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (output && fs.existsSync(output)) {
          return output;
        }
      } catch (_) {}
    }
    return null;
  }

  ipcMain.handle('detect-integration-paths', () => {
    return {
      antigravityPath: detectPath('antigravity-ide', [
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe'),
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Antigravity IDE', 'Antigravity IDE.exe'),
      ]),
      antigravityAgentPath: detectPath('antigravity', [
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe'),
      ]),
      androidStudioPath: detectPath('studio64', [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Android', 'Android Studio', 'bin', 'studio64.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Android', 'Android Studio', 'bin', 'studio64.exe'),
        path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Android Studio', 'bin', 'studio64.exe'),
      ]),
      vscodePath: detectPath('code', [
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'bin', 'code.cmd'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft VS Code', 'bin', 'code.cmd'),
      ]),
    };
  });


  function findAntigravityExecutable() {
    const possiblePaths = [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe'),
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Antigravity IDE', 'Antigravity IDE.exe'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    try {
      return resolveToolLaunch('antigravity-ide').file;
    } catch (_) {
      return 'antigravity-ide';
    }
  }

  function findAntigravityAgentExecutable() {
    const possiblePaths = [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    try {
      return resolveToolLaunch('antigravity').file;
    } catch (_) {
      return 'antigravity';
    }
  }

  function findAndroidStudioExecutable() {
    const possiblePaths = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Android', 'Android Studio', 'bin', 'studio64.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Android', 'Android Studio', 'bin', 'studio64.exe'),
      path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Android Studio', 'bin', 'studio64.exe'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    try {
      return resolveToolLaunch('studio64').file;
    } catch (_) {
      return 'studio64';
    }
  }

  function findVsCodeExecutable() {
    const possiblePaths = [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'bin', 'code.cmd'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft VS Code', 'bin', 'code.cmd'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    try {
      return resolveToolLaunch('code').file;
    } catch (_) {
      return 'code';
    }
  }

  ipcMain.handle('open-in-antigravity', (_, dirPath) => {
    try {
      const settings = workspaceService.getSettings();
      const exe = settings.antigravityPath || findAntigravityExecutable();
      const ext = path.extname(exe).toLowerCase();
      
      let spawnFile;
      let spawnArgs;
      
      if (ext === '.cmd' || ext === '.bat') {
        spawnFile = 'cmd.exe';
        spawnArgs = ['/d', '/c', exe, dirPath];
      } else {
        spawnFile = exe;
        spawnArgs = [dirPath];
      }

      // Launch Antigravity IDE in the worktree directory safely (no shell-escaping issues)
      spawn(spawnFile, spawnArgs, { cwd: dirPath, shell: false, detached: true, stdio: 'ignore' });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('open-in-antigravity-agent', (_, dirPath) => {
    try {
      const settings = workspaceService.getSettings();
      const exe = settings.antigravityAgentPath || findAntigravityAgentExecutable();
      const ext = path.extname(exe).toLowerCase();
      
      let spawnFile;
      let spawnArgs;
      
      if (ext === '.cmd' || ext === '.bat') {
        spawnFile = 'cmd.exe';
        spawnArgs = ['/d', '/c', exe];
      } else {
        spawnFile = exe;
        spawnArgs = [];
      }

      // Launch Antigravity Agent Manager independently
      const cwd = path.isAbsolute(exe) ? path.dirname(exe) : undefined;
      spawn(spawnFile, spawnArgs, { cwd, shell: false, detached: true, stdio: 'ignore' });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ── Quick git commands ───────────────────────────────

  ipcMain.handle('git-pull', async (_, dirPath) => {
    try {
      const output = execSync('git pull', {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 30000,
      });
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, error: e.stderr || e.message };
    }
  });

  ipcMain.handle('git-fetch', async (_, dirPath) => {
    try {
      const output = execSync('git fetch --all', {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 30000,
      });
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, error: e.stderr || e.message };
    }
  });

  ipcMain.handle('add-worktree', async (_, { projectPath, sourceWorktreePath, branchName, wtPath, createBranch }) => {
    try {
      let cmd;
      if (createBranch) {
        // git worktree add -b <new-branch> <path>
        cmd = `git worktree add -b "${branchName}" "${wtPath}"`;
      } else {
        cmd = `git worktree add "${wtPath}" ${branchName}`;
      }
      const output = execSync(cmd, {
        cwd: sourceWorktreePath || projectPath,
        encoding: 'utf-8',
        timeout: 30000,
      });
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, error: e.stderr || e.message };
    }
  });

  ipcMain.handle('remove-worktree', async (_, { projectPath, wtPath, deleteBranch = false }) => {
    return removeWorktreeWithOptionalBranchDelete({ projectPath, wtPath, deleteBranch, force: false });
  });

  ipcMain.handle('force-remove-worktree', async (_, { projectPath, wtPath, deleteBranch = false }) => {
    return removeWorktreeWithOptionalBranchDelete({ projectPath, wtPath, deleteBranch, force: true });
  });

  ipcMain.handle('get-branches', async (_, projectPath) => {
    try {
      const output = execSync('git branch -a --format="%(refname:short)"', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 10000,
      });
      return output.trim().split('\n').filter(Boolean);
    } catch (_) {
      return [];
    }
  });

  ipcMain.handle('create-branch', async (_, { projectPath, branchName }) => {
    try {
      const output = execSync(`git branch "${branchName}"`, {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 10000,
      });
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, error: e.stderr || e.message };
    }
  });

  ipcMain.handle('merge-worktree-to-branch', async (_, { projectPath, sourceBranch, targetBranch }) => {
    try {
      if (!projectPath || !sourceBranch || !targetBranch) {
        return { success: false, error: 'Project path, source branch, and target branch are required' };
      }
      if (targetBranch.startsWith('origin/')) {
        return { success: false, error: 'Please choose a local target branch' };
      }
      if (sourceBranch === targetBranch) {
        return { success: false, error: 'Source and target branches must be different' };
      }

      const statusOutput = execSync('git status --porcelain', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();

      if (statusOutput) {
        return { success: false, error: 'Target worktree has uncommitted changes. Commit or stash them before merging.' };
      }

      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();

      let output = '';
      try {
        output += execSync(`git checkout "${targetBranch}"`, {
          cwd: projectPath,
          encoding: 'utf-8',
          timeout: 30000,
        });
        output += execSync(`git merge "${sourceBranch}"`, {
          cwd: projectPath,
          encoding: 'utf-8',
          timeout: 30000,
        });
      } finally {
        if (currentBranch && currentBranch !== targetBranch) {
          try {
            execSync(`git checkout "${currentBranch}"`, {
              cwd: projectPath,
              encoding: 'utf-8',
              timeout: 30000,
            });
          } catch (_) {}
        }
      }

      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, error: e.stderr || e.message };
    }
  });
});

installPtyShutdownLifecycle(app, ptyProcesses, execSync);
