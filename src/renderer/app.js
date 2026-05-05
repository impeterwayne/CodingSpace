/* ═══════════════════════════════════════════════════════
   Coding Space — Renderer (Embedded Terminal + Sidebar)
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
  tabSidebarCollapsed: false,
  expandedProjects: new Set(),
  terminals: new Map(),   // id -> { term, fitAddon, paneEl, name, cwd, worktreePath, cleanup }
  activeTerminalId: null,
  activeWorktreePath: null, // which worktree's tabs are currently shown
  worktreeActiveTerminal: new Map(), // worktreePath -> last active terminal id
  terminalCounter: 0,
  // Prewarmed tool sessions: { id, term, fitAddon, paneEl, cleanup, cwd, worktreePath, ready }
  prewarm: {
    opencode: null,
    gemini: null,
  },
  prewarmInProgress: {
    opencode: false,
    gemini: false,
  },
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
  tabListScroll: $('#tab-list-scroll'),
  tabNewBtn: $('#tab-new-btn'),
  tabCollapseBtn: $('#tab-collapse-btn'),
  btnVsCode: $('#btn-vscode'),
  btnExplorer: $('#btn-explorer'),
  btnAndroidStudio: $('#btn-android-studio'),
  btnAntigravity: $('#btn-antigravity'),
  btnToggleWorkspaceSidebar: $('#btn-toggle-workspace-sidebar'),
  sidebarResizeHandle: $('#sidebar-resize-handle'),
  sidebar: $('#sidebar'),
  workspaceSidebar: $('#workspace-sidebar'),
};

const WORKSPACE_SIDEBAR_COLLAPSED_KEY = 'codingspace.workspaceSidebarCollapsed';
const TAB_SIDEBAR_COLLAPSED_KEY = 'codingspace.tabSidebarCollapsed';

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

/**
 * Create a terminal that directly spawns a tool command as the PTY process.
 * Unlike createTerminal() which spawns a shell, this makes the tool the direct
 * process — giving it proper terminal allocation (fixes opencode/gemini not
 * spawning when typed into a shell).
 */
async function createDirectToolTerminal(cwd, name, { command, worktreePath = '' } = {}) {
  const id = `term-${++state.terminalCounter}`;
  const wtPath = worktreePath || cwd;

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

  const paneEl = document.createElement('div');
  paneEl.className = 'terminal-pane';
  paneEl.id = `pane-${id}`;
  dom.terminalContainer.appendChild(paneEl);

  term.open(paneEl);
  requestAnimationFrame(() => fitAddon.fit());

  // Create a shell PTY, then type the resolved tool launch command into it.
  const result = await window.api.ptyCreate({ cwd, id });
  if (!result.success) {
    showToast(`Failed to launch ${command}: ${result.error}`, 'error');
    paneEl.remove();
    term.dispose();
    return null;
  }

  let launchCommand;
  try {
    const resolved = await window.api.resolveToolLaunch({ command });
    if (!resolved?.success || !resolved.shellCommand) {
      throw new Error(resolved?.error || `Failed to resolve launch command for ${command}`);
    }
    launchCommand = resolved.shellCommand;
  } catch (error) {
    showToast(`Failed to launch ${command}: ${error.message}`, 'error');
    window.api.ptyKill(id);
    paneEl.remove();
    term.dispose();
    return null;
  }

  const cleanupData = window.api.onPtyData(({ id: dataId, data }) => {
    if (dataId === id) term.write(data);
  });

  const onDataDisposable = term.onData((data) => {
    window.api.ptyWrite(id, data);
  });

  const onResizeDisposable = term.onResize(({ cols, rows }) => {
    window.api.ptyResize(id, cols, rows);
  });

  const cleanupExit = window.api.onPtyExit(({ id: exitId }) => {
    if (exitId === id) closeTerminal(id);
  });

  state.terminals.set(id, {
    term, fitAddon, paneEl, name, cwd, worktreePath: wtPath,
    cleanup: () => {
      cleanupData();
      cleanupExit();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
    },
  });

  state.activeWorktreePath = wtPath;
  rebuildTabsForWorktree(wtPath);
  switchToTerminal(id);

  setTimeout(() => {
    fitAddon.fit();
    window.api.ptyResize(id, term.cols, term.rows);
    setTimeout(() => {
      window.api.ptyWrite(id, `${launchCommand}\r`);
    }, 500);
  }, 100);

  return id;
}

function attachPtyToTerminal(id, term, fitAddon, paneEl, cleanupExtra = () => {}) {
  const cleanupData = window.api.onPtyData(({ id: dataId, data }) => {
    if (dataId === id) term.write(data);
  });

  const onDataDisposable = term.onData((data) => {
    window.api.ptyWrite(id, data);
  });

  const onResizeDisposable = term.onResize(({ cols, rows }) => {
    window.api.ptyResize(id, cols, rows);
  });

  const cleanupExit = window.api.onPtyExit(({ id: exitId }) => {
    if (exitId === id) closeTerminal(id);
  });

  return () => {
    cleanupExtra();
    cleanupData();
    cleanupExit();
    onDataDisposable.dispose();
    onResizeDisposable.dispose();
  };
}

function buildTmuxLaunchCommand(sessionName, launchCommand) {
  return `tmux new-session -s ${sessionName} -- ${launchCommand}`;
}

// ═══════════════════════════════════════════════════════
// PREWARM SYSTEM — Background tool sessions
// ═══════════════════════════════════════════════════════

/** Tools that can be prewarmed */
const PREWARM_TOOLS = {
  opencode: { command: 'opencode', label: 'OpenCode' },
  gemini:   { command: 'gemini',   label: 'Gemini' },
};

/**
 * Create a prewarmed background PTY for a tool session.
 * No xterm or DOM pane is created here; only the backend session is warmed.
 */
async function createPrewarmedTerminal(toolKey) {
  const tool = PREWARM_TOOLS[toolKey];
  if (!tool) return;

  // Don't prewarm if already in progress or already warmed
  if (state.prewarmInProgress[toolKey] || state.prewarm[toolKey]) return;

  // Need an active worktree to prewarm against
  const wtPath = state.activeWorktreePath;
  if (!wtPath) return;

  state.prewarmInProgress[toolKey] = true;

  const id = `term-${++state.terminalCounter}`;

  const useTmux = state.useTmux;
  const result = await window.api.ptyCreate({ cwd: wtPath, id });
  if (!result.success) {
    console.warn(`[prewarm] Failed to create PTY for ${toolKey}:`, result.error);
    state.prewarmInProgress[toolKey] = false;
    return;
  }

  let launchCommand;
  try {
    const resolved = await window.api.resolveToolLaunch({ command: tool.command });
    if (!resolved?.success || !resolved.shellCommand) {
      throw new Error(resolved?.error || `Failed to resolve launch command for ${tool.command}`);
    }
    launchCommand = resolved.shellCommand;
  } catch (error) {
    console.warn(`[prewarm] Failed to resolve launch command for ${toolKey}:`, error);
    window.api.ptyKill(id);
    state.prewarmInProgress[toolKey] = false;
    return;
  }

  let exitCleanup = () => {};
  const cleanup = () => {
    exitCleanup();
  };

  exitCleanup = window.api.onPtyExit(({ id: exitId }) => {
    if (exitId !== id) return;
    if (state.prewarm[toolKey]?.id !== id) return;
    cleanupPrewarm(toolKey);
    setTimeout(() => createPrewarmedTerminal(toolKey), 1000);
  });

  // Send initial resize + launch the tool command when needed
  setTimeout(() => {
    window.api.ptyResize(id, 120, 30);

    if (useTmux) {
      const wtName = getWorktreeNameForPath(wtPath);
      const safeName = (wtName || 'main').replace(/[^a-zA-Z0-9_-]/g, '_');
      const uniqueId = Date.now();
      const sessionName = `${safeName}_${tool.command}_prewarm_${uniqueId}`;
      setTimeout(() => {
        window.api.ptyWrite(id, `${buildTmuxLaunchCommand(sessionName, launchCommand)}\r`);
      }, 300);
    } else {
      setTimeout(() => {
        window.api.ptyWrite(id, `${launchCommand}\r`);
      }, 500);
    }
  }, 100);

  // Store as prewarmed backend session only
  state.prewarm[toolKey] = {
    id,
    cleanup,
    cwd: wtPath,
    worktreePath: wtPath,
    usedTmux: useTmux,
    launchCommand,
  };
  state.prewarmInProgress[toolKey] = false;

  console.log(`[prewarm] ${tool.label} session ready (${id}) for ${wtPath}`);
}

/** Get worktree display name for a path */
function getWorktreeNameForPath(wtPath) {
  for (const p of state.projects) {
    const wt = (p.worktrees || []).find((w) => w.path === wtPath);
    if (wt) return wt.name;
  }
  return 'Terminal';
}

/** Clean up a prewarmed session without promoting it */
function cleanupPrewarm(toolKey) {
  const pw = state.prewarm[toolKey];
  if (!pw) return;

  pw.cleanup();
  window.api.ptyKill(pw.id);
  state.prewarm[toolKey] = null;
}

/**
 * Promote a prewarmed terminal into a visible tab.
 * Returns true if promotion succeeded, false if no prewarm available.
 */
function promotePrewarmedTerminal(toolKey) {
  const pw = state.prewarm[toolKey];
  if (!pw) return false;

  const tool = PREWARM_TOOLS[toolKey];
  const { wtPath, wtName } = getActiveWorktreeInfo();

  // Check if the prewarmed session matches the current worktree and tmux setting
  if (pw.worktreePath !== wtPath || pw.usedTmux !== state.useTmux) {
    // Mismatch — discard and fall through to normal creation
    cleanupPrewarm(toolKey);
    return false;
  }

  const id = pw.id;
  const tmuxLabel = pw.usedTmux ? 'tmux+' : '';
  const tabLabel = `${tmuxLabel}${tool.label}: ${wtName}`;

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

  const paneEl = document.createElement('div');
  paneEl.className = 'terminal-pane';
  paneEl.id = `pane-${id}`;
  dom.terminalContainer.appendChild(paneEl);
  term.open(paneEl);

  const cleanup = attachPtyToTerminal(id, term, fitAddon, paneEl);

  // Register in the terminals map
  state.terminals.set(id, {
    term,
    fitAddon,
    paneEl,
    name: tabLabel,
    cwd: pw.cwd,
    worktreePath: pw.worktreePath,
    cleanup,
  });

  // Clear the prewarm slot
  state.prewarm[toolKey] = null;

  // Switch worktree context and create tab
  state.activeWorktreePath = wtPath;
  rebuildTabsForWorktree(wtPath);
  switchToTerminal(id);

  // Fit the promoted terminal
  setTimeout(() => {
    fitAddon.fit();
    window.api.ptyResize(id, term.cols, term.rows);
  }, 50);

  console.log(`[prewarm] Promoted ${tool.label} session (${id})`);

  // Prewarm the next one
  setTimeout(() => createPrewarmedTerminal(toolKey), 500);

  return true;
}

/** Prewarm all tool sessions for the current worktree */
function prewarmAllTools() {
  if (!state.activeWorktreePath) return;
  for (const toolKey of Object.keys(PREWARM_TOOLS)) {
    createPrewarmedTerminal(toolKey);
  }
}

/** Discard and re-prewarm when the active worktree changes */
function reprewarmForWorktree() {
  for (const toolKey of Object.keys(PREWARM_TOOLS)) {
    // Discard existing prewarm if it doesn't match
    const pw = state.prewarm[toolKey];
    if (pw && pw.worktreePath !== state.activeWorktreePath) {
      cleanupPrewarm(toolKey);
    }
    createPrewarmedTerminal(toolKey);
  }
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
  // Remove all existing tab buttons from the scrollable list
  dom.tabListScroll.querySelectorAll('.terminal-tab').forEach((t) => t.remove());

  // Insert tabs for this worktree
  const ids = getTerminalsForWorktree(wtPath);
  for (const id of ids) {
    const info = state.terminals.get(id);
    if (info) insertTab(id, info.name);
  }
}

/** Insert a single tab button into the vertical tab list */
function insertTab(id, name) {
  const tab = document.createElement('button');
  tab.className = 'terminal-tab';
  tab.dataset.termId = id;
  tab.innerHTML = `
    <span class="terminal-tab-icon">${icons.terminal}</span>
    <span class="terminal-tab-name">${esc(name)}</span>
    <button class="terminal-tab-close" data-close-term="${id}" title="Close">${icons.close}</button>
  `;
  // Append to the scrollable tab list
  dom.tabListScroll.appendChild(tab);

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
    dom.tabListScroll.querySelectorAll('.terminal-tab').forEach((t) => {
      t.classList.remove('active');
    });
    dom.terminalWelcome.classList.remove('hidden');
  }

  updateSidebarActiveState();

  // Re-prewarm tool sessions for the new worktree
  reprewarmForWorktree();
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
  dom.tabListScroll.querySelectorAll('.terminal-tab').forEach((t) => {
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
  const tab = dom.tabListScroll.querySelector(`[data-term-id="${id}"]`);
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

// ── Tab Sidebar Collapse Toggle ────────────────────────
function loadTabSidebarCollapsed() {
  try {
    const val = localStorage.getItem(TAB_SIDEBAR_COLLAPSED_KEY);
    return val === 'true';
  } catch (error) {
    return false;
  }
}

function saveTabSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(TAB_SIDEBAR_COLLAPSED_KEY, collapsed ? 'true' : 'false');
  } catch (error) {
    console.warn('Failed to save tab sidebar preference:', error.message);
  }
}

function setTabSidebarCollapsed(collapsed, { persist = true } = {}) {
  state.tabSidebarCollapsed = collapsed;
  dom.terminalTabs.classList.toggle('collapsed', collapsed);
  dom.tabCollapseBtn.title = collapsed ? 'Expand tabs' : 'Collapse tabs';
  if (persist) saveTabSidebarCollapsed(collapsed);
  fitActiveTerminal();
  // Fit again after the transition finishes
  setTimeout(() => fitActiveTerminal(), 280);
}

dom.tabCollapseBtn.addEventListener('click', () => {
  setTabSidebarCollapsed(!state.tabSidebarCollapsed);
});

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
  // Try to promote a prewarmed session first
  const toolKey = toolName.toLowerCase().replace(/[^a-z]/g, '');
  if (PREWARM_TOOLS[toolKey] && promotePrewarmedTerminal(toolKey)) {
    return; // Prewarmed session promoted — instant!
  }

  // Fallback: no prewarm available, create from scratch
  const { wtPath, wtName } = getActiveWorktreeInfo();
  const safeName = wtName.replace(/[^a-zA-Z0-9]/g, '_');
  const tmuxLabel = useTmux ? 'tmux+' : '';
  const tabLabel = `${tmuxLabel}${toolName}: ${wtName}`;

  if (useTmux) {
    // With tmux: create shell terminal and start tmux with the tool command directly
    const uniqueId = Date.now();
    const sessionName = `${safeName}_${toolName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${uniqueId}`;
    createTerminal(wtPath, tabLabel, {
      useTmux: false,
      sessionName,
      worktreePath: wtPath,
    }).then(async (id) => {
      if (id && command) {
        const resolved = await window.api.resolveToolLaunch({ command });
        if (!resolved?.success || !resolved.shellCommand) {
          showToast(`Failed to launch ${command}: ${resolved?.error || 'Unable to resolve launch command'}`, 'error');
          return;
        }
        setTimeout(() => {
          window.api.ptyWrite(id, `${buildTmuxLaunchCommand(sessionName, resolved.shellCommand)}\r`);
        }, 500);
      }
    });
  } else {
    createDirectToolTerminal(wtPath, tabLabel, {
      command,
      worktreePath: wtPath,
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

  // Position relative to the + button (to the right of the vertical sidebar)
  const btnRect = dom.tabNewBtn.getBoundingClientRect();
  dropdown.style.left = `${btnRect.right + 4}px`;
  dropdown.style.top = `${btnRect.top}px`;
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

function showWorktreeContextMenu(project, wt, x, y) {
  hideWorktreeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'worktree-context-menu tab-dropdown';
  menu.id = 'worktree-context-menu';
  menu.innerHTML = `
    <button class="tab-dropdown-item" data-action="merge-to-local-branch">
      <span class="tab-dropdown-icon terminal-icon">${icons.gitBranch}</span>
      <span>Merge to local branch</span>
    </button>
    <div class="tab-dropdown-divider"></div>
    <button class="tab-dropdown-item danger" data-action="force-remove-worktree">
      <span class="tab-dropdown-icon danger-icon">${icons.trash}</span>
      <span>Force remove worktree</span>
    </button>
  `;

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  menu.offsetHeight;
  menu.classList.add('visible');

  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('.tab-dropdown-item');
    if (!item) return;

    const action = item.dataset.action;
    hideWorktreeContextMenu();

    if (action === 'merge-to-local-branch') {
      await showMergeWorktreeModal(project, wt);
      return;
    }

    if (action === 'force-remove-worktree') {
      await showForceRemoveWorktreeModal(project, wt);
    }
  });

  setTimeout(() => {
    document.addEventListener('click', handleWorktreeContextMenuOutsideClick);
  }, 0);
}

function hideWorktreeContextMenu() {
  const existing = document.getElementById('worktree-context-menu');
  if (existing) existing.remove();
  document.removeEventListener('click', handleWorktreeContextMenuOutsideClick);
}

function handleWorktreeContextMenuOutsideClick(e) {
  const menu = document.getElementById('worktree-context-menu');
  if (menu && !menu.contains(e.target)) {
    hideWorktreeContextMenu();
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
          <button class="sidebar-icon-btn" data-action="create-branch" data-path="${esc(project.path)}" title="Create branch">${icons.gitBranch}</button>
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

  el.querySelector('[data-action="create-branch"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showCreateBranchModal(project);
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
    wtEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wt = (project.worktrees || []).find((item) => item.path === wtEl.dataset.wtPath);
      if (!wt) return;
      showWorktreeContextMenu(project, wt, e.clientX, e.clientY);
    });

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
          // Start prewarming tool sessions for this worktree immediately in the background.
          // The visible default tab remains a normal terminal.
          prewarmAllTools();
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

// ── Branch name → PascalCase path helper ───────────────
function branchToPascalPath(branch) {
  if (!branch) return '';
  const shortName = branch.includes('/') ? branch.substring(branch.lastIndexOf('/') + 1) : branch;
  return shortName
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

// ── Searchable Branch Dropdown (reusable) ──────────────
function setupBranchCombo({ containerEl, branches, onSelect, placeholder = 'Search branches...', showCreateOption = false }) {
  const branchInput = containerEl.querySelector('.branch-combo-input');
  const branchDropdown = containerEl.querySelector('.branch-combo-dropdown');
  const branchSelected = containerEl.querySelector('.branch-combo-selected');
  const branchChipLabel = containerEl.querySelector('.branch-chip-label');
  const branchChipBadge = containerEl.querySelector('.branch-chip-badge');
  const branchChipRemove = containerEl.querySelector('.branch-chip-remove');

  branchInput.placeholder = placeholder;
  let selectedBranch = '';
  let isCreateNew = false;

  function select(name, createNew) {
    selectedBranch = name;
    isCreateNew = createNew;
    branchChipLabel.textContent = name;
    if (createNew) {
      branchChipBadge.textContent = 'new';
      branchChipBadge.className = 'branch-chip-badge new';
    } else {
      branchChipBadge.textContent = '';
      branchChipBadge.className = 'branch-chip-badge existing';
      branchChipBadge.style.display = 'none';
    }
    branchSelected.style.display = '';
    branchInput.style.display = 'none';
    branchInput.value = '';
    hideDropdown();
    if (onSelect) onSelect(name, createNew);
  }

  function clear() {
    selectedBranch = '';
    isCreateNew = false;
    branchSelected.style.display = 'none';
    branchInput.style.display = '';
    branchInput.value = '';
    branchInput.focus();
    if (onSelect) onSelect('', false);
  }

  function renderDropdown(query) {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? branches.filter((b) => b.toLowerCase().includes(q))
      : branches;
    const exactMatch = branches.some((b) => b.toLowerCase() === q);
    const showCreate = showCreateOption && q.length > 0 && !exactMatch;

    let html = '';

    if (showCreate) {
      html += `
        <button class="branch-dropdown-item create-item" data-action="create" data-branch="${esc(query.trim())}" type="button">
          <span class="branch-dropdown-icon create">${icons.plus}</span>
          <span>Create new branch: <strong>${esc(query.trim())}</strong></span>
        </button>
      `;
      if (filtered.length > 0) {
        html += `<div class="branch-dropdown-divider"></div>`;
      }
    }

    if (filtered.length > 0) {
      for (const b of filtered.slice(0, 20)) {
        const idx = b.toLowerCase().indexOf(q);
        let label;
        if (q && idx >= 0) {
          label = esc(b.substring(0, idx))
            + `<mark>${esc(b.substring(idx, idx + q.length))}</mark>`
            + esc(b.substring(idx + q.length));
        } else {
          label = esc(b);
        }
        html += `
          <button class="branch-dropdown-item" data-action="select" data-branch="${esc(b)}" type="button">
            <span class="branch-dropdown-icon">${icons.gitBranch}</span>
            <span>${label}</span>
          </button>
        `;
      }
      if (filtered.length > 20) {
        html += `<div class="branch-dropdown-more">${filtered.length - 20} more...</div>`;
      }
    } else if (!showCreate) {
      html += `<div class="branch-dropdown-empty">No branches found</div>`;
    }

    branchDropdown.innerHTML = html;
    branchDropdown.classList.add('visible');

    branchDropdown.querySelectorAll('.branch-dropdown-item').forEach((item) => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const action = item.dataset.action;
        const branch = item.dataset.branch;
        select(branch, action === 'create');
      });
    });
  }

  function hideDropdown() {
    branchDropdown.classList.remove('visible');
  }

  branchInput.addEventListener('input', () => renderDropdown(branchInput.value));
  branchInput.addEventListener('focus', () => renderDropdown(branchInput.value));
  branchInput.addEventListener('blur', () => setTimeout(() => hideDropdown(), 150));
  branchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideDropdown(); branchInput.blur(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = branchDropdown.querySelector('.branch-dropdown-item');
      if (first) first.click();
    }
  });
  branchChipRemove.addEventListener('click', clear);

  return {
    getSelected: () => ({ branch: selectedBranch, isNew: isCreateNew }),
    focus: () => branchInput.focus(),
  };
}

/** Generate the branch combo HTML (reusable in both modals) */
function branchComboHTML() {
  return `
    <div class="branch-combo">
      <div class="branch-combo-selected" style="display:none;">
        <span class="branch-chip">
          <span class="branch-chip-icon">${icons.gitBranch}</span>
          <span class="branch-chip-label"></span>
          <span class="branch-chip-badge"></span>
          <button class="branch-chip-remove" type="button">${icons.close}</button>
        </span>
      </div>
      <input class="form-input branch-combo-input" autocomplete="off" spellcheck="false" />
      <div class="branch-combo-dropdown"></div>
    </div>
  `;
}

// ── Create Branch Modal ────────────────────────────────
async function showCreateBranchModal(project) {
  dom.modalTitle.textContent = 'Create Branch';

  dom.modalBody.innerHTML = `
    <div class="form-group">
      <label class="form-label">New Branch Name</label>
      <input class="form-input" id="new-branch-name" placeholder="e.g. feature/my-feature" autocomplete="off" spellcheck="false" />
    </div>
    <p class="form-hint">Creates a new branch from the current HEAD. You can create a worktree for it later.</p>
  `;

  const nameInput = dom.modalBody.querySelector('#new-branch-name');

  dom.modalFooter.innerHTML = `
    <button class="btn-secondary" id="modal-cancel">Cancel</button>
    <button class="btn-primary" id="modal-confirm">${icons.gitBranch} Create Branch</button>
  `;
  showModal();
  setTimeout(() => nameInput.focus(), 100);

  dom.modalFooter.querySelector('#modal-cancel').addEventListener('click', hideModal);
  dom.modalFooter.querySelector('#modal-confirm').addEventListener('click', async () => {
    const branchName = nameInput.value.trim();
    if (!branchName) { showToast('Please enter a branch name', 'error'); return; }
    if (/[\s~^:?*\[\\]/.test(branchName)) {
      showToast('Invalid branch name', 'error');
      return;
    }
    const btn = dom.modalFooter.querySelector('#modal-confirm');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creating...';
    const result = await window.api.createBranch({ projectPath: project.path, branchName });
    if (result.success) {
      showToast(`Branch created: ${branchName}`, 'success');
      hideModal();
    } else {
      showToast(`Failed: ${result.error}`, 'error');
      btn.disabled = false;
      btn.innerHTML = `${icons.gitBranch} Create Branch`;
    }
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dom.modalFooter.querySelector('#modal-confirm').click();
    }
  });
}

// ── Add Worktree Modal ─────────────────────────────────
async function showAddWorktreeModal(project) {
  dom.modalTitle.textContent = 'Add Worktree';
  const branches = await window.api.getBranches(project.path);
  const existingWtBranches = (project.worktrees || []).map((w) => w.branch).filter(Boolean);
  const availableBranches = branches.filter((b) => !existingWtBranches.includes(b) && !b.startsWith('origin/'));

  const worktreesDir = `${project.path}.worktrees`;

  dom.modalBody.innerHTML = `
    <div class="form-group">
      <label class="form-label">Branch</label>
      ${branchComboHTML()}
    </div>
    <div class="form-group">
      <label class="form-label">Worktree Path</label>
      <input class="form-input" id="wt-path-input" />
    </div>
  `;

  const pathInput = dom.modalBody.querySelector('#wt-path-input');
  const comboContainer = dom.modalBody.querySelector('.branch-combo');

  const combo = setupBranchCombo({
    containerEl: comboContainer,
    branches: availableBranches,
    placeholder: 'Search or create a branch...',
    showCreateOption: true,
    onSelect: (branch) => {
      if (branch) {
        pathInput.value = `${worktreesDir}\\${project.name}-${branchToPascalPath(branch)}`;
      } else {
        pathInput.value = '';
      }
    },
  });

  dom.modalFooter.innerHTML = `
    <button class="btn-secondary" id="modal-cancel">Cancel</button>
    <button class="btn-primary" id="modal-confirm">Create Worktree</button>
  `;
  showModal();
  setTimeout(() => combo.focus(), 100);

  dom.modalFooter.querySelector('#modal-cancel').addEventListener('click', hideModal);
  dom.modalFooter.querySelector('#modal-confirm').addEventListener('click', async () => {
    const { branch: selectedBranch, isNew } = combo.getSelected();
    if (!selectedBranch) { showToast('Please select or create a branch', 'error'); return; }
    const wtPath = pathInput.value;
    if (!wtPath) { showToast('Please specify a worktree path', 'error'); return; }
    if (isNew && /[\s~^:?*\[\\]/.test(selectedBranch)) {
      showToast('Invalid branch name', 'error');
      return;
    }
    const btn = dom.modalFooter.querySelector('#modal-confirm');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creating...';
    const result = await window.api.addWorktree({
      projectPath: project.path,
      branchName: selectedBranch,
      wtPath,
      createBranch: isNew,
    });
    if (result.success) {
      showToast(`Worktree created: ${selectedBranch}`, 'success');
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

async function showMergeWorktreeModal(project, wt) {
  if (!wt?.branch) {
    showToast('This worktree does not have a branch to merge', 'error');
    return;
  }
  if (wt.detached) {
    showToast('Cannot merge from a detached HEAD worktree', 'error');
    return;
  }
  if (wt.bare) {
    showToast('Cannot merge from a bare worktree', 'error');
    return;
  }

  const branches = await window.api.getBranches(project.path);
  const availableBranches = branches.filter((branch) => !branch.startsWith('origin/') && branch !== wt.branch);

  if (!availableBranches.length) {
    showToast('No local target branches available for merge', 'info');
    return;
  }

  dom.modalTitle.textContent = 'Merge to Local Branch';
  dom.modalBody.innerHTML = `
    <div class="form-group">
      <label class="form-label">Source Branch</label>
      <input class="form-input" value="${esc(wt.branch)}" disabled />
    </div>
    <div class="form-group">
      <label class="form-label">Target Branch</label>
      ${branchComboHTML()}
    </div>
    <p class="form-hint">This checks out the selected local branch in the project root worktree and merges <strong>${esc(wt.branch)}</strong> into it.</p>
  `;

  const comboContainer = dom.modalBody.querySelector('.branch-combo');
  const combo = setupBranchCombo({
    containerEl: comboContainer,
    branches: availableBranches,
    placeholder: 'Search local branches...',
    showCreateOption: false,
  });

  dom.modalFooter.innerHTML = `
    <button class="btn-secondary" id="modal-cancel">Cancel</button>
    <button class="btn-primary" id="modal-confirm">${icons.gitBranch} Merge Branch</button>
  `;
  showModal();
  setTimeout(() => combo.focus(), 100);

  dom.modalFooter.querySelector('#modal-cancel').addEventListener('click', hideModal);
  dom.modalFooter.querySelector('#modal-confirm').addEventListener('click', async () => {
    const { branch: targetBranch } = combo.getSelected();
    if (!targetBranch) {
      showToast('Please select a local target branch', 'error');
      return;
    }

    const btn = dom.modalFooter.querySelector('#modal-confirm');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Merging...';

    const result = await window.api.mergeWorktreeToBranch({
      projectPath: project.path,
      sourceBranch: wt.branch,
      targetBranch,
    });

    if (result.success) {
      showToast(`Merged ${wt.branch} into ${targetBranch}`, 'success');
      hideModal();
      await window.api.refreshWorktrees(project.path);
      await loadWorkspaces();
    } else {
      showToast(`Merge failed: ${result.error}`, 'error');
      btn.disabled = false;
      btn.innerHTML = `${icons.gitBranch} Merge Branch`;
    }
  });
}

async function showForceRemoveWorktreeModal(project, wt) {
  if (wt.path === project.path) {
    showToast('Cannot force remove the primary project worktree', 'error');
    return;
  }

  dom.modalTitle.textContent = 'Force Remove Worktree';
  dom.modalBody.innerHTML = `
    <div class="form-group">
      <label class="form-label">Worktree</label>
      <input class="form-input" value="${esc(wt.name)}" disabled />
    </div>
    <div class="form-group">
      <label class="form-label">Path</label>
      <input class="form-input" value="${esc(wt.path)}" disabled />
    </div>
    <p class="form-hint">This runs <code>git worktree remove --force</code> and may discard uncommitted changes in that worktree.</p>
  `;

  dom.modalFooter.innerHTML = `
    <button class="btn-secondary" id="modal-cancel">Cancel</button>
    <button class="btn-primary danger-btn" id="modal-confirm">${icons.trash} Force Remove</button>
  `;
  showModal();

  dom.modalFooter.querySelector('#modal-cancel').addEventListener('click', hideModal);
  dom.modalFooter.querySelector('#modal-confirm').addEventListener('click', async () => {
    const btn = dom.modalFooter.querySelector('#modal-confirm');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Removing...';

    const result = await window.api.forceRemoveWorktree({
      projectPath: project.path,
      wtPath: wt.path,
    });

    if (result.success) {
      showToast(`Force removed: ${wt.name}`, 'success');
      hideModal();
      await window.api.refreshWorktrees(project.path);
      await loadWorkspaces();
    } else {
      showToast(`Failed: ${result.error}`, 'error');
      btn.disabled = false;
      btn.innerHTML = `${icons.trash} Force Remove`;
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
  setTabSidebarCollapsed(loadTabSidebarCollapsed(), { persist: false });
  loadWorkspaces();
});
