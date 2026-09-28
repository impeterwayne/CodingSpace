const os = require('os');

function registerWorkspaceIpc({ ipcMain, dialog, mainWindow, workspaceService }) {
  ipcMain.on('window:minimize', () => mainWindow.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow.close());

  ipcMain.handle('get-workspaces', () => workspaceService.getWorkspaces());
  ipcMain.handle('settings:get', () => workspaceService.getSettings());
  ipcMain.handle('settings:update', (_, nextSettings) => workspaceService.updateSettings(nextSettings));
  ipcMain.handle('select-executable', async () => {
    // Unix binaries usually have no extension, so only Windows/macOS get a type filter.
    const filtersByPlatform = {
      win32: [{ name: 'Executables', extensions: ['exe', 'cmd', 'bat', 'sh', 'lnk'] }],
      darwin: [{ name: 'Applications', extensions: ['app'] }],
    };
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        ...(filtersByPlatform[process.platform] || []),
        { name: 'All Files', extensions: ['*'] }
      ],
      title: 'Select Executable Path',
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('select-directory', async (_, title) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: title || 'Select Folder',
      defaultPath: process.platform === 'win32' ? 'D:\\' : os.homedir(),
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('add-project', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select a Git Project Root',
    });
    if (result.canceled || !result.filePaths.length) return null;

    return workspaceService.addProject(result.filePaths[0]);
  });

  ipcMain.handle('remove-project', (_, projectPath) => workspaceService.removeProject(projectPath));
  ipcMain.handle('refresh-worktrees', (_, projectPath) => workspaceService.refreshWorktrees(projectPath));
}

module.exports = {
  registerWorkspaceIpc,
};
