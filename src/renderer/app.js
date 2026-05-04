/* ═══════════════════════════════════════════════════════
   Terminal HQ — Renderer (Embedded Terminal + Sidebar)
   ═══════════════════════════════════════════════════════ */
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { WebLinksAddon } = require('@xterm/addon-web-links');

// ── Windows Terminal color scheme ──────────────────────
const WT_THEME = {
  background: '#0c0c0c',
  foreground: '#cccccc',
  cursor: '#cccccc',
  cursorAccent: '#0c0c0c',
  selectionBackground: 'rgba(255,255,255,0.18)',
  selectionForeground: '#ffffff',
  black: '#0c0c0c',
  red: '#c50f1f',
  green: '#13a10e',
  yellow: '#c19c00',
  blue: '#0037da',
  magenta: '#881798',
  cyan: '#3a96dd',
  white: '#cccccc',
  brightBlack: '#767676',
  brightRed: '#e74856',
  brightGreen: '#16c60c',
  brightYellow: '#f9f1a5',
  brightBlue: '#3b78ff',
  brightMagenta: '#b4009e',
  brightCyan: '#61d6d6',
  brightWhite: '#f2f2f2',
};

// ── State ──────────────────────────────────────────────
const state = {
  projects: [],
  useExternalWt: false,
  useTmux: true,
  workspaceSidebarCollapsed: false,
  expandedProjects: new Set(),
  terminals: new Map(),   // id -> { term, fitAddon, paneEl, name, cwd, worktreePath, cleanup }
  activeTerminalId: null,
  activeWorktreePath: null, // which worktree's tabs are currently shown
  worktreeActiveTerminal: new Map(), // worktreePath -> last active terminal id
  terminalCounter: 0,
};

// ── DOM Refs ───────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const dom = {
  btnMinimize: $('#btn-minimize'),
  btnMaximize: $('#btn-maximize'),
  btnClose: $('#btn-close'),
  btnAddProject: $('#btn-add-project'),
  btnAddFirst: $('#btn-add-first'),
  btnRefreshAll: $('#btn-refresh-all'),
  toggleExternalWt: $('#toggle-external-wt'),
  toggleTmux: $('#toggle-tmux'),
  projectsContainer: $('#projects-container'),
  loadingState: $('#loading-state'),
  emptyState: $('#empty-state'),
  toastContainer: $('#toast-container'),
  modalOverlay: $('#modal-overlay'),
  modal: $('#modal'),
  modalTitle: $('#modal-title'),
  modalBody: $('#modal-body'),
  modalFooter: $('#modal-footer'),
  modalCloseBtn: $('#modal-close-btn'),
  terminalWelcome: $('#terminal-welcome'),
  terminalContainer: $('#terminal-container'),
  terminalTabs: $('#terminal-tabs'),
  tabNewBtn: $('#tab-new-btn'),
  btnVsCode: $('#btn-vscode'),
  btnExplorer: $('#btn-explorer'),
  btnAndroidStudio: $('#btn-android-studio'),
  btnAntigravity: $('#btn-antigravity'),
  btnToggleWorkspaceSidebar: $('#btn-toggle-workspace-sidebar'),
  sidebarResizeHandle: $('#sidebar-resize-handle'),
  sidebar: $('#sidebar'),
  workspaceSidebar: $('#workspace-sidebar'),
};

const WORKSPACE_SIDEBAR_COLLAPSED_KEY = 'terminal-hq.workspaceSidebarCollapsed';

// ── Window Controls ────────────────────────────────────
dom.btnMinimize.addEventListener('click', () => window.api.minimize());
dom.btnMaximize.addEventListener('click', () => window.api.maximize());
dom.btnClose.addEventListener('click', () => window.api.close());

// ── Option Toggles ─────────────────────────────────────
dom.toggleExternalWt.addEventListener('change', (e) => {
  state.useExternalWt = e.target.checked;
});
dom.toggleTmux.addEventListener('change', (e) => {
  state.useTmux = e.target.checked;
});

dom.btnToggleWorkspaceSidebar.addEventListener('click', () => {
  setWorkspaceSidebarCollapsed(!state.workspaceSidebarCollapsed);
});

// ── Add Project ────────────────────────────────────────
dom.btnAddProject.addEventListener('click', addProject);
dom.btnAddFirst.addEventListener('click', addProject);

async function addProject() {
  const result = await window.api.addProject();
  if (!result) return;
  if (result.error) { showToast(result.error, 'error'); return; }
  state.expandedProjects.add(result.path);
  showToast(`Added project: ${result.name}`, 'success');
  await loadWorkspaces();
}

// ── Refresh All ────────────────────────────────────────
dom.btnRefreshAll.addEventListener('click', async () => {
  const icon = dom.btnRefreshAll.querySelector('svg');
  if (icon) icon.classList.add('spinning');
  showToast('Refreshing...', 'info');
  for (const p of state.projects) await window.api.refreshWorktrees(p.path);
  await loadWorkspaces();
  showToast('All projects refreshed', 'success');
  if (icon) icon.classList.remove('spinning');
});

// ── Sidebar Resize ─────────────────────────────────────
(function initSidebarResize() {
  let isResizing = false;
  dom.sidebarResizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    dom.sidebarResizeHandle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    dom.sidebar.style.width = Math.min(500, Math.max(240, e.clientX)) + 'px';
    fitActiveTerminal();
  });
  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      dom.sidebarResizeHandle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      fitActiveTerminal();
    }
  });
})();

// ── Icons (loaded from SVG files) ──────────────────────

/** Read an SVG file from the icons/ folder via synchronous XHR */
function loadIcon(name) {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `icons/${name}.svg`, false); // synchronous
    xhr.send();
    if (xhr.status === 200 || xhr.status === 0) { // status 0 for file:// protocol
      return xhr.responseText.trim();
    }
    console.warn(`Failed to load icon: ${name} (status ${xhr.status})`);
    return '';
  } catch (e) {
    console.warn(`Failed to load icon: ${name}`, e.message);
    return '';
  }
}

/** Inject width/height into an SVG string for inline use */
function iconSvg(rawSvg, size = 12) {
  return rawSvg.replace(/^<svg/, `<svg width="${size}" height="${size}"`);
}

// Load all SVG icons once at startup
const iconRaw = {
  terminal: loadIcon('terminal'),
  code: loadIcon('code'),
  folder: loadIcon('folder'),
  gitBranch: loadIcon('git-branch'),
  trash: loadIcon('trash'),
  plus: loadIcon('plus'),
  download: loadIcon('download'),
  gitFork: loadIcon('git-fork'),
  chevron: loadIcon('chevron'),
  close: loadIcon('close'),
  opencode: loadIcon('opencode'),
  gemini: loadIcon('gemini'),
  android: loadIcon('android'),
  antigravity: loadIcon('antigravity'),
};

// Pre-sized icon strings matching original inline sizes
const icons = {
  terminal: iconSvg(iconRaw.terminal, 12),
  code: iconSvg(iconRaw.code, 12),
  folder: iconSvg(iconRaw.folder, 12),
  gitBranch: iconSvg(iconRaw.gitBranch, 10),
  trash: iconSvg(iconRaw.trash, 12),
  plus: iconSvg(iconRaw.plus, 12),
  download: iconSvg(iconRaw.download, 12),
  gitFork: iconSvg(iconRaw.gitFork, 14),
  chevron: iconSvg(iconRaw.chevron, 10),
  close: iconSvg(iconRaw.close, 8),
  opencode: iconSvg(iconRaw.opencode, 12),
  gemini: iconSvg(iconRaw.gemini, 12),
  android: iconSvg(iconRaw.android, 12),
  antigravity: iconSvg(iconRaw.antigravity, 12),
};

// ═══════════════════════════════════════════════════════
// EMBEDDED TERMINAL MANAGEMENT
// ═══════════════════════════════════════════════════════

async function createTerminal(cwd, name, { useTmux = false, sessionName = '', worktreePath = '' } = {}) {
  const id = `term-${++state.terminalCounter}`;
  const wtPath = worktreePath || cwd; // associate terminal with this worktree

  // Create xterm instance with Windows Terminal theme
  const term = new Terminal({
    theme: WT_THEME,
    fontFamily: "'Cascadia Mono', 'JetBrains Mono', 'Consolas', monospace",
    fontSize: 14,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 2,
    allowProposedApi: true,
    scrollback: 10000,
    tabStopWidth: 4,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());

  // Create pane element
  const paneEl = document.createElement('div');
  paneEl.className = 'terminal-pane';
  paneEl.id = `pane-${id}`;
  dom.terminalContainer.appendChild(paneEl);

  // Open xterm in pane
  term.open(paneEl);

  // Fit after DOM settles
  requestAnimationFrame(() => {
    fitAddon.fit();
  });

  // Create PTY on backend
  const result = await window.api.ptyCreate({ cwd, id });
  if (!result.success) {
    showToast(`Failed to create terminal: ${result.error}`, 'error');
    paneEl.remove();
    term.dispose();
    return null;
  }

  // Wire data: PTY -> xterm
  const cleanupData = window.api.onPtyData(({ id: dataId, data }) => {
    if (dataId === id) term.write(data);
  });

  // Wire data: xterm -> PTY
  const onDataDisposable = term.onData((data) => {
    window.api.ptyWrite(id, data);
  });

  // Handle resize
  const onResizeDisposable = term.onResize(({ cols, rows }) => {
    window.api.ptyResize(id, cols, rows);
  });

  // Handle exit
  const cleanupExit = window.api.onPtyExit(({ id: exitId }) => {
    if (exitId === id) {
      closeTerminal(id);
    }
  });

  // Store terminal info (with worktree association)
  state.terminals.set(id, {
    term, fitAddon, paneEl, name, cwd, worktreePath: wtPath,
    cleanup: () => {
      cleanupData();
      cleanupExit();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
    },
  });

  // Switch worktree context to this terminal's worktree, then create tab
  state.activeWorktreePath = wtPath;
  rebuildTabsForWorktree(wtPath);

  // Switch to this terminal
  switchToTerminal(id);

  // Fit and send initial size, then optionally start tmux
  setTimeout(() => {
    fitAddon.fit();
    window.api.ptyResize(id, term.cols, term.rows);

    // If tmux is requested, launch a tmux session inside the PTY
    if (useTmux) {
      const safeName = (sessionName || name || 'main').replace(/[^a-zA-Z0-9_-]/g, '_');
      setTimeout(() => {
        window.api.ptyWrite(id, `tmux new-session -A -s ${safeName}\r`);
      }, 300);
    }
  }, 100);

  return id;
}

/** Get all terminal IDs belonging to a given worktree path */
function getTerminalsForWorktree(wtPath) {
  const ids = [];
  for (const [id, info] of state.terminals) {
    if (info.worktreePath === wtPath) ids.push(id);
  }
  return ids;
}

/** Rebuild the tab bar to show only terminals for the given worktree */
function rebuildTabsForWorktree(wtPath) {
  // Remove all existing tab buttons (except the + button)
  dom.terminalTabs.querySelectorAll('.terminal-tab').forEach((t) => t.remove());

  // Insert tabs for this worktree
  const ids = getTerminalsForWorktree(wtPath);
  for (const id of ids) {
    const info = state.terminals.get(id);
    if (info) insertTab(id, info.name);
  }
}

/** Insert a single tab button into the tab bar */
function insertTab(id, name) {
  const tab = document.createElement('button');
  tab.className = 'terminal-tab';
  tab.dataset.termId = id;
  tab.innerHTML = `
    <span class="terminal-tab-icon">${icons.terminal}</span>
    <span class="terminal-tab-name">${esc(name)}</span>
    <button class="terminal-tab-close" data-close-term="${id}" title="Close">${icons.close}</button>
  `;
  // Insert before the + button
  dom.terminalTabs.insertBefore(tab, dom.tabNewBtn);

  // Switch on click
  tab.addEventListener('click', (e) => {
    if (e.target.closest('.terminal-tab-close')) return;
    switchToTerminal(id);
  });

  // Close on X click
  tab.querySelector('.terminal-tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTerminal(id);
  });
}

/** Switch the active worktree context (swap tab bar + restore last active terminal) */
function switchWorktreeContext(wtPath) {
  if (state.activeWorktreePath === wtPath) return;

  // Save current active terminal for the old worktree
  if (state.activeWorktreePath && state.activeTerminalId) {
    state.worktreeActiveTerminal.set(state.activeWorktreePath, state.activeTerminalId);
  }

  state.activeWorktreePath = wtPath;
  rebuildTabsForWorktree(wtPath);

  // Restore last active terminal for this worktree, or pick first
  const savedId = state.worktreeActiveTerminal.get(wtPath);
  const wtTerminals = getTerminalsForWorktree(wtPath);

  if (savedId && state.terminals.has(savedId)) {
    switchToTerminal(savedId);
  } else if (wtTerminals.length > 0) {
    switchToTerminal(wtTerminals[wtTerminals.length - 1]);
  } else {
    // No terminals for this worktree — hide all panes, show welcome
    state.activeTerminalId = null;
    dom.terminalContainer.querySelectorAll('.terminal-pane').forEach((p) => {
      p.classList.remove('active');
    });
    dom.terminalTabs.querySelectorAll('.terminal-tab').forEach((t) => {
      t.classList.remove('active');
    });
    dom.terminalWelcome.classList.remove('hidden');
  }

  updateSidebarActiveState();
}

function switchToTerminal(id) {
  const termInfo = state.terminals.get(id);
  if (!termInfo) return;

  state.activeTerminalId = id;

  // If the terminal belongs to a different worktree, switch context first
  if (termInfo.worktreePath !== state.activeWorktreePath) {
    state.activeWorktreePath = termInfo.worktreePath;
    rebuildTabsForWorktree(termInfo.worktreePath);
  }

  // Remember this as the last active terminal for its worktree
  state.worktreeActiveTerminal.set(termInfo.worktreePath, id);

  // Update tab active state
  dom.terminalTabs.querySelectorAll('.terminal-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.termId === id);
  });

  // Update pane visibility — show only panes for current worktree context
  dom.terminalContainer.querySelectorAll('.terminal-pane').forEach((p) => {
    p.classList.remove('active');
  });
  termInfo.paneEl.classList.add('active');

  // Hide welcome
  dom.terminalWelcome.classList.add('hidden');

  // Focus and fit
  requestAnimationFrame(() => {
    termInfo.fitAddon.fit();
    termInfo.term.focus();
  });

  // Update sidebar active state
  updateSidebarActiveState();
}

function closeTerminal(id) {
  const termInfo = state.terminals.get(id);
  if (!termInfo) return;

  const wtPath = termInfo.worktreePath;

  // Cleanup listeners
  termInfo.cleanup();
  termInfo.term.dispose();
  termInfo.paneEl.remove();

  // Kill PTY
  window.api.ptyKill(id);

  // Remove tab from tab bar
  const tab = dom.terminalTabs.querySelector(`[data-term-id="${id}"]`);
  if (tab) tab.remove();

  state.terminals.delete(id);

  // Clean up worktree active tracking
  if (state.worktreeActiveTerminal.get(wtPath) === id) {
    state.worktreeActiveTerminal.delete(wtPath);
  }

  // Switch to another terminal within the SAME worktree, or show welcome
  if (state.activeTerminalId === id) {
    const remaining = getTerminalsForWorktree(wtPath);
    if (remaining.length > 0) {
      switchToTerminal(remaining[remaining.length - 1]);
    } else {
      state.activeTerminalId = null;
      dom.terminalWelcome.classList.remove('hidden');
    }
  }
}

function fitActiveTerminal() {
  if (state.activeTerminalId) {
    const termInfo = state.terminals.get(state.activeTerminalId);
    if (termInfo) {
      requestAnimationFrame(() => termInfo.fitAddon.fit());
    }
  }
}

function getRequiredActiveWorktreePath() {
  if (!state.activeWorktreePath) {
    showToast('Select a worktree first', 'info');
    return null;
  }

  return state.activeWorktreePath;
}

function loadWorkspaceSidebarCollapsed() {
  try {
    const val = localStorage.getItem(WORKSPACE_SIDEBAR_COLLAPSED_KEY);
    return val === null ? true : val === 'true';
  } catch (error) {
    console.warn('Failed to read workspace sidebar preference:', error.message);
    return true;
  }
}

function saveWorkspaceSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(WORKSPACE_SIDEBAR_COLLAPSED_KEY, collapsed ? 'true' : 'false');
  } catch (error) {
    console.warn('Failed to save workspace sidebar preference:', error.message);
  }
}

function setWorkspaceSidebarCollapsed(collapsed, { persist = true } = {}) {
  state.workspaceSidebarCollapsed = collapsed;

  if (
    collapsed &&
    dom.workspaceSidebar.contains(document.activeElement) &&
    document.activeElement !== dom.btnToggleWorkspaceSidebar
  ) {
    dom.btnToggleWorkspaceSidebar.focus();
  }

  dom.workspaceSidebar.classList.toggle('workspace-sidebar-collapsed', collapsed);
  dom.btnToggleWorkspaceSidebar.setAttribute('aria-expanded', String(!collapsed));

  const label = collapsed ? 'Expand workspace sidebar' : 'Collapse workspace sidebar';
  dom.btnToggleWorkspaceSidebar.setAttribute('aria-label', label);
  dom.btnToggleWorkspaceSidebar.title = label;

  if (persist) {
    saveWorkspaceSidebarCollapsed(collapsed);
  }

  fitActiveTerminal();

  let transitionHandled = false;
  const handleTransitionEnd = (event) => {
    if (event.target !== dom.workspaceSidebar || event.propertyName !== 'width') {
      return;
    }

    transitionHandled = true;
    dom.workspaceSidebar.removeEventListener('transitionend', handleTransitionEnd);
    fitActiveTerminal();
  };

  dom.workspaceSidebar.addEventListener('transitionend', handleTransitionEnd);

  window.setTimeout(() => {
    dom.workspaceSidebar.removeEventListener('transitionend', handleTransitionEnd);
    if (!transitionHandled) {
      fitActiveTerminal();
    }
  }, 360);
}

// Resize all terminals on window resize
window.addEventListener('resize', () => fitActiveTerminal());

// ── New Tab Dropdown ───────────────────────────────────
function getActiveWorktreeInfo() {
  const wtPath = state.activeWorktreePath;
  if (!wtPath) {
    const fallbackPath = state.projects[0]?.worktrees?.[0]?.path || '.';
    return { wtPath: fallbackPath, wtName: 'Terminal' };
  }
  let wtName = 'Terminal';
  for (const p of state.projects) {
    const wt = (p.worktrees || []).find((w) => w.path === wtPath);
    if (wt) { wtName = wt.name; break; }
  }
  return { wtPath, wtName };
}

function createNewTerminalTab() {
  const { wtPath, wtName } = getActiveWorktreeInfo();
  const count = getTerminalsForWorktree(wtPath).length + 1;
  createTerminal(wtPath, `${wtName} (${count})`, {
    useTmux: state.useTmux,
    sessionName: `${wtName.replace(/[^a-zA-Z0-9]/g, '_')}_${count}`,
    worktreePath: wtPath,
  });
}

function createToolTab(toolName, command, { useTmux = false } = {}) {
  const { wtPath, wtName } = getActiveWorktreeInfo();
  const safeName = wtName.replace(/[^a-zA-Z0-9]/g, '_');
  const tmuxLabel = useTmux ? 'tmux+' : '';
  const tabLabel = `${tmuxLabel}${toolName}: ${wtName}`;

  if (useTmux) {
    // Create terminal with tmux, then send the tool command after tmux is ready
    // Use a unique counter to avoid attaching to an existing tmux session
    // that already has the tool running (which would send the command into the running tool)
    const uniqueId = Date.now();
    const sessionName = `${safeName}_${toolName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${uniqueId}`;
    createTerminal(wtPath, tabLabel, {
      useTmux: true,
      sessionName,
      worktreePath: wtPath,
    }).then((id) => {
      if (id && command) {
        // tmux starts at ~400ms (100ms shell + 300ms tmux), tool needs extra wait
        setTimeout(() => {
          window.api.ptyWrite(id, `${command}\r`);
        }, 800);
      }
    });
  } else {
    // Create a plain terminal and then write the launch command
    createTerminal(wtPath, tabLabel, {
      useTmux: false,
      worktreePath: wtPath,
    }).then((id) => {
      if (id && command) {
        // Wait for shell to be ready, then launch the tool
        setTimeout(() => {
          window.api.ptyWrite(id, `${command}\r`);
        }, 500);
      }
    });
  }
}

function showTabDropdown() {
  // Remove existing dropdown if any
  hideTabDropdown();

  const tmuxOn = state.useTmux;
  const tmuxBadge = tmuxOn
    ? `<span class="tab-dropdown-badge tmux-badge">tmux</span>`
    : '';

  const dropdown = document.createElement('div');
  dropdown.className = 'tab-dropdown';
  dropdown.id = 'tab-dropdown';
  dropdown.innerHTML = `
    <button class="tab-dropdown-item" data-action="new-terminal">
      <span class="tab-dropdown-icon terminal-icon">${icons.terminal}</span>
      <span>Terminal</span>
      ${tmuxBadge}
    </button>
    <button class="tab-dropdown-item" data-action="new-opencode">
      <span class="tab-dropdown-icon opencode-icon">${icons.opencode}</span>
      <span>OpenCode</span>
      ${tmuxBadge}
    </button>
    <button class="tab-dropdown-item" data-action="new-gemini">
      <span class="tab-dropdown-icon gemini-icon">${icons.gemini}</span>
      <span>Gemini</span>
      ${tmuxBadge}
    </button>
  `;

  // Position relative to the + button
  const btnRect = dom.tabNewBtn.getBoundingClientRect();
  dropdown.style.left = `${btnRect.left}px`;
  dropdown.style.top = `${btnRect.bottom + 4}px`;
  document.body.appendChild(dropdown);

  // Force reflow for animation
  dropdown.offsetHeight;
  dropdown.classList.add('visible');

  // Handle clicks
  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.tab-dropdown-item');
    if (!item) return;
    const action = item.dataset.action;
    hideTabDropdown();

    switch (action) {
      case 'new-terminal':
        createNewTerminalTab();
        break;
      case 'new-opencode':
        createToolTab('OpenCode', 'opencode', { useTmux: state.useTmux });
        break;
      case 'new-gemini':
        createToolTab('Gemini', 'gemini', { useTmux: state.useTmux });
        break;
    }
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', handleDropdownOutsideClick);
  }, 0);
}

function hideTabDropdown() {
  const existing = document.getElementById('tab-dropdown');
  if (existing) existing.remove();
  document.removeEventListener('click', handleDropdownOutsideClick);
}

function handleDropdownOutsideClick(e) {
  const dropdown = document.getElementById('tab-dropdown');
  if (dropdown && !dropdown.contains(e.target) && !dom.tabNewBtn.contains(e.target)) {
    hideTabDropdown();
  }
}

// New tab button — show dropdown menu
dom.tabNewBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const existing = document.getElementById('tab-dropdown');
  if (existing) {
    hideTabDropdown();
  } else {
    showTabDropdown();
  }
});

// Tab bar external tool buttons
dom.btnVsCode.addEventListener('click', () => {
  const wtPath = getRequiredActiveWorktreePath();
  if (!wtPath) return;
  window.api.openInEditor(wtPath);
  showToast('Opening VS Code...', 'info');
});

dom.btnExplorer.addEventListener('click', () => {
  const wtPath = getRequiredActiveWorktreePath();
  if (!wtPath) return;
  window.api.openInExplorer(wtPath);
  showToast('Opening Explorer...', 'info');
});

dom.btnAndroidStudio.addEventListener('click', () => {
  const wtPath = getRequiredActiveWorktreePath();
  if (!wtPath) return;
  window.api.openInAndroidStudio(wtPath);
  showToast('Opening Android Studio...', 'info');
});

dom.btnAntigravity.addEventListener('click', () => {
  const wtPath = getRequiredActiveWorktreePath();
  if (!wtPath) return;
  window.api.openInAntigravity(wtPath);
  showToast('Opening Antigravity...', 'info');
});

// ═══════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════

async function loadWorkspaces() {
  if (!state.projects || state.projects.length === 0) {
    dom.projectsContainer.innerHTML = '';
    dom.emptyState.style.display = 'none';
    dom.loadingState.style.display = '';
  }

  state.projects = (await window.api.getWorkspaces()) || [];
  
  dom.loadingState.style.display = 'none';

  if (state.expandedProjects.size === 0) {
    state.projects.forEach((p) => state.expandedProjects.add(p.path));
  }
  renderSidebar();
}

function renderSidebar() {
  if (!state.projects.length) {
    dom.projectsContainer.innerHTML = '';
    dom.emptyState.style.display = '';
    return;
  }
  dom.emptyState.style.display = 'none';
  dom.projectsContainer.innerHTML = state.projects
    .map((p, i) => sidebarProjectHTML(p, i)).join('');
  state.projects.forEach((project) => {
    attachSidebarProjectEvents(project);
    (project.worktrees || []).forEach((wt) => loadGitInfo(wt));
  });
}

function sidebarProjectHTML(project, index) {
  const expanded = state.expandedProjects.has(project.path);
  const wtItems = (project.worktrees || [])
    .map((wt) => sidebarWtItemHTML(project, wt)).join('');

  return `
    <div class="sidebar-project" data-project="${esc(project.path)}" style="animation-delay:${index * 0.04}s">
      <div class="sidebar-project-header" data-action="toggle-project" data-path="${esc(project.path)}">
        <div class="sidebar-project-left">
          <span class="sidebar-project-chevron ${expanded ? 'expanded' : ''}">${icons.chevron}</span>
          <div class="sidebar-project-icon">${icons.gitFork}</div>
          <span class="sidebar-project-name" title="${esc(project.path)}">${esc(project.name)}</span>
        </div>
        <div class="sidebar-project-actions">
          <button class="sidebar-icon-btn" data-action="add-wt" data-path="${esc(project.path)}" title="Add worktree">${icons.plus}</button>
          <button class="sidebar-icon-btn" data-action="fetch" data-path="${esc(project.path)}" title="Fetch">${icons.download}</button>
          <button class="sidebar-icon-btn danger" data-action="remove" data-path="${esc(project.path)}" title="Remove">${icons.trash}</button>
        </div>
      </div>
      <div class="sidebar-wt-list ${expanded ? '' : 'collapsed'}" data-wt-list="${esc(project.path)}"
           style="${expanded ? '' : 'max-height:0'}">
        ${wtItems || '<div style="padding:10px 16px 10px 44px;color:var(--text-muted);font-size:11px;">No worktrees</div>'}
      </div>
    </div>
  `;
}

function sidebarWtItemHTML(project, wt) {
  const dotClass = wt.bare ? 'bare' : 'loading';
  return `
    <div class="sidebar-wt-item" data-wt-path="${esc(wt.path)}" data-wt-name="${esc(wt.name)}" data-wt-id="${esc(wt.id)}" data-project-path="${esc(project.path)}">
      <span class="sidebar-wt-dot ${dotClass}" id="wt-dot-${esc(wt.id)}"></span>
      <div class="sidebar-wt-info">
        <div class="sidebar-wt-name">${esc(wt.name)}</div>
        <div class="sidebar-wt-branch">${esc(wt.branch || (wt.detached ? 'HEAD detached' : wt.bare ? 'bare' : '...'))}</div>
      </div>
      <div class="sidebar-wt-actions">
      </div>
    </div>
  `;
}

function updateSidebarActiveState() {
  document.querySelectorAll('.sidebar-wt-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.wtPath === state.activeWorktreePath);
  });
}

function attachSidebarProjectEvents(project) {
  const el = document.querySelector(`.sidebar-project[data-project="${CSS.escape(project.path)}"]`);
  if (!el) return;

  // Toggle
  const header = el.querySelector('[data-action="toggle-project"]');
  header?.addEventListener('click', (e) => {
    if (e.target.closest('.sidebar-project-actions')) return;
    const p = header.dataset.path;
    const chevron = header.querySelector('.sidebar-project-chevron');
    const wtList = el.querySelector(`[data-wt-list="${CSS.escape(p)}"]`);
    if (state.expandedProjects.has(p)) {
      state.expandedProjects.delete(p);
      chevron.classList.remove('expanded');
      wtList.classList.add('collapsed');
      wtList.style.maxHeight = '0';
    } else {
      state.expandedProjects.add(p);
      chevron.classList.add('expanded');
      wtList.classList.remove('collapsed');
      wtList.style.maxHeight = wtList.scrollHeight + 'px';
    }
  });

  el.querySelector('[data-action="add-wt"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showAddWorktreeModal(project);
  });

  el.querySelector('[data-action="fetch"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    showToast('Fetching...', 'info');
    const result = await window.api.gitFetch(project.path);
    showToast(result.success ? 'Fetch complete' : `Fetch failed: ${result.error}`, result.success ? 'success' : 'error');
    if (result.success) await loadWorkspaces();
  });

  el.querySelector('[data-action="remove"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.api.removeProject(project.path);
    showToast(`Removed: ${project.name}`, 'info');
    await loadWorkspaces();
  });

  // Worktree items → open terminal or switch to worktree context
  el.querySelectorAll('.sidebar-wt-item').forEach((wtEl) => {
    wtEl.addEventListener('click', async (e) => {
      if (e.target.closest('.sidebar-wt-actions')) return;
      const wtPath = wtEl.dataset.wtPath;
      const wtName = wtEl.dataset.wtName;

      if (state.useExternalWt) {
        // Open external Windows Terminal (optionally with tmux)
        const result = await window.api.openWindowsTerminal({
          cwd: wtPath,
          useTmux: state.useTmux,
          sessionName: wtName.replace(/[^a-zA-Z0-9]/g, '_'),
        });
        const label = state.useTmux ? `WT+tmux: ${wtName}` : `WT: ${wtName}`;
        showToast(result.success ? `Opened ${label}` : `Failed: ${result.error}`, result.success ? 'success' : 'error');
      } else {
        // Switch to this worktree's tab context
        const wtTerminals = getTerminalsForWorktree(wtPath);
        if (wtTerminals.length > 0) {
          // Worktree already has terminals — switch context to show them
          switchWorktreeContext(wtPath);
        } else {
          // No terminals yet — create the first one for this worktree
          await createTerminal(wtPath, wtName, {
            useTmux: state.useTmux,
            sessionName: wtName.replace(/[^a-zA-Z0-9]/g, '_'),
            worktreePath: wtPath,
          });
        }
      }
    });

    wtEl.querySelector('[data-action="vscode"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      window.api.openInEditor(e.currentTarget.dataset.path);
      showToast('Opening VS Code...', 'info');
    });

    wtEl.querySelector('[data-action="android-studio"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      window.api.openInAndroidStudio(e.currentTarget.dataset.path);
      showToast('Opening Android Studio...', 'info');
    });

    wtEl.querySelector('[data-action="antigravity"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      window.api.openInAntigravity(e.currentTarget.dataset.path);
      showToast('Opening Antigravity...', 'info');
    });

    wtEl.querySelector('[data-action="explorer"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      window.api.openInExplorer(e.currentTarget.dataset.path);
    });
  });
}

// ── Load Git Info ──────────────────────────────────────
async function loadGitInfo(wt) {
  if (wt.bare) return;
  try {
    const info = await window.api.getGitInfo(wt.path);
    const dotEl = document.getElementById(`wt-dot-${wt.id}`);
    if (dotEl) dotEl.className = `sidebar-wt-dot ${info.modifiedCount > 0 ? 'modified' : 'clean'}`;
  } catch (_) {}
}

// ── Add Worktree Modal ─────────────────────────────────
async function showAddWorktreeModal(project) {
  dom.modalTitle.textContent = 'Add Worktree';
  const branches = await window.api.getBranches(project.path);
  const existingWtBranches = (project.worktrees || []).map((w) => w.branch).filter(Boolean);
  const availableBranches = branches.filter((b) => !existingWtBranches.includes(b) && !b.startsWith('origin/'));

  dom.modalBody.innerHTML = `
    <div class="form-group">
      <label class="form-label">Branch</label>
      <select class="form-select" id="wt-branch-select">
        ${availableBranches.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Worktree Path</label>
      <input class="form-input" id="wt-path-input" placeholder="e.g. ../my-project-feature" />
    </div>
  `;

  const branchSelect = dom.modalBody.querySelector('#wt-branch-select');
  const pathInput = dom.modalBody.querySelector('#wt-path-input');
  const updatePath = () => {
    const branch = branchSelect.value;
    const parentDir = project.path.replace(/[/\\][^/\\]+$/, '');
    pathInput.value = `${parentDir}\\${project.name}-${branch.replace(/\//g, '-')}`;
  };
  branchSelect.addEventListener('change', updatePath);
  if (availableBranches.length) updatePath();

  dom.modalFooter.innerHTML = `
    <button class="btn-secondary" id="modal-cancel">Cancel</button>
    <button class="btn-primary" id="modal-confirm">Create Worktree</button>
  `;
  showModal();

  dom.modalFooter.querySelector('#modal-cancel').addEventListener('click', hideModal);
  dom.modalFooter.querySelector('#modal-confirm').addEventListener('click', async () => {
    const branchName = branchSelect.value;
    const wtPath = pathInput.value;
    if (!branchName || !wtPath) { showToast('Please fill all fields', 'error'); return; }
    const btn = dom.modalFooter.querySelector('#modal-confirm');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creating...';
    const result = await window.api.addWorktree({ projectPath: project.path, branchName, wtPath });
    if (result.success) {
      showToast(`Worktree created: ${branchName}`, 'success');
      hideModal();
      await window.api.refreshWorktrees(project.path);
      await loadWorkspaces();
    } else {
      showToast(`Failed: ${result.error}`, 'error');
      btn.disabled = false;
      btn.innerHTML = 'Create Worktree';
    }
  });
}

// ── Modal ──────────────────────────────────────────────
function showModal() { dom.modalOverlay.style.display = ''; }
function hideModal() { dom.modalOverlay.style.display = 'none'; }
dom.modalCloseBtn.addEventListener('click', hideModal);
dom.modalOverlay.addEventListener('click', (e) => {
  if (e.target === dom.modalOverlay) hideModal();
});

// ── Toast ──────────────────────────────────────────────
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.2s ease-out forwards';
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// ── Utilities ──────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Initialize ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setWorkspaceSidebarCollapsed(loadWorkspaceSidebarCollapsed(), { persist: false });
  loadWorkspaces();
});
