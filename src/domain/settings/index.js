function normalizeSettings(settings) {
  const nextSettings = settings && typeof settings === 'object' ? settings : {};
  const nextBranchParents = nextSettings.subworktreeBranchParents && typeof nextSettings.subworktreeBranchParents === 'object'
    ? /** @type {Record<string, string>} */ (nextSettings.subworktreeBranchParents)
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
    claudeDesktopPath: typeof nextSettings.claudeDesktopPath === 'string' ? nextSettings.claudeDesktopPath.trim() : '',
    openspecSourcePath: typeof nextSettings.openspecSourcePath === 'string' ? nextSettings.openspecSourcePath.trim() : '',
    autoRefreshCurrentProject: typeof nextSettings.autoRefreshCurrentProject === 'boolean' ? nextSettings.autoRefreshCurrentProject : true,
    autoRefreshInterval: typeof nextSettings.autoRefreshInterval === 'number' && nextSettings.autoRefreshInterval >= 1 ? nextSettings.autoRefreshInterval : 10,
    planeApiKey: typeof nextSettings.planeApiKey === 'string' && nextSettings.planeApiKey.trim() ? nextSettings.planeApiKey.trim() : '',
    planeBaseUrl: typeof nextSettings.planeBaseUrl === 'string' && nextSettings.planeBaseUrl.trim() ? nextSettings.planeBaseUrl.trim() : 'https://plane.itgproduct.com',
    planeWorkspaceSlug: typeof nextSettings.planeWorkspaceSlug === 'string' && nextSettings.planeWorkspaceSlug.trim() ? nextSettings.planeWorkspaceSlug.trim() : 'product',
    projectPlaneIds: nextSettings.projectPlaneIds && typeof nextSettings.projectPlaneIds === 'object' ? nextSettings.projectPlaneIds : {},
  };
}

function normalizeWorkspaceConfig(config) {
  const nextConfig = config && typeof config === 'object' ? config : {};
  return {
    projects: Array.isArray(nextConfig.projects) ? nextConfig.projects : [],
    settings: normalizeSettings(nextConfig.settings),
  };
}

module.exports = {
  normalizeSettings,
  normalizeWorkspaceConfig,
};
