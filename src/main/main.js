const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { execSync, spawn, exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');

// ── State ──────────────────────────────────────────────
let workspaceConfig = { projects: [] };
const configPath = path.join(app.getPath('userData'), 'workspaces.json');
let mainWindow = null;
const ptyProcesses = new Map(); // id -> pty process

// ── Config persistence ─────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      workspaceConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  return workspaceConfig;
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(workspaceConfig, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

// ── Git Helpers ────────────────────────────────────────
function getWorktrees(projectPath) {
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 10000,
    });

    const worktrees = [];
    let current = {};

    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        current = { path: line.replace('worktree ', '').trim() };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.replace('HEAD ', '').trim();
      } else if (line.startsWith('branch ')) {
        current.branch = line.replace('branch refs/heads/', '').trim();
      } else if (line === 'bare') {
        current.bare = true;
      } else if (line === 'detached') {
        current.detached = true;
      } else if (line === '') {
        if (current.path) {
          current.name = path.basename(current.path);
          current.id = Buffer.from(current.path).toString('base64url');
          worktrees.push(current);
        }
        current = {};
      }
    }

    return worktrees;
  } catch (e) {
    console.error('Failed to get worktrees for', projectPath, ':', e.message);
    return [];
  }
}

function getGitInfo(dirPath) {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: dirPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    const statusOutput = execSync('git status --porcelain', {
      cwd: dirPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    const modifiedCount = statusOutput ? statusOutput.split('\n').length : 0;

    let lastCommit = '';
    let lastCommitDate = '';
    try {
      lastCommit = execSync('git log -1 --format="%s"', {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      lastCommitDate = execSync('git log -1 --format="%cr"', {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
    } catch (_) {}

    let aheadBehind = '';
    try {
      aheadBehind = execSync('git rev-list --left-right --count HEAD...@{upstream}', {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
    } catch (_) {}

    return { branch, modifiedCount, lastCommit, lastCommitDate, aheadBehind };
  } catch (e) {
    return { branch: 'unknown', modifiedCount: 0, lastCommit: '', lastCommitDate: '', aheadBehind: '' };
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

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return mainWindow;
}

// ── App lifecycle ──────────────────────────────────────
app.whenReady().then(() => {
  loadConfig();
  createWindow();

  // ── Window controls ──
  ipcMain.on('window:minimize', () => mainWindow.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow.close());

  // ── Workspace API ────────────────────────────────────

  ipcMain.handle('get-workspaces', () => workspaceConfig.projects);

  ipcMain.handle('add-project', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select a Git Project Root',
    });
    if (result.canceled || !result.filePaths.length) return null;

    const projectPath = result.filePaths[0];
    if (workspaceConfig.projects.find((p) => p.path === projectPath)) {
      return { error: 'Project already added' };
    }

    let worktrees = getWorktrees(projectPath);
    if (!worktrees || worktrees.length === 0) {
      worktrees = [{
        path: projectPath,
        name: path.basename(projectPath),
        id: Buffer.from(projectPath).toString('base64url'),
        branch: 'none'
      }];
    }
    const project = {
      path: projectPath,
      name: path.basename(projectPath),
      worktrees,
      addedAt: Date.now(),
    };

    workspaceConfig.projects.push(project);
    saveConfig();
    return project;
  });

  ipcMain.handle('remove-project', (_, projectPath) => {
    workspaceConfig.projects = workspaceConfig.projects.filter(
      (p) => p.path !== projectPath
    );
    saveConfig();
    return true;
  });

  ipcMain.handle('refresh-worktrees', (_, projectPath) => {
    let worktrees = getWorktrees(projectPath);
    if (!worktrees || worktrees.length === 0) {
      worktrees = [{
        path: projectPath,
        name: path.basename(projectPath),
        id: Buffer.from(projectPath).toString('base64url'),
        branch: 'none'
      }];
    }
    const project = workspaceConfig.projects.find((p) => p.path === projectPath);
    if (project) {
      project.worktrees = worktrees;
      saveConfig();
    }
    return worktrees;
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
    shell.openPath(dirPath);
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

  ipcMain.handle('add-worktree', async (_, { projectPath, branchName, wtPath }) => {
    try {
      const output = execSync(`git worktree add "${wtPath}" ${branchName}`, {
        cwd: projectPath,
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
});

app.on('window-all-closed', () => {
  // Kill all PTY processes
  for (const [id, proc] of ptyProcesses) {
    try { proc.kill(); } catch (_) {}
  }
  ptyProcesses.clear();
  app.quit();
});
