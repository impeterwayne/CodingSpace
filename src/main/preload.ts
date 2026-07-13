const { contextBridge, ipcRenderer } = require('electron');

type OpenWindowsTerminalOptions = {
  cwd: string;
  sessionName?: string;
  launchCommand?: string;
  launchArgs?: string[];
};

contextBridge.exposeInMainWorld('api', {
  // ── Window controls ──
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // ── Workspace management ──
  getWorkspaces: () => ipcRenderer.invoke('get-workspaces'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  selectExecutable: () => ipcRenderer.invoke('select-executable'),
  detectIntegrationPaths: () => ipcRenderer.invoke('detect-integration-paths'),
  addProject: () => ipcRenderer.invoke('add-project'),
  removeProject: (path) => ipcRenderer.invoke('remove-project', path),
  refreshWorktrees: (path) => ipcRenderer.invoke('refresh-worktrees', path),
  getGitInfo: (path) => ipcRenderer.invoke('get-git-info', path),
  getRecentCommits: (path) => ipcRenderer.invoke('get-recent-commits', path),

  // ── Launch actions ──
  openWindowsTerminal: (opts: OpenWindowsTerminalOptions) => ipcRenderer.invoke('open-wt', opts),
  openInEditor: (path) => ipcRenderer.invoke('open-in-editor', path),
  openInExplorer: (path) => ipcRenderer.invoke('open-in-explorer', path),
  openInAndroidStudio: (path) => ipcRenderer.invoke('open-in-android-studio', path),
  openInAntigravity: (path) => ipcRenderer.invoke('open-in-antigravity', path),
  openInAntigravityAgent: (path) => ipcRenderer.invoke('open-in-antigravity-agent', path),

  // ── Embedded terminal (PTY) ──
  ptyCreate: (opts) => ipcRenderer.invoke('pty:create', opts),
  ptyCreateTool: (opts) => ipcRenderer.invoke('pty:create-tool', opts),
  resolveToolLaunch: (opts) => ipcRenderer.invoke('tool:resolve-launch', opts),
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  ptyKill: (id) => ipcRenderer.invoke('pty:kill', { id }),
  onPtyData: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('pty:data', listener);
    return () => ipcRenderer.removeListener('pty:data', listener);
  },
  onPtyExit: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('pty:exit', listener);
    return () => ipcRenderer.removeListener('pty:exit', listener);
  },

  // ── Git operations ──
  gitPull: (path) => ipcRenderer.invoke('git-pull', path),
  gitFetch: (path) => ipcRenderer.invoke('git-fetch', path),
  addWorktree: (opts) => ipcRenderer.invoke('add-worktree', opts),
  removeWorktree: (opts) => ipcRenderer.invoke('remove-worktree', opts),
  forceRemoveWorktree: (opts) => ipcRenderer.invoke('force-remove-worktree', opts),
  getBranches: (path) => ipcRenderer.invoke('get-branches', path),
  createBranch: (opts) => ipcRenderer.invoke('create-branch', opts),
  mergeWorktreeToBranch: (opts) => ipcRenderer.invoke('merge-worktree-to-branch', opts),

  // ── Symlink operations ──
  selectDirectory: (title) => ipcRenderer.invoke('select-directory', title),
  checkSymlinkStatus: (opts) => ipcRenderer.invoke('symlink:check-status', opts),
  createSymlink: (opts) => ipcRenderer.invoke('symlink:create', opts),
  deleteSymlink: (opts) => ipcRenderer.invoke('symlink:delete', opts),
  scanSymlinks: (opts) => ipcRenderer.invoke('symlink:scan', opts),
});
