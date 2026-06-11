const path = require('path');

function buildFallbackWorktrees(projectPath) {
  return [{
    path: projectPath,
    name: path.basename(projectPath),
    id: Buffer.from(projectPath).toString('base64url'),
    branch: 'none',
  }];
}

function resolveProjectWorktrees(projectPath, getWorktrees) {
  const worktrees = getWorktrees(projectPath);
  return worktrees && worktrees.length > 0 ? worktrees : buildFallbackWorktrees(projectPath);
}

function createWorkspaceService({ configStore, getWorktrees, now = () => Date.now() }) {
  function getWorkspaceConfig() {
    return configStore.getConfig();
  }

  function getWorkspaces() {
    return [...getWorkspaceConfig().projects].sort((a, b) => {
      const timeA = a.addedAt || 0;
      const timeB = b.addedAt || 0;
      return timeB - timeA;
    });
  }

  function getSettings() {
    return configStore.normalizeSettings(getWorkspaceConfig().settings);
  }

  function updateSettings(nextSettings) {
    const workspaceConfig = getWorkspaceConfig();
    workspaceConfig.settings = configStore.normalizeSettings(nextSettings);
    configStore.saveConfig();
    return workspaceConfig.settings;
  }

  function addProject(projectPath) {
    const workspaceConfig = getWorkspaceConfig();
    if (workspaceConfig.projects.find((project) => project.path === projectPath)) {
      return { error: 'Project already added' };
    }

    const project = {
      path: projectPath,
      name: path.basename(projectPath),
      worktrees: resolveProjectWorktrees(projectPath, getWorktrees),
      addedAt: now(),
    };

    workspaceConfig.projects.push(project);
    configStore.saveConfig();
    return project;
  }

  function removeProject(projectPath) {
    const workspaceConfig = getWorkspaceConfig();
    workspaceConfig.projects = workspaceConfig.projects.filter((project) => project.path !== projectPath);
    configStore.saveConfig();
    return true;
  }

  function refreshWorktrees(projectPath) {
    const worktrees = resolveProjectWorktrees(projectPath, getWorktrees);
    const project = getWorkspaceConfig().projects.find((entry) => entry.path === projectPath);
    if (project) {
      project.worktrees = worktrees;
      configStore.saveConfig();
    }
    return worktrees;
  }

  return {
    getWorkspaces,
    getSettings,
    updateSettings,
    addProject,
    removeProject,
    refreshWorktrees,
  };
}

module.exports = {
  createWorkspaceService,
};
