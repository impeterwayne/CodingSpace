const fs = require('fs');
const path = require('path');

function normalizeSettings(settings) {
  const nextSettings = settings && typeof settings === 'object' ? settings : {};
  const nextBranchParents = nextSettings.subworktreeBranchParents && typeof nextSettings.subworktreeBranchParents === 'object'
    ? nextSettings.subworktreeBranchParents
    : {};

  return {
    subworktreeBranchParents: Object.fromEntries(
      Object.entries(nextBranchParents)
        .filter(([branch, parent]) => typeof branch === 'string' && branch.trim() && typeof parent === 'string' && parent.trim())
        .map(([branch, parent]) => [branch.trim(), String(parent).trim()])
    ),
    vscodePath: typeof nextSettings.vscodePath === 'string' ? nextSettings.vscodePath.trim() : '',
    androidStudioPath: typeof nextSettings.androidStudioPath === 'string' ? nextSettings.androidStudioPath.trim() : '',
    antigravityPath: typeof nextSettings.antigravityPath === 'string' ? nextSettings.antigravityPath.trim() : '',
    antigravityAgentPath: typeof nextSettings.antigravityAgentPath === 'string' ? nextSettings.antigravityAgentPath.trim() : '',
    openspecSourcePath: typeof nextSettings.openspecSourcePath === 'string' ? nextSettings.openspecSourcePath.trim() : '',
    autoRefreshCurrentProject: typeof nextSettings.autoRefreshCurrentProject === 'boolean' ? nextSettings.autoRefreshCurrentProject : true,
    autoRefreshInterval: typeof nextSettings.autoRefreshInterval === 'number' && nextSettings.autoRefreshInterval >= 1 ? nextSettings.autoRefreshInterval : 10,
    planeApiKey: typeof nextSettings.planeApiKey === 'string' && nextSettings.planeApiKey.trim() ? nextSettings.planeApiKey.trim() : '',
    planeBaseUrl: typeof nextSettings.planeBaseUrl === 'string' && nextSettings.planeBaseUrl.trim() ? nextSettings.planeBaseUrl.trim() : 'https://plane.itgproduct.com',
    planeWorkspaceSlug: typeof nextSettings.planeWorkspaceSlug === 'string' && nextSettings.planeWorkspaceSlug.trim() ? nextSettings.planeWorkspaceSlug.trim() : 'product',
    projectPlaneIds: nextSettings.projectPlaneIds && typeof nextSettings.projectPlaneIds === 'object' ? nextSettings.projectPlaneIds : {},
    symlinkTargets: Array.isArray(nextSettings.symlinkTargets)
      ? nextSettings.symlinkTargets
          .filter(t => t && typeof t === 'object' && typeof t.name === 'string' && typeof t.targetPath === 'string')
          .map(t => ({ name: t.name.trim(), targetPath: t.targetPath.trim() }))
      : [],
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
