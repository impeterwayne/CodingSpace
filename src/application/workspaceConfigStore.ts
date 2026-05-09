const fs = require('fs');
const path = require('path');

function normalizeSettings(settings) {
  const nextSettings = settings && typeof settings === 'object' ? settings : {};
  const nextBranchParents = nextSettings.subworktreeBranchParents && typeof nextSettings.subworktreeBranchParents === 'object'
    ? nextSettings.subworktreeBranchParents
    : {};

  return {
    worktreeBasePath: typeof nextSettings.worktreeBasePath === 'string'
      ? nextSettings.worktreeBasePath.trim()
      : '',
    subworktreeBranchParents: Object.fromEntries(
      Object.entries(nextBranchParents)
        .filter(([branch, parent]) => typeof branch === 'string' && branch.trim() && typeof parent === 'string' && parent.trim())
        .map(([branch, parent]) => [branch.trim(), String(parent).trim()])
    ),
  };
}

function normalizeWorkspaceConfig(config) {
  const nextConfig = config && typeof config === 'object' ? config : {};
  return {
    projects: Array.isArray(nextConfig.projects) ? nextConfig.projects : [],
    settings: normalizeSettings(nextConfig.settings),
  };
}

function createWorkspaceConfigStore({ configPath }) {
  let workspaceConfig = normalizeWorkspaceConfig(undefined);

  function getConfig() {
    return workspaceConfig;
  }

  function loadConfig() {
    try {
      if (fs.existsSync(configPath)) {
        workspaceConfig = normalizeWorkspaceConfig(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }

    workspaceConfig = normalizeWorkspaceConfig(workspaceConfig);
    return workspaceConfig;
  }

  function saveConfig() {
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(workspaceConfig, null, 2));
    } catch (error) {
      console.error('Failed to save config:', error);
    }

    return workspaceConfig;
  }

  return {
    getConfig,
    loadConfig,
    saveConfig,
    normalizeSettings,
    normalizeWorkspaceConfig,
  };
}

module.exports = {
  createWorkspaceConfigStore,
  normalizeSettings,
  normalizeWorkspaceConfig,
};
