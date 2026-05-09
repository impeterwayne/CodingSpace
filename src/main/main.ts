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
const { installPtyShutdownLifecycle } = require('./process/ptyLifecycle');

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
    const proc = ptyProcesses.get(id);
    if (proc) {
      proc.kill();
      ptyProcesses.delete(id);
    }
    return { success: true };
  });

  // ── Launch Actions (kept for external terminal) ──────

  ipcMain.handle('open-wt', (_, { cwd, useTmux, sessionName }) => {
    try {
      let args;
      if (useTmux) {
        const safeName = (sessionName || 'main').replace(/[^a-zA-Z0-9_-]/g, '_');
        args = ['-d', cwd, '--', 'tmux', 'new-session', '-A', '-s', safeName];
      } else {
        args = ['-d', cwd];
      }
      spawn('wt.exe', args, { detached: true, stdio: 'ignore', shell: true });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('open-in-editor', (_, dirPath) => {
    try {
      spawn('code', [dirPath], { shell: true, detached: true, stdio: 'ignore' });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('open-in-explorer', (_, dirPath) => {
    void shell.openPath(dirPath);
    return { success: true };
  });

  // ── Launch tool actions ──────────────────────────────

  ipcMain.handle('open-in-android-studio', (_, dirPath) => {
    try {
      // Run `studio64 .` with cwd set to the project directory
      spawn('studio64', ['.'], { cwd: dirPath, shell: true, detached: true, stdio: 'ignore' });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('open-in-antigravity', (_, dirPath) => {
    try {
      // Launch Antigravity in the worktree directory
      spawn('antigravity', [dirPath], { cwd: dirPath, shell: true, detached: true, stdio: 'ignore' });
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

  ipcMain.handle('remove-worktree', async (_, { projectPath, wtPath }) => {
    try {
      const output = execSync(`git worktree remove "${wtPath}"`, {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 30000,
      });
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, error: e.stderr || e.message };
    }
  });

  ipcMain.handle('force-remove-worktree', async (_, { projectPath, wtPath }) => {
    try {
      if (!projectPath || !wtPath) {
        return { success: false, error: 'Project path and worktree path are required' };
      }
      if (projectPath === wtPath) {
        return { success: false, error: 'Cannot remove the primary project worktree' };
      }
      const output = execSync(`git worktree remove --force "${wtPath}"`, {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 30000,
      });
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, error: e.stderr || e.message };
    }
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
