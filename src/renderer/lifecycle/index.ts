function initializeRendererLifecycle({
  loadWorkspaceSidebarCollapsed,
  setWorkspaceSidebarCollapsed,
  loadTabSidebarCollapsed,
  setTabSidebarCollapsed,
  loadWorkspaces,
  PREWARM_TOOLS,
  cleanupPrewarm,
  state,
  ptyKill,
}) {
  document.addEventListener('DOMContentLoaded', () => {
    setWorkspaceSidebarCollapsed(loadWorkspaceSidebarCollapsed(), { persist: false });
    setTabSidebarCollapsed(loadTabSidebarCollapsed(), { persist: false });
    loadWorkspaces();
  });

  window.addEventListener('beforeunload', () => {
    for (const toolKey of Object.keys(PREWARM_TOOLS)) {
      cleanupPrewarm(toolKey);
    }

    for (const [id, termInfo] of state.terminals) {
      try {
        termInfo.cleanup();
        termInfo.term.dispose();
        ptyKill(id);
      } catch (_) {}
    }
    state.terminals.clear();
  });
}

module.exports = {
  initializeRendererLifecycle,
};
