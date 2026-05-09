function registerWorkspaceIpc({ ipcMain, dialog, mainWindow, workspaceConfig, normalizeSettings, saveConfig, getWorktrees, path, Buffer }) {
  ipcMain.on('window:minimize', () => mainWindow.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow.close());

  ipcMain.handle('get-workspaces', () => workspaceConfig.projects);
  ipcMain.handle('settings:get', () => normalizeSettings(workspaceConfig.settings));
  ipcMain.handle('settings:update', (_, nextSettings) => {
    workspaceConfig.settings = normalizeSettings(nextSettings);
    saveConfig();
    return workspaceConfig.settings;
  });

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
        branch: 'none',
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
        branch: 'none',
      }];
    }
    const project = workspaceConfig.projects.find((p) => p.path === projectPath);
    if (project) {
      project.worktrees = worktrees;
      saveConfig();
    }
    return worktrees;
  });
}

module.exports = {
  registerWorkspaceIpc,
};
