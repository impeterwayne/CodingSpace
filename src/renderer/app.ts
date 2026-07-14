/* ═══════════════════════════════════════════════════════
   Coding Space — Renderer (Embedded Terminal + Sidebar)
   ═══════════════════════════════════════════════════════ */
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { WebLinksAddon } = require('@xterm/addon-web-links');
const { WebglAddon } = require('@xterm/addon-webgl');
const {
  getAvailableWorktreeBranches,
  isInvalidGitBranchName,
  getSuggestedWorktreePath,
  getWorktreeBasePath: getDomainWorktreeBasePath,
  getOfficialWorktreeBasePath,
  classifyWorktreeLocation: getDomainClassifyWorktreeLocation,
  canCreateNestedWorktree: getDomainCanCreateNestedWorktree,
  buildWorktreeTree: getDomainBuildWorktreeTree,
} = require('../domain');

const { initializeRendererLifecycle } = require('./lifecycle');
const { openCreateBranchModal } = require('./modals/createBranchModal');
const { openAddWorktreeModal, openAddSubWorktreeModal, openMergeWorktreeModal, openForceRemoveWorktreeModal } = require('./modals/worktreeModals');
const { createModalHelpers } = require('./ui/modalHelpers');
const { createModalPrimitives } = require('./ui/modalPrimitives');

type TerminalBehavior = {
  forceMouseMode: boolean;
};

type ToolTab = {
  key: string;
  action: string;
  command: string;
  label: string;
  iconKey: string;
  prewarm: boolean;
  launchArgs: string[];
  title: string;
  warningBadge?: string;
  behavior: TerminalBehavior;
};

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
const state: {
  projects: any[];
  settings: {
    subworktreeBranchParents?: Record<string, string>;
    vscodePath?: string;
    androidStudioPath?: string;
    antigravityPath?: string;
    antigravityAgentPath?: string;
    openspecSourcePath?: string;
    bmadSourcePath?: string;
    autoRefreshCurrentProject?: boolean;
    autoRefreshInterval?: number;
  };
  useExternalWt: boolean;
  workspaceSidebarCollapsed: boolean;
  tabSidebarCollapsed: boolean;
  expandedProjects: Set<string>;
  terminals: Map<string, any>;
  activeTerminalId: string | null;
  activeWorktreePath: string | null;
  worktreeActiveTerminal: Map<string, string>;
  terminalCounter: number;
  prewarm: { opencode: any };
  prewarmInProgress: { opencode: boolean };
  prewarmSuspendedWorktrees: Set<string>;
  selectedProjectPath: string | null;
} = {
  projects: [],
  settings: {
    subworktreeBranchParents: {},
  },
  useExternalWt: false,
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
  },
  prewarmInProgress: {
    opencode: false,
  },
  prewarmSuspendedWorktrees: new Set(),
  selectedProjectPath: null,
};

// ── DOM Refs ───────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const dom = {
  btnMinimize: $('#btn-minimize'),
  btnMaximize: $('#btn-maximize'),
  btnClose: $('#btn-close'),
  btnSettings: $('#btn-settings'),
  settingsScreen: $('#settings-screen'),
  btnCloseSettings: $('#btn-close-settings'),
  btnAddProject: $('#btn-add-project'),
  btnAddFirst: $('#btn-add-first'),
  btnRefreshAll: $('#btn-refresh-all'),
  settingsAutoRefresh: $('#settings-auto-refresh'),
  settingsAutoRefreshInterval: $('#settings-auto-refresh-interval'),
  toggleExternalWt: $('#toggle-external-wt'),
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
  terminalArea: $('#terminal-area'),
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
  btnAntigravityAgent: $('#btn-antigravity-agent'),
  btnManageSymlinks: $('#btn-manage-symlinks'),
  btnToggleWorkspaceSidebar: $('#btn-toggle-workspace-sidebar'),
  sidebarResizeHandle: $('#sidebar-resize-handle'),
  sidebar: $('#sidebar'),
  workspaceSidebar: $('#workspace-sidebar'),
  tabResizeHandle: $('#tab-resize-handle'),
  settingsAntigravityPath: $('#settings-antigravity-path'),
  settingsAntigravityAgentPath: $('#settings-antigravity-agent-path'),
  settingsAndroidStudioPath: $('#settings-android-studio-path'),
  settingsVsCodePath: $('#settings-vscode-path'),
  btnBrowseAntigravity: $('#btn-browse-antigravity'),
  btnBrowseAntigravityAgent: $('#btn-browse-antigravity-agent'),
  btnBrowseAndroidStudio: $('#btn-browse-android-studio'),
  btnBrowseVsCode: $('#btn-browse-vscode'),
  symlinkScreen: $('#symlink-screen'),
  btnCloseSymlinkScreen: $('#btn-close-symlink-screen'),
  symlinkScreenActiveName: $('#symlink-screen-active-name'),
  symlinkScreenActivePath: $('#symlink-screen-active-path'),
  symlinkScreenListContainer: $('#symlink-screen-list-container'),
  symlinkScreenNewPath: $('#symlink-screen-new-path'),
  symlinkScreenNewName: $('#symlink-screen-new-name'),
  btnBrowseSymlinkScreen: $('#btn-browse-symlink-screen'),
  btnAddSymlinkScreenTarget: $('#btn-add-symlink-screen-target'),
  symlinkScreenNameGroup: $('#symlink-screen-name-group'),
  btnAgentToolkit: $('#btn-agent-toolkit'),
  agentToolkitScreen: $('#agent-toolkit-screen'),
  btnCloseAgentToolkitScreen: $('#btn-close-agent-toolkit-screen'),
  agentToolkitActiveName: $('#agent-toolkit-active-name'),
  agentToolkitActivePath: $('#agent-toolkit-active-path'),
  agentToolkitListContainer: $('#agent-toolkit-list-container'),
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

dom.btnToggleWorkspaceSidebar.addEventListener('click', () => {
  setWorkspaceSidebarCollapsed(!state.workspaceSidebarCollapsed);
});

dom.btnSettings.addEventListener('click', showSettingsScreen);
dom.btnCloseSettings.addEventListener('click', hideSettingsScreen);

// ── Integrations Settings Actions ─────────────────────
function setupBrowseButton(btn, input) {
  if (!btn || !input) return;
  btn.addEventListener('click', async () => {
    const path = await window.api.selectExecutable();
    if (path) {
      input.value = path;
      await saveSettingsFromUI();
    }
  });
}

setupBrowseButton(dom.btnBrowseAntigravity, dom.settingsAntigravityPath);
setupBrowseButton(dom.btnBrowseAntigravityAgent, dom.settingsAntigravityAgentPath);
setupBrowseButton(dom.btnBrowseAndroidStudio, dom.settingsAndroidStudioPath);
setupBrowseButton(dom.btnBrowseVsCode, dom.settingsVsCodePath);

const settingsInputs = [
  dom.settingsAntigravityPath,
  dom.settingsAntigravityAgentPath,
  dom.settingsAndroidStudioPath,
  dom.settingsVsCodePath,
];
for (const input of settingsInputs) {
  if (input) {
    input.addEventListener('change', saveSettingsFromUI);
    input.addEventListener('blur', saveSettingsFromUI);
  }
}

if (dom.settingsAutoRefresh) {
  dom.settingsAutoRefresh.addEventListener('change', async () => {
    await saveSettingsFromUI();
    if (dom.btnRefreshAll) {
      dom.btnRefreshAll.style.display = dom.settingsAutoRefresh.checked ? 'none' : '';
    }
    startAutoRefreshLoop();
  });
}
if (dom.settingsAutoRefreshInterval) {
  dom.settingsAutoRefreshInterval.addEventListener('change', async () => {
    await saveSettingsFromUI();
    startAutoRefreshLoop();
  });
  dom.settingsAutoRefreshInterval.addEventListener('input', async () => {
    await saveSettingsFromUI();
    startAutoRefreshLoop();
  });
}

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
  const icon = dom.btnRefreshAll.querySelector('img');
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

// ── Tab Sidebar Resize ─────────────────────────────────
(function initTabSidebarResize() {
  let isResizing = false;
  
  dom.tabResizeHandle.addEventListener('mousedown', (e) => {
    if (state.tabSidebarCollapsed) return; // Do not resize if collapsed
    isResizing = true;
    dom.tabResizeHandle.classList.add('active');
    dom.terminalTabs.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const sidebarWidth = dom.sidebar.getBoundingClientRect().width;
    const computedWidth = Math.min(350, Math.max(140, e.clientX - sidebarWidth));
    document.documentElement.style.setProperty('--tab-sidebar-width', computedWidth + 'px');
    fitActiveTerminal();
  });
  
  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      dom.tabResizeHandle.classList.remove('active');
      dom.terminalTabs.classList.remove('resizing');
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

let svgIdCounter = 0;
function iconSvg(rawSvg, size = 12) {
  svgIdCounter++;
  const suffix = `_dyn_${svgIdCounter}`;
  
  // Find all id="..." declarations
  const idRegex = /id="([^"]+)"/g;
  const ids = [];
  let match;
  while ((match = idRegex.exec(rawSvg)) !== null) {
    ids.push(match[1]);
  }
  
  let processed = rawSvg;
  // Replace each ID and its url(#id) references
  for (const id of ids) {
    const newId = `${id}${suffix}`;
    // Replace id="id" with id="id_dyn_X"
    processed = processed.replace(new RegExp(`id="${id}"`, 'g'), `id="${newId}"`);
    // Replace url(#id) with url(#id_dyn_X)
    processed = processed.replace(new RegExp(`url\\(#${id}\\)`, 'g'), `url(#${newId})`);
    // Replace url("#id") with url("#id_dyn_X")
    processed = processed.replace(new RegExp(`url\\("#${id}"\\)`, 'g'), `url(#${newId})`);
  }
  
  return processed.replace(/^<svg/, `<svg width="${size}" height="${size}"`);
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
  settings: loadIcon('settings'),
  close: loadIcon('close'),
  opencode: loadIcon('opencode'),
  claude: loadIcon('claude'),
  'windows-terminal': loadIcon('windows-terminal'),
  android: loadIcon('android'),
  antigravity: loadIcon('antigravity'),
  'more-vertical': loadIcon('more-vertical'),
  copy: loadIcon('copy'),
  link: loadIcon('link'),
  'agent-toolkit': loadIcon('agent-toolkit'),
  openspec: loadIcon('openspec'),
  bmad: loadIcon('bmad'),
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
  settings: iconSvg(iconRaw.settings, 12),
  close: iconSvg(iconRaw.close, 8),
  opencode: iconSvg(iconRaw.opencode, 12),
  claude: iconSvg(iconRaw.claude, 12),
  'windows-terminal': iconSvg(iconRaw['windows-terminal'], 12),
  android: iconSvg(iconRaw.android, 12),
  antigravity: iconSvg(iconRaw.antigravity, 12),
  moreVertical: iconSvg(iconRaw['more-vertical'], 12),
  copy: iconSvg(iconRaw.copy, 12),
  link: iconSvg(iconRaw.link, 12),
  codex: iconSvg(iconRaw.code, 12),
  agentToolkit: iconSvg(iconRaw['agent-toolkit'], 16),
  openspec: iconSvg(iconRaw.openspec, 16),
  bmad: iconSvg(iconRaw.bmad, 16),
};

const TOOL_TABS: Record<string, ToolTab> = {
  opencode: {
    key: 'opencode',
    action: 'new-opencode',
    command: 'opencode',
    label: 'OpenCode',
    iconKey: 'opencode',
    prewarm: false,
    launchArgs: [],
    title: 'Open OpenCode in a new terminal tab',
    behavior: {
      forceMouseMode: true,
    },
  },
  agy: {
    key: 'agy',
    action: 'new-agy',
    command: 'agy',
    label: 'Antigravity CLI',
    iconKey: 'antigravity',
    prewarm: false,
    launchArgs: [],
    title: 'Open Antigravity CLI in a new terminal tab',
    behavior: {
      forceMouseMode: false,
    },
  },

  claudeDangerous: {
    key: 'claudeDangerous',
    action: 'new-claude-dangerous',
    command: 'claude',
    label: 'Claude (skip permissions)',
    iconKey: 'claude',
    prewarm: false,
    launchArgs: ['--dangerously-skip-permissions'],
    title: 'Open Claude with --dangerously-skip-permissions. Only use this in isolated/sandboxed environments.',
    warningBadge: 'danger',
    behavior: {
      forceMouseMode: false,
    },
  },
};

const PREWARM_TOOLS = Object.fromEntries(
  Object.values(TOOL_TABS)
    .filter((tool) => tool.prewarm)
    .map((tool) => [tool.key, tool])
);

function getToolTabByAction(action) {
  return Object.values(TOOL_TABS).find((tool) => tool.action === action) || null;
}

function getToolTabByKey(toolKey) {
  return TOOL_TABS[toolKey] || null;
}

async function resolveToolLaunchOrThrow(command, launchArgs = []) {
  const resolved = await window.api.resolveToolLaunch({ command, args: launchArgs });
  if (!resolved?.success || !resolved.shellCommand) {
    throw new Error(resolved?.error || `Failed to resolve launch command for ${command}`);
  }
  return resolved.shellCommand;
}

/** @param {ToolTab} tool */
function buildToolTabLabel(tool, wtName) {
  return `${tool.label}: ${wtName}`;
}

function buildToolSessionName(tool, wtName) {
  const safeName = wtName.replace(/[^a-zA-Z0-9]/g, '_');
  const safeToolName = tool.label.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `${safeName}_${safeToolName}_${Date.now()}`;
}

const DEFAULT_TERMINAL_BEHAVIOR: TerminalBehavior = {
  forceMouseMode: false,
};

function normalizeTerminalBehavior(behavior: Partial<TerminalBehavior> = {}): TerminalBehavior {
  return {
    forceMouseMode: Boolean(behavior.forceMouseMode),
  };
}

function applyTerminalBehavior(term, behavior: TerminalBehavior) {
  if (behavior.forceMouseMode) {
    forceTerminalMouseMode(term);
  }

  return () => {};
}

function loadRendererAddons(term, fitAddon) {
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  try {
    term.loadAddon(new WebglAddon());
  } catch (error) {
    console.warn('Failed to enable WebGL renderer:', error?.message || error);
  }
}

function menuItemHTML({ action, icon, label, title = '', badges = [], danger = false, iconClass = 'terminal-icon' }) {
  const className = `tab-dropdown-item${danger ? ' danger' : ''}`;
  const badgeHtml = badges.filter(Boolean).join('');
  const appliedIconClass = danger ? 'danger-icon' : iconClass;
  return `
    <button class="${className}" data-action="${action}"${title ? ` title="${esc(title)}"` : ''}>
      <span class="tab-dropdown-icon ${appliedIconClass}">${icon}</span>
      <span>${label}</span>
      ${badgeHtml}
    </button>
  `;
}

function menuDividerHTML() {
  return '<div class="tab-dropdown-divider"></div>';
}

function renderToolDropdownItems() {
  return (Object.values(TOOL_TABS) as ToolTab[])
    .map((tool) => {
      const warningBadge = tool.warningBadge
        ? `<span class="tab-dropdown-badge danger-badge">${tool.warningBadge}</span>`
        : '';
      return menuItemHTML({
        action: tool.action,
        icon: icons[tool.iconKey] || icons.terminal,
        label: tool.label,
        title: tool.title || tool.label,
        badges: [warningBadge],
        iconClass: `${tool.iconKey}-icon`,
      });
    })
    .join('');
}

/**
 * @param {{ id: string, className: string, anchorRect?: DOMRect | null, x?: number, y?: number, html: string, outsideClickHandler: (e: MouseEvent) => void }} options
 */
function showPositionedMenu(options) {
  const { id, className, anchorRect = null, x = 0, y = 0, html, outsideClickHandler } = options;
  const menu = document.createElement('div');
  menu.className = className;
  menu.id = id;
  menu.innerHTML = html;

  if (anchorRect) {
    menu.style.left = `${anchorRect.right + 4}px`;
    menu.style.top = `${anchorRect.top}px`;
  } else {
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }

  document.body.appendChild(menu);

  if (!anchorRect) {
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }

  menu.offsetHeight;
  menu.classList.add('visible');

  setTimeout(() => {
    document.addEventListener('click', outsideClickHandler);
  }, 0);

  return menu;
}

function bindMenuActions(menu, handlers, onFinally) {
  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('.tab-dropdown-item');
    if (!item) return;

    const action = item.dataset.action;
    if (!action) return;

    if (onFinally) onFinally();
    const handler = handlers[action];
    if (handler) await handler();
  });
}

function bindWorktreeQuickAction(buttonEl, openFn, toastMessage) {
  buttonEl.addEventListener('click', () => {
    const wtPath = getRequiredActiveWorktreePath();
    if (!wtPath) return;
    openFn(wtPath);
    showToast(toastMessage, 'info');
  });
}

function sidebarActionButtonHTML({ action, path, title, icon, danger = false }) {
  return `<button class="sidebar-icon-btn${danger ? ' danger' : ''}" data-action="${action}" data-path="${esc(path)}" title="${title}">${icon}</button>`;
}

function sidebarEmptyStateHTML() {
  return '<div style="padding:10px 16px 10px 44px;color:var(--text-muted);font-size:11px;">No worktrees</div>';
}

const {
  configureModalFooter,
  focusModalInputLater,
  bindModalEnterSubmit,
  withAsyncButtonState,
} = createModalHelpers(dom);

function syncWorktreePathInput(pathInput, baseDir, projectName) {
  return (branch) => {
    pathInput.value = getSuggestedWorktreePath(baseDir, projectName, branch);
  };
}

async function refreshProjectWorkspaces(projectPath) {
  await window.api.refreshWorktrees(projectPath);
  await loadWorkspaces();
}

function createWorktreeSubmitHandler({ project, combo, pathInput, button, buttonLabel, sourceWorktreePath, onSuccess }) {
  return async () => {
    const { branch: selectedBranch, isNew } = combo.getSelected();
    if (!selectedBranch) { showToast('Please select or create a branch', 'error'); return; }
    const wtPath = pathInput.value;
    if (!wtPath) { showToast('Please specify a worktree path', 'error'); return; }
    if (isNew && isInvalidGitBranchName(selectedBranch)) {
      showToast('Invalid branch name', 'error');
      return;
    }

    const result = await withAsyncButtonState(button, 'Creating...', async () => window.api.addWorktree({
      projectPath: project.path,
      sourceWorktreePath,
      branchName: selectedBranch,
      wtPath,
      createBranch: isNew,
    }), buttonLabel);

    if (result.success) {
      if (onSuccess) await onSuccess(selectedBranch);
      showToast(`Worktree created: ${selectedBranch}`, 'success');
      hideModal();
      await refreshProjectWorkspaces(project.path);
      return;
    }

    showToast(`Failed: ${result.error}`, 'error');
  };
}

// ═══════════════════════════════════════════════════════
// EMBEDDED TERMINAL MANAGEMENT
// ═══════════════════════════════════════════════════════

const FORCED_MOUSE_MODE_SEQUENCE = '\x1b[?1002h\x1b[?1006h';

function forceTerminalMouseMode(term) {
  term.write(FORCED_MOUSE_MODE_SEQUENCE);
}

async function createTerminal(cwd, name, { worktreePath = '', iconKey = 'terminal', behavior = DEFAULT_TERMINAL_BEHAVIOR } = {}) {
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
  loadRendererAddons(term, fitAddon);

  // Create pane element
  const paneEl = document.createElement('div');
  paneEl.className = 'terminal-pane';
  paneEl.id = `pane-${id}`;
  dom.terminalContainer.appendChild(paneEl);

  // Open xterm in pane
  term.open(paneEl);
  const terminalBehavior = normalizeTerminalBehavior(behavior);
  const cleanupBehavior = applyTerminalBehavior(term, terminalBehavior);

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
    term, fitAddon, paneEl, name, cwd, worktreePath: wtPath, iconKey, behavior: terminalBehavior,
    cleanup: () => {
      cleanupBehavior();
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

  // Fit and send initial size
  setTimeout(() => {
    fitAddon.fit();
    window.api.ptyResize(id, term.cols, term.rows);
  }, 100);

  return id;
}

/**
 * Create a terminal that directly spawns a tool command as the PTY process.
 * Unlike createTerminal() which spawns a shell, this makes the tool the direct
 * process — giving it proper terminal allocation (fixes opencode not
 * spawning when typed into a shell).
 */
async function createDirectToolTerminal(cwd, name, options: { command?: string; launchArgs?: string[]; worktreePath?: string; iconKey?: string; behavior?: Partial<TerminalBehavior> } = {}) {
  const { command, launchArgs = [], worktreePath = '', iconKey = 'terminal', behavior = DEFAULT_TERMINAL_BEHAVIOR } = options;
  if (!command) {
    showToast('Missing tool command', 'error');
    return null;
  }
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
  loadRendererAddons(term, fitAddon);

  const paneEl = document.createElement('div');
  paneEl.className = 'terminal-pane';
  paneEl.id = `pane-${id}`;
  dom.terminalContainer.appendChild(paneEl);

  term.open(paneEl);
  const terminalBehavior = normalizeTerminalBehavior(behavior);
  const cleanupBehavior = applyTerminalBehavior(term, terminalBehavior);
  requestAnimationFrame(() => fitAddon.fit());

  const result = await window.api.ptyCreate({ cwd, id });
  if (!result.success) {
    showToast(`Failed to launch ${command}: ${result.error}`, 'error');
    paneEl.remove();
    term.dispose();
    return null;
  }

  let launchCommand;
  try {
    launchCommand = await resolveToolLaunchOrThrow(command, launchArgs);
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
    term, fitAddon, paneEl, name, cwd, worktreePath: wtPath, iconKey, behavior: terminalBehavior,
    cleanup: () => {
      cleanupBehavior();
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


// ═══════════════════════════════════════════════════════
// PREWARM SYSTEM — Background tool sessions
// ═══════════════════════════════════════════════════════

/**
 * Create a prewarmed background PTY for a tool session.
 * No xterm or DOM pane is created here; only the backend session is warmed.
 */
async function createPrewarmedTerminal(toolKey) {
  const tool = getToolTabByKey(toolKey);
  if (!tool) return;

  // Don't prewarm if already in progress or already warmed
  if (state.prewarmInProgress[toolKey] || state.prewarm[toolKey]) return;

  // Need an active worktree to prewarm against
  const wtPath = state.activeWorktreePath;
  if (!wtPath || state.prewarmSuspendedWorktrees.has(wtPath)) return;

  state.prewarmInProgress[toolKey] = true;

  const id = `term-${++state.terminalCounter}`;

  const result = await window.api.ptyCreate({ cwd: wtPath, id });
  if (!result.success) {
    console.warn(`[prewarm] Failed to create PTY for ${toolKey}:`, result.error);
    state.prewarmInProgress[toolKey] = false;
    return;
  }

  let launchCommand;
  try {
    launchCommand = await resolveToolLaunchOrThrow(tool.command, tool.launchArgs);
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
    if (state.prewarmSuspendedWorktrees.has(wtPath)) return;
    setTimeout(() => {
      if (state.prewarmSuspendedWorktrees.has(wtPath)) return;
      createPrewarmedTerminal(toolKey);
    }, 1000);
  });

  // Send initial resize + launch the tool command
  setTimeout(() => {
    window.api.ptyResize(id, 120, 30);
    setTimeout(() => {
      window.api.ptyWrite(id, `${launchCommand}\r`);
    }, 500);
  }, 100);

  // Store as prewarmed backend session only
  state.prewarm[toolKey] = {
    id,
    cleanup,
    cwd: wtPath,
    worktreePath: wtPath,
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

  const tool = getToolTabByKey(toolKey);
  const { wtPath, wtName } = getActiveWorktreeInfo();

  // Check if the prewarmed session matches the current worktree
  if (pw.worktreePath !== wtPath) {
    // Mismatch — discard and fall through to normal creation
    cleanupPrewarm(toolKey);
    return false;
  }

  const id = pw.id;
  const tabLabel = buildToolTabLabel(tool, wtName);
  const terminalBehavior = normalizeTerminalBehavior(tool.behavior);

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
  loadRendererAddons(term, fitAddon);

  const paneEl = document.createElement('div');
  paneEl.className = 'terminal-pane';
  paneEl.id = `pane-${id}`;
  dom.terminalContainer.appendChild(paneEl);
  term.open(paneEl);
  const cleanupBehavior = applyTerminalBehavior(term, terminalBehavior);

  const cleanup = attachPtyToTerminal(id, term, fitAddon, paneEl, cleanupBehavior);

  // Register in the terminals map
  state.terminals.set(id, {
    term,
    fitAddon,
    paneEl,
    name: tabLabel,
    cwd: pw.cwd,
    worktreePath: pw.worktreePath,
    iconKey: tool.iconKey,
    behavior: terminalBehavior,
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

async function closeWorktreeOwnedSessions(wtPath) {
  state.prewarmSuspendedWorktrees.add(wtPath);

  const terminalIds = [...getTerminalsForWorktree(wtPath)];
  for (const id of terminalIds) {
    closeTerminal(id);
  }

  for (const toolKey of Object.keys(PREWARM_TOOLS)) {
    if (state.prewarm[toolKey]?.worktreePath === wtPath) {
      cleanupPrewarm(toolKey);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function releaseWorktreeOwnedSessions(wtPath) {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  state.prewarmSuspendedWorktrees.delete(wtPath);
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
  const info = state.terminals.get(id);
  const iconKey = info?.iconKey || 'terminal';
  const iconMarkup = icons[iconKey] || icons.terminal;
  const iconClass = `${iconKey}-icon`;
  const tab = document.createElement('button');
  tab.className = 'terminal-tab';
  tab.dataset.termId = id;
  tab.innerHTML = `
    <span class="terminal-tab-icon ${iconClass}">${iconMarkup}</span>
    <span class="terminal-tab-name">${esc(name)}</span>
    <button class="terminal-tab-close" data-close-term="${id}" title="Close">${icons.close}</button>
  `;
  // Append to the scrollable tab list
  dom.tabListScroll.appendChild(tab);

  // Switch on click
  tab.addEventListener('click', (e) => {
    const target = e.target;
    if (target instanceof Element && target.closest('.terminal-tab-close')) return;
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
  // Exit settings if active
  dom.settingsScreen.classList.add('hidden');
  if (dom.symlinkScreen) dom.symlinkScreen.classList.add('hidden');
  if (dom.agentToolkitScreen) dom.agentToolkitScreen.classList.add('hidden');
  dom.terminalArea.classList.remove('hidden');
  dom.workspaceSidebar.classList.remove('hidden');

  if (state.activeWorktreePath === wtPath) return;

  // Save current active terminal for the old worktree
  if (state.activeWorktreePath && state.activeTerminalId) {
    state.worktreeActiveTerminal.set(state.activeWorktreePath, state.activeTerminalId);
  }

  state.activeWorktreePath = wtPath;

  // Set selected project based on active worktree path
  const project = state.projects?.find((p) => (p.worktrees || []).some((wt) => wt.path === wtPath));
  if (project && state.selectedProjectPath !== project.path) {
    state.selectedProjectPath = project.path;
    renderSidebar(); // Redraw sidebar to show the selected project
  }

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

async function openProjectWorkspaceAndTerminal(projectPath) {
  const project = state.projects.find((p) => p.path === projectPath);
  if (!project || !project.worktrees || project.worktrees.length === 0) return;

  // Determine the target worktree
  let targetWt = project.worktrees.find((w) => w.path === state.activeWorktreePath);
  if (!targetWt) {
    targetWt = project.worktrees.find((w) => getTerminalsForWorktree(w.path).length > 0);
  }
  if (!targetWt) {
    targetWt = project.worktrees.find((w) => state.worktreeActiveTerminal.has(w.path));
  }
  if (!targetWt) {
    targetWt = project.worktrees[0];
  }

  if (targetWt) {
    const wtPath = targetWt.path;
    const wtName = targetWt.name;
    const wtTerminals = getTerminalsForWorktree(wtPath);
    if (wtTerminals.length > 0) {
      switchWorktreeContext(wtPath);
    } else {
      await createTerminal(wtPath, wtName, {
        worktreePath: wtPath,
      });
      prewarmAllTools();
    }
  }
}

function switchToTerminal(id) {
  // Exit settings if active
  dom.settingsScreen.classList.add('hidden');
  if (dom.symlinkScreen) dom.symlinkScreen.classList.add('hidden');
  if (dom.agentToolkitScreen) dom.agentToolkitScreen.classList.add('hidden');
  dom.terminalArea.classList.remove('hidden');
  dom.workspaceSidebar.classList.remove('hidden');

  const termInfo = state.terminals.get(id);
  if (!termInfo) return;

  state.activeTerminalId = id;

  // If the terminal belongs to a different worktree, switch context first
  if (termInfo.worktreePath !== state.activeWorktreePath) {
    state.activeWorktreePath = termInfo.worktreePath;
    rebuildTabsForWorktree(termInfo.worktreePath);

    // Set selected project based on active worktree path
    const project = state.projects?.find((p) => (p.worktrees || []).some((wt) => wt.path === termInfo.worktreePath));
    if (project && state.selectedProjectPath !== project.path) {
      state.selectedProjectPath = project.path;
      renderSidebar(); // Redraw sidebar to show the selected project
    }
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

// Right click context menu for selection copy
window.addEventListener('contextmenu', (e) => {
  let selectedText = '';
  
  // 1. Check if the target is within a terminal pane
  const terminalPane = (e.target as HTMLElement).closest('.terminal-pane');
  if (terminalPane) {
    const paneId = terminalPane.id; // e.g. "pane-term-1"
    const termId = paneId.replace('pane-', '');
    const termInfo = state.terminals.get(termId);
    if (termInfo && termInfo.term && termInfo.term.hasSelection()) {
      selectedText = termInfo.term.getSelection();
    }
  }
  
  // 2. If no terminal selection, check standard DOM selection
  if (!selectedText) {
    const domSelection = window.getSelection() ? window.getSelection().toString() : '';
    if (domSelection) {
      selectedText = domSelection;
    }
  }

  // 3. If there is selected text, show context menu
  if (selectedText) {
    e.preventDefault();
    e.stopPropagation();
    showSelectionContextMenu(e.clientX, e.clientY, selectedText);
  }
});

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
  if (state.useExternalWt) {
    window.api.openWindowsTerminal({
      cwd: wtPath,
    });
    return;
  }

  const count = getTerminalsForWorktree(wtPath).length + 1;
  createTerminal(wtPath, `${wtName} (${count})`, {
    worktreePath: wtPath,
    iconKey: state.useExternalWt ? 'windows-terminal' : 'terminal',
  });
}

function createToolTab(toolKey) {
  const tool = getToolTabByKey(toolKey);
  if (!tool) {
    showToast(`Unknown tool: ${toolKey}`, 'error');
    return;
  }

  const { wtPath, wtName } = getActiveWorktreeInfo();

  if (state.useExternalWt) {
    void window.api.openWindowsTerminal({
      cwd: wtPath,
      launchCommand: tool.command,
      launchArgs: tool.launchArgs,
    });
    return;
  }

  if (tool.prewarm && promotePrewarmedTerminal(tool.key)) {
    return;
  }

  const tabLabel = buildToolTabLabel(tool, wtName);
  createDirectToolTerminal(wtPath, tabLabel, {
    command: tool.command,
    launchArgs: tool.launchArgs,
    worktreePath: wtPath,
    iconKey: tool.iconKey,
    behavior: tool.behavior,
  });
}


function showTabDropdown() {
  hideTabDropdown();
  hideProjectOptionsMenu();
  hideWorktreeContextMenu();
  hideSelectionContextMenu();

  const dropdown = showPositionedMenu({
    id: 'tab-dropdown',
    className: 'tab-dropdown',
    anchorRect: dom.tabNewBtn.getBoundingClientRect(),
    html: `
      ${menuItemHTML({
        action: 'new-terminal',
        icon: state.useExternalWt ? icons['windows-terminal'] : icons.terminal,
        label: state.useExternalWt ? 'Windows Terminal' : 'Terminal',
        iconClass: state.useExternalWt ? 'windows-terminal-icon' : 'terminal-icon',
      })}
      ${renderToolDropdownItems()}
    `,
    outsideClickHandler: handleDropdownOutsideClick,
  });

  bindMenuActions(dropdown, {
    'new-terminal': () => createNewTerminalTab(),
    ...Object.fromEntries(
      Object.values(TOOL_TABS).map((tool) => [tool.action, () => createToolTab(tool.key)])
    ),
  }, hideTabDropdown);
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
  hideProjectOptionsMenu();
  hideTabDropdown();
  hideSelectionContextMenu();
  const canAddSubWorktree = getDomainCanCreateNestedWorktree(project, wt);
  const canDeleteBranch = Boolean(wt.branch) && !wt.detached && !wt.bare;

  const menu = showPositionedMenu({
    id: 'worktree-context-menu',
    className: 'worktree-context-menu tab-dropdown',
    x,
    y,
    html: `
      ${canAddSubWorktree ? `${menuItemHTML({ action: 'add-sub-worktree', icon: icons.plus, label: 'Add nested worktree' })}${menuDividerHTML()}` : ''}
      ${menuItemHTML({ action: 'merge-to-local-branch', icon: icons.gitBranch, label: 'Merge to local branch' })}
      ${menuDividerHTML()}
      ${menuItemHTML({ action: 'force-remove-worktree', icon: icons.trash, label: 'Force remove worktree', title: canDeleteBranch ? `Force remove worktree. Modal can delete branch ${wt.branch}.` : 'Force remove worktree. Branch deletion unavailable for this worktree.', danger: true })}
    `,
    outsideClickHandler: handleWorktreeContextMenuOutsideClick,
  });

  bindMenuActions(menu, {
    'add-sub-worktree': () => showAddSubWorktreeModal(project, wt),
    'merge-to-local-branch': () => showMergeWorktreeModal(project, wt),
    'force-remove-worktree': () => showForceRemoveWorktreeModal(project, wt),
  }, hideWorktreeContextMenu);
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

function showProjectOptionsMenu(project, x, y) {
  hideProjectOptionsMenu();
  hideWorktreeContextMenu();
  hideTabDropdown();
  hideSelectionContextMenu();

  const menu = showPositionedMenu({
    id: 'project-options-menu',
    className: 'project-options-menu tab-dropdown',
    x,
    y,
    html: `
      ${menuItemHTML({ action: 'add-wt', icon: icons.plus, label: 'Add worktree' })}
      ${menuItemHTML({ action: 'create-branch', icon: icons.gitBranch, label: 'Create branch' })}
      ${menuItemHTML({ action: 'fetch', icon: icons.download, label: 'Fetch' })}
      ${menuDividerHTML()}
      ${menuItemHTML({ action: 'remove', icon: icons.trash, label: 'Remove project', danger: true })}
    `,
    outsideClickHandler: handleProjectOptionsMenuOutsideClick,
  });

  bindMenuActions(menu, {
    'create-branch': () => showCreateBranchModal(project),
    'add-wt': () => showAddWorktreeModal(project),
    'fetch': async () => {
      showToast('Fetching...', 'info');
      const result = await window.api.gitFetch(project.path);
      showToast(result.success ? 'Fetch complete' : `Fetch failed: ${result.error}`, result.success ? 'success' : 'error');
      if (result.success) await loadWorkspaces();
    },
    'remove': async () => {
      await window.api.removeProject(project.path);
      showToast(`Removed: ${project.name}`, 'info');
      await loadWorkspaces();
    },
  }, hideProjectOptionsMenu);
}

function hideProjectOptionsMenu() {
  const existing = document.getElementById('project-options-menu');
  if (existing) existing.remove();
  document.removeEventListener('click', handleProjectOptionsMenuOutsideClick);
}

function handleProjectOptionsMenuOutsideClick(e) {
  const menu = document.getElementById('project-options-menu');
  if (menu && !menu.contains(e.target)) {
    hideProjectOptionsMenu();
  }
}

function showSelectionContextMenu(x, y, text) {
  hideWorktreeContextMenu();
  hideProjectOptionsMenu();
  hideTabDropdown();
  hideSelectionContextMenu();

  const menu = showPositionedMenu({
    id: 'selection-context-menu',
    className: 'selection-context-menu tab-dropdown',
    x,
    y,
    html: menuItemHTML({ action: 'copy-selection', icon: icons.copy, label: 'Copy' }),
    outsideClickHandler: handleSelectionContextMenuOutsideClick,
  });

  bindMenuActions(menu, {
    'copy-selection': async () => {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard', 'info');
    }
  }, hideSelectionContextMenu);
}

function hideSelectionContextMenu() {
  const existing = document.getElementById('selection-context-menu');
  if (existing) existing.remove();
  document.removeEventListener('click', handleSelectionContextMenuOutsideClick);
}

function handleSelectionContextMenuOutsideClick(e) {
  const menu = document.getElementById('selection-context-menu');
  if (menu && !menu.contains(e.target)) {
    hideSelectionContextMenu();
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
bindWorktreeQuickAction(dom.btnVsCode, (wtPath) => window.api.openInEditor(wtPath), 'Opening VS Code...');
bindWorktreeQuickAction(dom.btnExplorer, (wtPath) => window.api.openInExplorer(wtPath), 'Opening Explorer...');
bindWorktreeQuickAction(dom.btnAndroidStudio, (wtPath) => window.api.openInAndroidStudio(wtPath), 'Opening Android Studio...');
bindWorktreeQuickAction(dom.btnAntigravity, (wtPath) => window.api.openInAntigravity(wtPath), 'Opening Antigravity...');
bindWorktreeQuickAction(dom.btnAntigravityAgent, (wtPath) => window.api.openInAntigravityAgent(wtPath), 'Opening Agent Manager...');

if (dom.btnManageSymlinks) {
  dom.btnManageSymlinks.addEventListener('click', () => {
    const activeWorktreePath = getRequiredActiveWorktreePath();
    if (!activeWorktreePath) return;
    showSymlinkScreen();
  });
}

// SIDEBAR
// ═══════════════════════════════════════════════════════

async function loadWorkspaces() {
  if (!state.projects || state.projects.length === 0) {
    dom.projectsContainer.innerHTML = '';
    dom.projectsContainer.style.display = 'none';
    dom.emptyState.style.display = 'none';
    dom.loadingState.style.display = '';
  }

  state.settings = (await window.api.getSettings()) || {};
  if (dom.btnRefreshAll) {
    dom.btnRefreshAll.style.display = state.settings.autoRefreshCurrentProject ? 'none' : '';
  }
  state.projects = (await window.api.getWorkspaces()) || [];
  
  dom.loadingState.style.display = 'none';
  dom.projectsContainer.style.display = '';

  if (state.expandedProjects.size === 0) {
    state.projects.forEach((p) => state.expandedProjects.add(p.path));
  }
  renderSidebar();

  // Automatically select and open the first project on startup
  if (!state.activeWorktreePath && state.projects.length > 0) {
    const targetProjPath = state.selectedProjectPath || state.projects[0].path;
    await openProjectWorkspaceAndTerminal(targetProjPath);
  }
}

function renderSidebar() {
  if (!state.projects.length) {
    dom.projectsContainer.innerHTML = '';
    dom.projectsContainer.style.display = 'none';
    dom.emptyState.style.display = '';
    return;
  }
  dom.emptyState.style.display = 'none';
  dom.projectsContainer.style.display = '';

  // Ensure a project is selected
  if (state.projects.length > 0 && (!state.selectedProjectPath || !state.projects.some(p => p.path === state.selectedProjectPath))) {
    const activeProject = state.projects.find((p) =>
      (p.worktrees || []).some((wt) => wt.path === state.activeWorktreePath)
    );
    state.selectedProjectPath = activeProject ? activeProject.path : state.projects[0].path;
  }

  const selectedProject = state.projects.find(p => p.path === state.selectedProjectPath) || state.projects[0];

  // Render left navigation column
  const navHtml = state.projects.map((project) => {
    const isSelected = project.path === state.selectedProjectPath;
    return `
      <div class="project-nav-item ${isSelected ? 'selected' : ''}" data-project-path="${esc(project.path)}" title="${esc(project.name)}">
        <div class="sidebar-project-icon">${esc(getWorkspaceInitials(project.name))}</div>
      </div>
    `;
  }).join('');

  // Render right details column
  const detailHtml = selectedProject ? sidebarSelectedProjectHTML(selectedProject) : '';

  dom.projectsContainer.innerHTML = `
    <div class="projects-nav-col">
      ${navHtml}
    </div>
    <div class="projects-detail-col">
      ${detailHtml}
    </div>
  `;

  // Attach event listeners
  // 1. Navigation items
  dom.projectsContainer.querySelectorAll('.project-nav-item').forEach((navEl) => {
    if (navEl instanceof HTMLElement) {
      navEl.addEventListener('click', async () => {
        const projectPath = navEl.dataset.projectPath || null;
        if (!projectPath) return;
        state.selectedProjectPath = projectPath;
        renderSidebar();
        await openProjectWorkspaceAndTerminal(projectPath);
      });
      navEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const p = state.projects.find(proj => proj.path === navEl.dataset.projectPath);
        if (p) showProjectOptionsMenu(p, e.clientX, e.clientY);
      });
    }
  });

  // 2. Project details events
  if (selectedProject) {
    attachSelectedProjectEvents(selectedProject);
    (selectedProject.worktrees || []).forEach((wt) => loadGitInfo(wt));
  }
  
  updateSidebarActiveState();
}

function getWorkspaceInitials(name: string) {
  if (!name) return '';
  const first = name.charAt(0);
  const nextUpper = name.substring(1).match(/[A-Z]/);
  if (nextUpper) {
    return first + nextUpper[0];
  }
  return name.substring(0, 2);
}

function sidebarSelectedProjectHTML(project) {
  const expanded = state.expandedProjects.has(project.path);
  const wtItems = getDomainBuildWorktreeTree(project, state.settings)
    .map((node) => sidebarWtItemHTML(project, node)).join('');
  const optionsButton = sidebarActionButtonHTML({
    action: 'project-options',
    path: project.path,
    title: 'Options',
    icon: icons.moreVertical,
  });

  return `
    <div class="sidebar-project-header" data-action="toggle-project" data-path="${esc(project.path)}">
      <div class="sidebar-project-left">
        <span class="sidebar-project-chevron ${expanded ? 'expanded' : ''}">${icons.chevron}</span>
        <span class="sidebar-project-name" title="${esc(project.path)}">${esc(project.name)}</span>
      </div>
      <div class="sidebar-project-actions">
        ${optionsButton}
      </div>
    </div>
    <div class="sidebar-wt-list ${expanded ? '' : 'collapsed'}" data-wt-list="${esc(project.path)}"
         style="${expanded ? '' : 'max-height:0'}">
      ${wtItems || sidebarEmptyStateHTML()}
    </div>
  `;
}

function sidebarWtItemHTML(project, node, depth = 0) {
  const { wt, children } = node;
  const dotClass = wt.bare ? 'bare' : 'loading';
  const childHtml = children.map((child) => sidebarWtItemHTML(project, child, depth + 1)).join('');
  return `
    <div class="sidebar-wt-node depth-${depth}">
      <div class="sidebar-wt-item" data-wt-path="${esc(wt.path)}" data-wt-name="${esc(wt.name)}" data-wt-id="${esc(wt.id)}" data-project-path="${esc(project.path)}" style="margin-left:${depth * 16}px;">
        <span class="sidebar-wt-dot ${dotClass}" id="wt-dot-${esc(wt.id)}"></span>
        <div class="sidebar-wt-info">
          <div class="sidebar-wt-name">${esc(wt.name)}</div>
          <div class="sidebar-wt-branch">${esc(wt.branch || (wt.detached ? 'HEAD detached' : wt.bare ? 'bare' : '...'))}</div>
        </div>
        <div class="sidebar-wt-actions">
        </div>
      </div>
      ${childHtml ? `<div class="sidebar-wt-children">${childHtml}</div>` : ''}
    </div>
  `;
}

function updateSidebarActiveState() {
  document.querySelectorAll('.sidebar-wt-item').forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    el.classList.toggle('active', el.dataset.wtPath === state.activeWorktreePath);
  });
}

function attachSelectedProjectEvents(project) {
  const container = dom.projectsContainer.querySelector('.projects-detail-col');
  if (!container) return;

  // Toggle project header
  const header = container.querySelector('[data-action="toggle-project"]');
  if (header instanceof HTMLElement) {
    header.addEventListener('click', (e) => {
      const target = e.target;
      if (target instanceof Element && target.closest('.sidebar-project-actions')) return;
      const p = header.dataset.path;
      const chevron = header.querySelector('.sidebar-project-chevron');
      const wtList = container.querySelector(`[data-wt-list="${CSS.escape(p || '')}"]`);
      if (chevron instanceof HTMLElement && wtList instanceof HTMLElement) {
        if (state.expandedProjects.has(p || '')) {
          state.expandedProjects.delete(p || '');
          chevron.classList.remove('expanded');
          wtList.classList.add('collapsed');
          wtList.style.maxHeight = '0';
        } else {
          state.expandedProjects.add(p || '');
          chevron.classList.add('expanded');
          wtList.classList.remove('collapsed');
          wtList.style.maxHeight = `${wtList.scrollHeight}px`;
        }
      }
    });

    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showProjectOptionsMenu(project, e.clientX, e.clientY);
    });
  }

  // Options button
  container.querySelector('[data-action="project-options"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showProjectOptionsMenu(project, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });

  // Worktree items → open terminal or switch to worktree context
  container.querySelectorAll('.sidebar-wt-item').forEach((wtEl) => {
    if (!(wtEl instanceof HTMLElement)) return;
    wtEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wt = (project.worktrees || []).find((item) => item.path === wtEl.dataset.wtPath);
      if (!wt) return;
      showWorktreeContextMenu(project, wt, e.clientX, e.clientY);
    });

    wtEl.addEventListener('click', async (e) => {
      const target = e.target;
      if (target instanceof Element && target.closest('.sidebar-wt-actions')) return;
      const wtPath = wtEl.dataset.wtPath || '';
      const wtName = wtEl.dataset.wtName || '';

      const wtTerminals = getTerminalsForWorktree(wtPath);
      if (wtTerminals.length > 0) {
        switchWorktreeContext(wtPath);
      } else {
        await createTerminal(wtPath, wtName, {
          worktreePath: wtPath,
        });
        prewarmAllTools();
      }
    });

    wtEl.querySelector('[data-action="vscode"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentTarget = e.currentTarget;
      if (currentTarget instanceof HTMLElement) window.api.openInEditor(currentTarget.dataset.path || '');
      showToast('Opening VS Code...', 'info');
    });

    wtEl.querySelector('[data-action="android-studio"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentTarget = e.currentTarget;
      if (currentTarget instanceof HTMLElement) window.api.openInAndroidStudio(currentTarget.dataset.path || '');
      showToast('Opening Android Studio...', 'info');
    });

    wtEl.querySelector('[data-action="antigravity"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentTarget = e.currentTarget;
      if (currentTarget instanceof HTMLElement) window.api.openInAntigravity(currentTarget.dataset.path || '');
      showToast('Opening Antigravity...', 'info');
    });

    wtEl.querySelector('[data-action="explorer"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentTarget = e.currentTarget;
      if (currentTarget instanceof HTMLElement) window.api.openInExplorer(currentTarget.dataset.path || '');
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
  return openCreateBranchModal({
    project,
    dom,
    icons,
    configureModalFooter,
    showModal,
    focusModalInputLater,
    hideModal,
    showToast,
    isInvalidGitBranchName,
    withAsyncButtonState,
    bindModalEnterSubmit,
    api: window.api,
  });
}

async function saveSettingsFromUI() {
  const cleanVal = (val: string) => {
    const trimmed = val.trim();
    if (trimmed === 'detecting...' || trimmed === 'not detected') {
      return '';
    }
    return trimmed;
  };
  const intervalVal = parseInt(dom.settingsAutoRefreshInterval ? dom.settingsAutoRefreshInterval.value : '10', 10);
  const nextSettings = {
    ...state.settings,
    antigravityPath: dom.settingsAntigravityPath ? cleanVal(dom.settingsAntigravityPath.value) : '',
    antigravityAgentPath: dom.settingsAntigravityAgentPath ? cleanVal(dom.settingsAntigravityAgentPath.value) : '',
    androidStudioPath: dom.settingsAndroidStudioPath ? cleanVal(dom.settingsAndroidStudioPath.value) : '',
    vscodePath: dom.settingsVsCodePath ? cleanVal(dom.settingsVsCodePath.value) : '',
    autoRefreshCurrentProject: dom.settingsAutoRefresh ? dom.settingsAutoRefresh.checked : true,
    autoRefreshInterval: isNaN(intervalVal) || intervalVal < 1 ? 10 : intervalVal,
  };
  state.settings = await window.api.updateSettings(nextSettings);
}

async function showSettingsScreen() {
  if (state.settings) {
    if (dom.settingsAntigravityPath) dom.settingsAntigravityPath.value = state.settings.antigravityPath || 'detecting...';
    if (dom.settingsAntigravityAgentPath) dom.settingsAntigravityAgentPath.value = state.settings.antigravityAgentPath || 'detecting...';
    if (dom.settingsAndroidStudioPath) dom.settingsAndroidStudioPath.value = state.settings.androidStudioPath || 'detecting...';
    if (dom.settingsVsCodePath) dom.settingsVsCodePath.value = state.settings.vscodePath || 'detecting...';
    if (dom.settingsAutoRefresh) dom.settingsAutoRefresh.checked = !!state.settings.autoRefreshCurrentProject;
    if (dom.settingsAutoRefreshInterval) dom.settingsAutoRefreshInterval.value = String(state.settings.autoRefreshInterval || 10);
  }

  dom.terminalArea.classList.add('hidden');
  dom.workspaceSidebar.classList.add('hidden');
  if (dom.symlinkScreen) dom.symlinkScreen.classList.add('hidden');
  if (dom.agentToolkitScreen) dom.agentToolkitScreen.classList.add('hidden');
  dom.settingsScreen.classList.remove('hidden');

  try {
    const detected = await window.api.detectIntegrationPaths();
    if (state.settings) {
      if (dom.settingsAntigravityPath) {
        dom.settingsAntigravityPath.value = state.settings.antigravityPath || detected.antigravityPath || 'not detected';
      }
      if (dom.settingsAntigravityAgentPath) {
        dom.settingsAntigravityAgentPath.value = state.settings.antigravityAgentPath || detected.antigravityAgentPath || 'not detected';
      }
      if (dom.settingsAndroidStudioPath) {
        dom.settingsAndroidStudioPath.value = state.settings.androidStudioPath || detected.androidStudioPath || 'not detected';
      }
      if (dom.settingsVsCodePath) {
        dom.settingsVsCodePath.value = state.settings.vscodePath || detected.vscodePath || 'not detected';
      }
    }
  } catch (err) {
    console.error('Failed to detect integration paths:', err);
    if (state.settings) {
      if (dom.settingsAntigravityPath) {
        dom.settingsAntigravityPath.value = state.settings.antigravityPath || 'not detected';
      }
      if (dom.settingsAntigravityAgentPath) {
        dom.settingsAntigravityAgentPath.value = state.settings.antigravityAgentPath || 'not detected';
      }
      if (dom.settingsAndroidStudioPath) {
        dom.settingsAndroidStudioPath.value = state.settings.androidStudioPath || 'not detected';
      }
      if (dom.settingsVsCodePath) {
        dom.settingsVsCodePath.value = state.settings.vscodePath || 'not detected';
      }
    }
  }
}


async function hideSettingsScreen() {
  await saveSettingsFromUI();
  dom.settingsScreen.classList.add('hidden');
  dom.terminalArea.classList.remove('hidden');
  dom.workspaceSidebar.classList.remove('hidden');
  fitActiveTerminal();
  startAutoRefreshLoop();
}

// ── Symlink Screen ─────────────────────────────────────
async function showSymlinkScreen() {
  const activeWorktreePath = state.activeWorktreePath;
  const activeWorktreeName = activeWorktreePath ? activeWorktreePath.split(/[\\/]/).pop() : 'No active project';

  if (dom.symlinkScreenActiveName) dom.symlinkScreenActiveName.textContent = activeWorktreeName;
  if (dom.symlinkScreenActivePath) dom.symlinkScreenActivePath.textContent = activeWorktreePath || 'Please select a worktree first.';

  dom.terminalArea.classList.add('hidden');
  dom.workspaceSidebar.classList.add('hidden');
  dom.settingsScreen.classList.add('hidden');
  if (dom.symlinkScreen) dom.symlinkScreen.classList.remove('hidden');
  if (dom.agentToolkitScreen) dom.agentToolkitScreen.classList.add('hidden');

  if (dom.symlinkScreenNewPath) dom.symlinkScreenNewPath.value = '';
  if (dom.symlinkScreenNewName) dom.symlinkScreenNewName.value = '';
  if (dom.symlinkScreenNameGroup) dom.symlinkScreenNameGroup.classList.add('hidden');

  let targets = state.settings?.symlinkTargets || [];
  if (activeWorktreePath) {
    try {
      const scanned = await window.api.scanSymlinks({ worktreePath: activeWorktreePath });
      if (scanned && scanned.length > 0) {
        let changed = false;
        const updated = [...targets];

        for (const scannedItem of scanned) {
          const existingIndex = updated.findIndex((t) => t.name.toLowerCase() === scannedItem.name.toLowerCase());
          if (existingIndex === -1) {
            updated.push(scannedItem);
            changed = true;
          } else if (updated[existingIndex].targetPath !== scannedItem.targetPath) {
            updated[existingIndex].targetPath = scannedItem.targetPath;
            changed = true;
          }
        }

        if (changed) {
          state.settings = await window.api.updateSettings({
            ...state.settings,
            symlinkTargets: updated,
          });
          targets = state.settings.symlinkTargets;
        }
      }
    } catch (e) {
      console.warn('Failed to scan and merge symlinks:', e.message);
    }
  }

  await renderSymlinkScreenList(targets);
}

function hideSymlinkScreen() {
  if (dom.symlinkScreen) dom.symlinkScreen.classList.add('hidden');
  dom.terminalArea.classList.remove('hidden');
  dom.workspaceSidebar.classList.remove('hidden');
  fitActiveTerminal();
  startAutoRefreshLoop();
}

async function renderSymlinkScreenList(symlinkTargets) {
  const listContainer = dom.symlinkScreenListContainer;
  if (!listContainer) return;

  if (!symlinkTargets || symlinkTargets.length === 0) {
    listContainer.innerHTML = `
      <div class="symlink-empty-state">
        <div class="symlink-empty-icon" style="font-size:24px;">🔗</div>
        <div style="font-weight:600; margin-top:4px;">No managed symlinks yet</div>
        <p class="form-hint" style="margin:4px 0 0; font-size:11px;">Add a target folder on the right to link it to your active project.</p>
      </div>
    `;
    return;
  }

  const activeWorktreePath = state.activeWorktreePath;
  if (!activeWorktreePath) {
    listContainer.innerHTML = `
      <div class="symlink-empty-state">
        <div style="font-weight:600; color: var(--danger-default);">No Active Worktree</div>
        <p class="form-hint" style="margin:4px 0 0; font-size:11px;">Open a worktree or project first to select/unselect symlinks.</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = `<div style="display:flex; justify-content:center; padding:16px; align-items:center; gap:8px;"><span class="spinner"></span> Checking status...</div>`;

  try {
    const statuses = await Promise.all(
      symlinkTargets.map(async (t) => {
        try {
          const status = await window.api.checkSymlinkStatus({
            worktreePath: activeWorktreePath,
            name: t.name,
            targetPath: t.targetPath,
          });
          return { ...t, status };
        } catch (e) {
          return { ...t, status: { exists: false, pointsToTarget: false, error: e.message } };
        }
      })
    );

    listContainer.innerHTML = `
      <div class="symlink-list">
        ${statuses.map((t) => {
          let statusBadge = '';
          let checked = '';
          let itemClass = '';
          let titleText = `Target: ${t.targetPath}`;

          if (t.status.exists) {
            if (t.status.pointsToTarget) {
              statusBadge = `<span class="symlink-status-badge symlink-status-linked">Linked</span>`;
              checked = 'checked';
            } else if (t.status.isRealDirectory) {
              statusBadge = `<span class="symlink-status-badge" style="background: rgba(239, 68, 68, 0.15); color: rgb(248, 113, 113);" title="A real folder exists at this name, not a link.">Folder Conflict</span>`;
              itemClass = 'conflict';
            } else {
              statusBadge = `<span class="symlink-status-badge" style="background: rgba(245, 158, 11, 0.15); color: rgb(251, 191, 36);" title="Points to: ${t.status.currentTarget}">Different Target</span>`;
              itemClass = 'different';
            }
          } else {
            statusBadge = `<span class="symlink-status-badge symlink-status-unlinked">Not Linked</span>`;
          }

          return `
            <div class="symlink-item ${itemClass}">
              <label class="symlink-label" title="${titleText}">
                <input type="checkbox" class="symlink-checkbox" data-name="${t.name}" data-target="${t.targetPath}" ${checked} />
                <div class="symlink-info">
                  <span class="symlink-name">${t.name}</span>
                  <span class="symlink-target-path">${t.targetPath}</span>
                </div>
              </label>
              <div style="display:flex; align-items:center; gap:8px;">
                ${statusBadge}
                <button type="button" class="btn-icon symlink-delete-btn" data-name="${t.name}" title="Remove from list">
                  ${icons.trash}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Bind checkbox toggle events
    listContainer.querySelectorAll('.symlink-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', async (e) => {
        const target = e.target;
        const name = target.dataset.name;
        const targetPath = target.dataset.target;
        const isChecked = target.checked;

        target.disabled = true;
        try {
          if (isChecked) {
            showToast(`Creating symlink for ${name}...`, 'info');
            const res = await window.api.createSymlink({ worktreePath: activeWorktreePath, name, targetPath });
            if (res.success) {
              showToast(`Linked ${name} successfully!`, 'success');
            } else {
              showToast(`Link failed: ${res.error}`, 'error');
              target.checked = false;
            }
          } else {
            showToast(`Removing symlink for ${name}...`, 'info');
            const res = await window.api.deleteSymlink({ worktreePath: activeWorktreePath, name });
            if (res.success) {
              showToast(`Removed link for ${name}!`, 'success');
            } else {
              showToast(`Removal failed: ${res.error}`, 'error');
              target.checked = true;
            }
          }
        } catch (err) {
          showToast(`Error: ${err.message}`, 'error');
          target.checked = !isChecked;
        } finally {
          target.disabled = false;
          renderSymlinkScreenList(symlinkTargets);
        }
      });
    });

    // Bind delete target events
    listContainer.querySelectorAll('.symlink-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const name = btn.dataset.name;
        if (activeWorktreePath) {
          try {
            showToast(`Removing symlink for ${name}...`, 'info');
            const res = await window.api.deleteSymlink({ worktreePath: activeWorktreePath, name });
            if (res && !res.success) {
              showToast(`Failed to remove link for ${name}: ${res.error}`, 'error');
            } else {
              showToast(`Removed link for ${name}!`, 'success');
            }
          } catch (err) {
            console.error('Failed to delete symlink:', err);
          }
        }
        const updated = symlinkTargets.filter((t) => t.name !== name);
        state.settings = await window.api.updateSettings({
          ...state.settings,
          symlinkTargets: updated,
        });
        await renderSymlinkScreenList(state.settings.symlinkTargets);
      });
    });

  } catch (err) {
    listContainer.innerHTML = `<div style="color:var(--danger-default); padding:16px;">Failed to load status: ${err.message}</div>`;
  }
}

// ── Bind Symlink Screen Listeners ───────────────────────
if (dom.btnCloseSymlinkScreen) {
  dom.btnCloseSymlinkScreen.addEventListener('click', hideSymlinkScreen);
}

const handleSymlinkScreenBrowse = async () => {
  try {
    const selectedDir = await window.api.selectDirectory('Select Folder to Symlink');
    if (selectedDir) {
      if (dom.symlinkScreenNewPath) dom.symlinkScreenNewPath.value = selectedDir;
      if (dom.symlinkScreenNewName) {
        const leaf = selectedDir.split(/[\\/]/).filter(Boolean).pop() || '';
        dom.symlinkScreenNewName.value = leaf;
      }
      if (dom.symlinkScreenNameGroup) dom.symlinkScreenNameGroup.classList.remove('hidden');
    }
  } catch (err) {
    showToast(`Browse failed: ${err.message}`, 'error');
  }
};

if (dom.symlinkScreenNewPath) {
  dom.symlinkScreenNewPath.addEventListener('click', handleSymlinkScreenBrowse);
}
if (dom.btnBrowseSymlinkScreen) {
  dom.btnBrowseSymlinkScreen.addEventListener('click', handleSymlinkScreenBrowse);
}

if (dom.btnAddSymlinkScreenTarget) {
  dom.btnAddSymlinkScreenTarget.addEventListener('click', async () => {
    const pathVal = dom.symlinkScreenNewPath ? dom.symlinkScreenNewPath.value.trim() : '';
    let nameVal = dom.symlinkScreenNewName ? dom.symlinkScreenNewName.value.trim() : '';

    if (!pathVal) {
      showToast('Please select a target folder first', 'error');
      return;
    }
    if (!nameVal) {
      nameVal = pathVal.split(/[\\/]/).filter(Boolean).pop() || '';
    }
    if (!nameVal) {
      showToast('Please enter a name for the symlink', 'error');
      return;
    }

    const currentTargets = state.settings.symlinkTargets || [];
    if (currentTargets.some((t) => t.name.toLowerCase() === nameVal.toLowerCase())) {
      showToast(`A symlink target named "${nameVal}" already exists in the list`, 'error');
      return;
    }

    const updated = [...currentTargets, { name: nameVal, targetPath: pathVal }];
    state.settings = await window.api.updateSettings({
      ...state.settings,
      symlinkTargets: updated,
    });

    const activeWorktreePath = state.activeWorktreePath;
    let linkSuccess = false;
    if (activeWorktreePath) {
      try {
        showToast(`Creating symlink for ${nameVal}...`, 'info');
        const res = await window.api.createSymlink({
          worktreePath: activeWorktreePath,
          name: nameVal,
          targetPath: pathVal,
        });
        if (res.success) {
          linkSuccess = true;
          showToast(`Linked ${nameVal} successfully!`, 'success');
        } else {
          showToast(`Link failed: ${res.error}`, 'error');
        }
      } catch (err) {
        showToast(`Link failed: ${err.message}`, 'error');
      }
    }

    await renderSymlinkScreenList(state.settings.symlinkTargets);

    if (dom.symlinkScreenNewPath) dom.symlinkScreenNewPath.value = '';
    if (dom.symlinkScreenNewName) dom.symlinkScreenNewName.value = '';
    if (dom.symlinkScreenNameGroup) dom.symlinkScreenNameGroup.classList.add('hidden');
    
    if (linkSuccess) {
      showToast(`Added and linked "${nameVal}" successfully!`, 'success');
    } else {
      showToast(`Added "${nameVal}" to managed symlinks`, 'success');
    }
  });
}

// ── Add Worktree Modal ─────────────────────────────────
async function showAddWorktreeModal(project) {
  return openAddWorktreeModal({
    project,
    dom,
    api: window.api,
    getAvailableWorktreeBranches,
    getOfficialWorktreeBasePath,
    branchComboHTML,
    setupBranchCombo,
    syncWorktreePathInput,
    configureModalFooter,
    showModal,
    focusModalInputLater,
    hideModal,
    createWorktreeSubmitHandler,
  });
}

async function showAddSubWorktreeModal(project, sourceWorktree) {
  return openAddSubWorktreeModal({
    project,
    sourceWorktree,
    dom,
    state,
    api: window.api,
    canCreateNestedWorktree: (projectArg, wtArg) => getDomainCanCreateNestedWorktree(projectArg, wtArg),
    showToast,
    getAvailableWorktreeBranches,
    getWorktreeBasePath: (projectArg) => getDomainWorktreeBasePath(projectArg),
    esc,
    branchComboHTML,
    setupBranchCombo,
    syncWorktreePathInput,
    configureModalFooter,
    showModal,
    focusModalInputLater,
    hideModal,
    createWorktreeSubmitHandler,
  });
}

async function showMergeWorktreeModal(project, wt) {
  return openMergeWorktreeModal({
    project,
    wt,
    dom,
    api: window.api,
    showToast,
    esc,
    branchComboHTML,
    setupBranchCombo,
    configureModalFooter,
    showModal,
    focusModalInputLater,
    hideModal,
    withAsyncButtonState,
    refreshProjectWorkspaces,
    icons,
  });
}

async function showForceRemoveWorktreeModal(project, wt) {
  return openForceRemoveWorktreeModal({
    project,
    wt,
    dom,
    api: window.api,
    showToast,
    esc,
    configureModalFooter,
    showModal,
    hideModal,
    withAsyncButtonState,
    refreshProjectWorkspaces,
    icons,
    closeWorktreeOwnedSessions,
    releaseWorktreeOwnedSessions,
  });
}

// ── Agent Toolkit Screen ───────────────────────────────────
async function showAgentToolkitScreen() {
  const activeWorktreePath = state.activeWorktreePath;
  const activeWorktreeName = activeWorktreePath ? activeWorktreePath.split(/[\\/]/).pop() : 'No active project';

  if (dom.agentToolkitActiveName) dom.agentToolkitActiveName.textContent = activeWorktreeName;
  if (dom.agentToolkitActivePath) dom.agentToolkitActivePath.textContent = activeWorktreePath || 'Please select a worktree first.';

  dom.terminalArea.classList.add('hidden');
  dom.workspaceSidebar.classList.add('hidden');
  dom.settingsScreen.classList.add('hidden');
  if (dom.symlinkScreen) dom.symlinkScreen.classList.add('hidden');
  if (dom.agentToolkitScreen) dom.agentToolkitScreen.classList.remove('hidden');

  await refreshAgentToolkitStatus();
}

function hideAgentToolkitScreen() {
  if (dom.agentToolkitScreen) dom.agentToolkitScreen.classList.add('hidden');
  dom.terminalArea.classList.remove('hidden');
  dom.workspaceSidebar.classList.remove('hidden');
  fitActiveTerminal();
  startAutoRefreshLoop();
}

// Toolkit components to link/manage
const TOOLKIT_COMPONENTS = [
  // --- OpenSpec Group Components ---
  {
    id: 'openspec_core',
    name: 'OpenSpec Core Infrastructure',
    folderName: 'openspec',
    description: 'Core OpenSpec configuration and specs folder.',
    gitExcludePatterns: [] // Do not exclude specs to allow git tracking
  },
  {
    id: 'openspec_claude',
    name: 'Claude OpenSpec Skills',
    folderName: '.claude\\skills',
    description: 'Claude-specific skills and agent instructions.',
    gitExcludePatterns: ['.claude/skills/openspec-*/']
  },
  {
    id: 'openspec_codex',
    name: 'Codex OpenSpec Skills',
    folderName: '.codex\\skills',
    description: 'Codex-specific skills and custom Codex settings.',
    gitExcludePatterns: ['.codex/skills/openspec-*/']
  },
  {
    id: 'openspec_opencode',
    name: 'OpenCode OpenSpec Skills',
    isMulti: true,
    folders: [
      { name: '.opencode\\skills', pattern: '.opencode/skills/' },
      { name: '.opencode\\commands', pattern: '.opencode/commands/' }
    ],
    description: 'OpenCode-specific skills and tools.',
    gitExcludePatterns: ['.opencode/skills/openspec-*/', '.opencode/commands/openspec-*/']
  },
  {
    id: 'openspec_antigravity',
    name: 'Antigravity OpenSpec Workflows',
    isMulti: true,
    folders: [
      { name: '.agents\\skills', pattern: '.agents/skills/' },
      { name: '.agents\\workflows', pattern: '.agents/workflows/' }
    ],
    description: 'Deploys OpenSpec shared skills and slash-command workflows.',
    gitExcludePatterns: ['.agents/skills/openspec-*/', '.agents/workflows/opsx-*']
  },

  // --- BMAD Group Components ---
  {
    id: 'bmad_core',
    name: 'BMAD Core Engine',
    folderName: '_bmad',
    description: 'Core BMAD engine skills and configs. Integrates _bmad-output automatically.',
    gitExcludePatterns: ['_bmad/', '_bmad-output/']
  },
  {
    id: 'bmad_agent_skills',
    name: 'BMAD Agent Skills',
    folderName: '.agents\\skills',
    description: 'Core BMAD agent skills.',
    gitExcludePatterns: ['.agents/skills/bmad-*/']
  },
  {
    id: 'bmad_antigravity',
    name: 'Antigravity CLI configuration',
    folderName: '.antigravitycli',
    description: 'Integrates local Antigravity settings and skill definitions.',
    gitExcludePatterns: ['.antigravitycli/']
  },
  {
    id: 'bmad_claude',
    name: 'Claude BMAD Skills',
    folderName: '.claude\\skills',
    description: 'Claude-specific skills and agent instructions.',
    gitExcludePatterns: ['.claude/skills/bmad-*/']
  },
  {
    id: 'bmad_codex',
    name: 'Codex BMAD Skills',
    folderName: '.codex\\skills',
    description: 'Codex-specific skills and custom Codex settings.',
    gitExcludePatterns: ['.codex/skills/bmad-*/']
  },
  {
    id: 'bmad_opencode',
    name: 'OpenCode BMAD Skills',
    isMulti: true,
    folders: [
      { name: '.opencode\\skills', pattern: '.opencode/skills/' },
      { name: '.opencode\\commands', pattern: '.opencode/commands/' }
    ],
    description: 'OpenCode-specific skills and tools.',
    gitExcludePatterns: ['.opencode/skills/bmad-*/', '.opencode/commands/bmad-*/']
  },
  {
    id: 'bmad_shared',
    name: 'Shared Agent Skills & Workflows',
    isMulti: true,
    folders: [
      { name: '.agent\\skills', pattern: '.agent/skills/' },
      { name: '.agent\\workflows', pattern: '.agent/workflows/' }
    ],
    description: 'Shared agent workflow commands and shared custom skills.',
    gitExcludePatterns: ['.agent/skills/bmad-*/', '.agent/workflows/bmad-*']
  }
];

async function refreshAgentToolkitStatus() {
  const activeWorktreePath = state.activeWorktreePath;
  const projectPath = state.selectedProjectPath || (state.projects[0] ? state.projects[0].path : null);
  
  if (!activeWorktreePath || !projectPath) {
    if (dom.agentToolkitListContainer) {
      dom.agentToolkitListContainer.innerHTML = `<div class="symlink-empty-state">No Active Worktree or Project path found.</div>`;
    }
    return;
  }

  const cleanPath = (p) => p.replace(/\//g, '\\');
  const pPath = cleanPath(projectPath);

  // 1. Determine openspecSourcePath (setting -> embedded defaults -> candidates -> default)
  const defaultSources = await window.api.getDefaultToolkitSources();
  let openspecPath = state.settings.openspecSourcePath || '';
  if (!openspecPath) {
    if (await window.api.pathExists(defaultSources.openspecPath)) {
      openspecPath = defaultSources.openspecPath;
    } else {
      const openspecCandidates = [
        pPath + '\\OpenSpec',
        pPath + '\\openspec',
        pPath + '\\openspec-source'
      ];
      for (const cand of openspecCandidates) {
        if (await window.api.pathExists(cand)) {
          openspecPath = cand;
          break;
        }
      }
    }
  }
  if (!openspecPath) {
    openspecPath = defaultSources.openspecPath;
  }

  // Determine bmadSourcePath (setting -> embedded defaults -> candidates -> default)
  let bmadPath = state.settings.bmadSourcePath || '';
  if (!bmadPath) {
    if (await window.api.pathExists(defaultSources.bmadPath)) {
      bmadPath = defaultSources.bmadPath;
    } else {
      const bmadCandidates = [
        pPath + '\\BMAD-METHOD',
        pPath + '\\bmad-method',
        pPath + '\\BMAD',
        pPath + '\\_bmad'
      ];
      for (const cand of bmadCandidates) {
        if (await window.api.pathExists(cand)) {
          bmadPath = cand;
          break;
        }
      }
    }
  }
  if (!bmadPath) {
    bmadPath = defaultSources.bmadPath;
  }


  const listContainer = dom.agentToolkitListContainer;
  if (!listContainer) return;

  const savedScrollTop = listContainer.scrollTop;

  if (!listContainer.innerHTML || listContainer.innerHTML.includes('No Active Worktree') || listContainer.innerHTML.includes('No active project')) {
    listContainer.innerHTML = `<div style="display:flex; justify-content:center; padding:16px; align-items:center; gap:8px;"><span class="spinner"></span> Checking status...</div>`;
  }

  try {
    const OPENSPEC_PLATFORMS = [
      { id: 'openspec_antigravity', name: 'Antigravity', description: 'Deploys OpenSpec shared skills and slash-command workflows.' },
      { id: 'openspec_claude', name: 'Claude', description: 'Deploys Claude-specific skills and agent instructions.' },
      { id: 'openspec_codex', name: 'Codex', description: 'Deploys Codex-specific skills and custom Codex settings.' },
      { id: 'openspec_opencode', name: 'OpenCode', description: 'Deploys OpenCode-specific skills and command definitions.' }
    ];

    const BMAD_PLATFORMS = [
      { id: 'bmad_antigravity', name: 'Antigravity', description: 'Deploys local Antigravity settings and skill definitions.' },
      { id: 'bmad_claude', name: 'Claude', description: 'Deploys Claude-specific skills and agent instructions.' },
      { id: 'bmad_codex', name: 'Codex', description: 'Deploys Codex-specific skills and custom Codex settings.' },
      { id: 'bmad_opencode', name: 'OpenCode', description: 'Deploys OpenCode-specific skills and command definitions.' }
    ];

    // Fetch statuses for all components
    const statuses = await Promise.all(TOOLKIT_COMPONENTS.map(async (comp) => {
      const srcBase = comp.id.startsWith('openspec_') ? openspecPath : bmadPath;
      
      let sourceExists = false;
      try {
        if (comp.isMulti) {
          const folderChecks = await Promise.all(comp.folders.map(async (f) => {
            return await window.api.pathExists(srcBase + '\\' + f.name);
          }));
          sourceExists = folderChecks.every(v => v);
        } else {
          sourceExists = await window.api.pathExists(srcBase + '\\' + comp.folderName);
        }
      } catch (err) {
        sourceExists = false;
      }

      let exists = false;
      if (comp.isMulti) {
        const subResults = await Promise.all(comp.folders.map(async (f) => {
          try {
            const status = await window.api.checkToolkitStatus({
              worktreePath: activeWorktreePath,
              name: f.name
            });
            return status.exists;
          } catch (e) {
            return false;
          }
        }));
        exists = subResults.every(r => r);
      } else {
        try {
          const status = await window.api.checkToolkitStatus({
            worktreePath: activeWorktreePath,
            name: comp.folderName
          });
          exists = status.exists;
        } catch (e) {
          exists = false;
        }
      }

      return {
        id: comp.id,
        name: comp.name,
        sourceExists,
        exists
      };
    }));

    const getStatus = (id) => statuses.find(s => s.id === id) || { exists: false, sourceExists: false };

    function renderPlatformItem(platform) {
      const stateItem = getStatus(platform.id);
      let badgeHTML = '';
      let checked = '';
      let disabledAttr = '';
      let opacityStyle = '';

      if (!stateItem.sourceExists) {
        badgeHTML = `<span class="symlink-status-badge symlink-status-unlinked" style="background: rgba(239, 68, 68, 0.15); color: rgb(248, 113, 113); border: 1px solid rgba(239, 68, 68, 0.25);">Source Missing</span>`;
        disabledAttr = 'disabled';
        opacityStyle = 'opacity: 0.65;';
      } else if (stateItem.exists) {
        badgeHTML = `<span class="symlink-status-badge symlink-status-linked" style="background: rgba(16, 185, 129, 0.15); color: rgb(52, 211, 153); border: 1px solid rgba(16, 185, 129, 0.25);">Active</span>`;
        checked = 'checked';
      } else {
        badgeHTML = `<span class="symlink-status-badge symlink-status-unlinked" style="background: rgba(255, 255, 255, 0.05); color: var(--text-tertiary); border: 1px solid var(--border-subtle);">Not Present</span>`;
      }

      // Determine platform icon based on ID prefix/suffix
      let platformIcon = '';
      if (platform.id.includes('antigravity')) {
        platformIcon = `<span style="display: inline-flex; align-items: center; justify-content: center; color: var(--accent-default); width: 16px; height: 16px;">${icons.antigravity}</span>`;
      } else if (platform.id.includes('claude')) {
        platformIcon = `<span style="display: inline-flex; align-items: center; justify-content: center; color: #d97706; width: 16px; height: 16px;">${icons.claude}</span>`;
      } else if (platform.id.includes('codex')) {
        platformIcon = `<span style="display: inline-flex; align-items: center; justify-content: center; color: #2563eb; width: 16px; height: 16px;">${icons.codex}</span>`;
      } else if (platform.id.includes('opencode')) {
        platformIcon = `<span style="display: inline-flex; align-items: center; justify-content: center; color: #4b5563; width: 16px; height: 16px;">${icons.opencode}</span>`;
      }

      return `
        <div class="symlink-item" style="margin-bottom: 8px; border-radius: var(--radius-md); padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; background: var(--bg-elevated); border: 1px solid var(--border-subtle); ${opacityStyle}">
          <label class="symlink-label" style="cursor: ${stateItem.sourceExists ? 'pointer' : 'not-allowed'}; display: flex; align-items: center; gap: 8px; width: 100%;">
            <input type="checkbox" class="agent-toolkit-checkbox" data-id="${platform.id}" ${checked} ${disabledAttr} style="margin-right: 4px; cursor: ${stateItem.sourceExists ? 'pointer' : 'not-allowed'};" />
            ${platformIcon}
            <span class="symlink-name" style="font-size: 13px; font-weight: 600; color: var(--text-default);">${platform.name}</span>
          </label>
          <div style="display:flex; align-items:center; gap:8px; flex-shrink: 0;">
            ${badgeHTML}
          </div>
        </div>
      `;
    }

    // Generate OpenSpec HTML Group
    const osItemsHtml = OPENSPEC_PLATFORMS.map(p => renderPlatformItem(p)).join('');
    const osCoreActive = getStatus('openspec_core').exists;
    const osCoreBadge = osCoreActive 
      ? `<span class="symlink-status-badge symlink-status-linked" style="background: rgba(16, 185, 129, 0.15); color: rgb(52, 211, 153); font-size: 10px; padding: 2px 6px;">Core Active</span>` 
      : `<span class="symlink-status-badge symlink-status-unlinked" style="font-size: 10px; padding: 2px 6px;">Core Idle</span>`;
      
    const openspecHtml = `
      <div style="display: flex; flex-direction: column; align-items: stretch; gap: 12px; padding: 18px 20px; background: var(--bg-default); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); height: 100%;">
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="color: var(--accent-default); display: flex; align-items: center; font-size: 18px;">
              ${icons.openspec}
            </div>
            <div class="symlink-info">
              <span class="symlink-name" style="font-size: 15px; font-weight: 700; color: var(--text-default);">Open Spec</span>
            </div>
          </div>
          ${osCoreBadge}
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--border-subtle); padding-top: 14px; margin-top: 6px;">
          ${osItemsHtml}
        </div>
      </div>
    `;

    // Generate BMAD HTML Group
    const bmadItemsHtml = BMAD_PLATFORMS.map(p => renderPlatformItem(p)).join('');
    const bmadCoreActive = getStatus('bmad_core').exists;
    const bmadCoreBadge = bmadCoreActive 
      ? `<span class="symlink-status-badge symlink-status-linked" style="background: rgba(16, 185, 129, 0.15); color: rgb(52, 211, 153); font-size: 10px; padding: 2px 6px;">Core Active</span>` 
      : `<span class="symlink-status-badge symlink-status-unlinked" style="font-size: 10px; padding: 2px 6px;">Core Idle</span>`;

    const bmadHtml = `
      <div style="display: flex; flex-direction: column; align-items: stretch; gap: 12px; padding: 18px 20px; background: var(--bg-default); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); height: 100%;">
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="color: var(--accent-default); display: flex; align-items: center; font-size: 18px;">
              ${icons.bmad}
            </div>
            <div class="symlink-info">
              <span class="symlink-name" style="font-size: 15px; font-weight: 700; color: var(--text-default);">BMAD METHOD</span>
            </div>
          </div>
          ${bmadCoreBadge}
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--border-subtle); padding-top: 14px; margin-top: 6px;">
          ${bmadItemsHtml}
        </div>
      </div>
    `;

    listContainer.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; width: 100%;">
        ${openspecHtml}
        ${bmadHtml}
      </div>
    `;

    listContainer.scrollTop = savedScrollTop;

    listContainer.querySelectorAll('.agent-toolkit-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', async (e) => {
        const target = e.target;
        const id = target.dataset.id;
        const isChecked = target.checked;
        const comp = TOOLKIT_COMPONENTS.find(c => c.id === id);

        if (!comp) return;
        target.disabled = true;

        const srcBase = id.startsWith('openspec_') ? openspecPath : bmadPath;

        const safeDeploy = async (name, sourcePath) => {
          const res = await window.api.deployToolkit({
            worktreePath: activeWorktreePath,
            name,
            sourcePath
          });
          if (!res.success) throw new Error(res.error || `Failed to deploy ${name}`);
        };

        const safeRemove = async (name, sourcePath) => {
          const res = await window.api.removeToolkit({
            worktreePath: activeWorktreePath,
            name,
            sourcePath
          });
          if (!res.success) throw new Error(res.error || `Failed to remove ${name}`);
        };

        try {
          if (isChecked) {
            showToast(`Activating ${comp.name}...`, 'info');
            
            // 1. Deploy platform component itself
            if (comp.isMulti) {
              for (const f of comp.folders) {
                await safeDeploy(f.name, srcBase + '\\' + f.name);
              }
            } else {
              await safeDeploy(comp.folderName, srcBase + '\\' + comp.folderName);
            }

            // Exclude platform component patterns
            await window.api.updateGitExclude({
              worktreePath: activeWorktreePath,
              patterns: comp.gitExcludePatterns,
              action: 'add'
            });

            // 2. Deploy core and shared components if not already active
            if (id.startsWith('openspec_')) {
              // OpenSpec Core
              const coreStatus = getStatus('openspec_core');
              if (!coreStatus.exists) {
                const coreComp = TOOLKIT_COMPONENTS.find(c => c.id === 'openspec_core');
                if (coreComp) {
                  await safeDeploy(coreComp.folderName, openspecPath + '\\' + coreComp.folderName);
                  await window.api.updateGitExclude({
                    worktreePath: activeWorktreePath,
                    patterns: coreComp.gitExcludePatterns,
                    action: 'add'
                  });
                }
              }

              // OpenSpec Shared
              const sharedStatus = getStatus('openspec_antigravity');
              if (!sharedStatus.exists) {
                const sharedComp = TOOLKIT_COMPONENTS.find(c => c.id === 'openspec_antigravity');
                if (sharedComp) {
                  for (const f of sharedComp.folders) {
                    await safeDeploy(f.name, openspecPath + '\\' + f.name);
                  }
                  await window.api.updateGitExclude({
                    worktreePath: activeWorktreePath,
                    patterns: sharedComp.gitExcludePatterns,
                    action: 'add'
                  });
                }
              }
            } else if (id.startsWith('bmad_')) {
              // BMAD Core
              const coreStatus = getStatus('bmad_core');
              if (!coreStatus.exists) {
                const coreComp = TOOLKIT_COMPONENTS.find(c => c.id === 'bmad_core');
                if (coreComp) {
                  // create _bmad-output directory
                  const outputDir = cleanPath(activeWorktreePath) + '\\_bmad-output';
                  await window.api.createDirectory(outputDir);
                  
                  await safeDeploy(coreComp.folderName, bmadPath + '\\' + coreComp.folderName);
                  await window.api.updateGitExclude({
                    worktreePath: activeWorktreePath,
                    patterns: coreComp.gitExcludePatterns,
                    action: 'add'
                  });
                }
              }

              // BMAD Shared
              const sharedStatus = getStatus('bmad_shared');
              if (!sharedStatus.exists) {
                const sharedComp = TOOLKIT_COMPONENTS.find(c => c.id === 'bmad_shared');
                if (sharedComp) {
                  for (const f of sharedComp.folders) {
                    await safeDeploy(f.name, bmadPath + '\\' + f.name);
                  }
                  await window.api.updateGitExclude({
                    worktreePath: activeWorktreePath,
                    patterns: sharedComp.gitExcludePatterns,
                    action: 'add'
                  });
                }
              }

              // BMAD Agent Skills (for Antigravity and Claude)
              if (id === 'bmad_antigravity' || id === 'bmad_claude') {
                const skillsStatus = getStatus('bmad_agent_skills');
                if (!skillsStatus.exists) {
                  const skillsComp = TOOLKIT_COMPONENTS.find(c => c.id === 'bmad_agent_skills');
                  if (skillsComp) {
                    await safeDeploy(skillsComp.folderName, bmadPath + '\\' + skillsComp.folderName);
                    await window.api.updateGitExclude({
                      worktreePath: activeWorktreePath,
                      patterns: skillsComp.gitExcludePatterns,
                      action: 'add'
                    });
                  }
                }
              }
            }

            showToast(`Successfully activated ${comp.name}!`, 'success');
          } else {
            showToast(`Deactivating ${comp.name}...`, 'info');
            
            // 1. Remove platform component itself
            let shouldRemovePlatform = true;
            if (id === 'openspec_antigravity') {
              const activeOpenSpecChecks = OPENSPEC_PLATFORMS.filter(p => {
                if (p.id === id) return false;
                const cb = listContainer.querySelector(`.agent-toolkit-checkbox[data-id="${p.id}"]`);
                return cb && cb.checked;
              });
              if (activeOpenSpecChecks.length > 0) {
                shouldRemovePlatform = false;
              }
            }

            if (shouldRemovePlatform) {
              if (comp.isMulti) {
                for (const f of comp.folders) {
                  await safeRemove(f.name, srcBase + '\\' + f.name);
                }
              } else {
                await safeRemove(comp.folderName, srcBase + '\\' + comp.folderName);
              }
              await window.api.updateGitExclude({
                worktreePath: activeWorktreePath,
                patterns: comp.gitExcludePatterns,
                action: 'remove'
              });
            }

            // 2. Remove core and shared components if no longer needed
            if (id.startsWith('openspec_')) {
              const activeOpenSpecChecks = OPENSPEC_PLATFORMS.filter(p => {
                if (p.id === id) return false;
                const cb = listContainer.querySelector(`.agent-toolkit-checkbox[data-id="${p.id}"]`);
                return cb && cb.checked;
              });

              if (activeOpenSpecChecks.length === 0) {
                // Remove OpenSpec Core
                const coreComp = TOOLKIT_COMPONENTS.find(c => c.id === 'openspec_core');
                if (coreComp) {
                  await safeRemove(coreComp.folderName, openspecPath + '\\' + coreComp.folderName);
                  await window.api.updateGitExclude({
                    worktreePath: activeWorktreePath,
                    patterns: coreComp.gitExcludePatterns,
                    action: 'remove'
                  });
                }
                // Remove OpenSpec Shared
                const sharedComp = TOOLKIT_COMPONENTS.find(c => c.id === 'openspec_antigravity');
                if (sharedComp) {
                  for (const f of sharedComp.folders) {
                    await safeRemove(f.name, openspecPath + '\\' + f.name);
                  }
                  await window.api.updateGitExclude({
                    worktreePath: activeWorktreePath,
                    patterns: sharedComp.gitExcludePatterns,
                    action: 'remove'
                  });
                }
              }
            } else if (id.startsWith('bmad_')) {
              const activeBmadChecks = BMAD_PLATFORMS.filter(p => {
                if (p.id === id) return false;
                const cb = listContainer.querySelector(`.agent-toolkit-checkbox[data-id="${p.id}"]`);
                return cb && cb.checked;
              });

              if (activeBmadChecks.length === 0) {
                // Remove BMAD Core
                const coreComp = TOOLKIT_COMPONENTS.find(c => c.id === 'bmad_core');
                if (coreComp) {
                  await safeRemove(coreComp.folderName, bmadPath + '\\' + coreComp.folderName);
                  await window.api.updateGitExclude({
                    worktreePath: activeWorktreePath,
                    patterns: coreComp.gitExcludePatterns,
                    action: 'remove'
                  });
                }
                // Remove BMAD Shared
                const sharedComp = TOOLKIT_COMPONENTS.find(c => c.id === 'bmad_shared');
                if (sharedComp) {
                  for (const f of sharedComp.folders) {
                    await safeRemove(f.name, bmadPath + '\\' + f.name);
                  }
                  await window.api.updateGitExclude({
                    worktreePath: activeWorktreePath,
                    patterns: sharedComp.gitExcludePatterns,
                    action: 'remove'
                  });
                }
              }

              // Deactivate bmad_agent_skills if both bmad_antigravity and bmad_claude are unchecked
              const isAntigravityActive = id === 'bmad_antigravity' ? false : (listContainer.querySelector(`.agent-toolkit-checkbox[data-id="bmad_antigravity"]`)?.checked || false);
              const isClaudeActive = id === 'bmad_claude' ? false : (listContainer.querySelector(`.agent-toolkit-checkbox[data-id="bmad_claude"]`)?.checked || false);
              
              if (!isAntigravityActive && !isClaudeActive) {
                const skillsComp = TOOLKIT_COMPONENTS.find(c => c.id === 'bmad_agent_skills');
                if (skillsComp) {
                  await safeRemove(skillsComp.folderName, bmadPath + '\\' + skillsComp.folderName);
                  await window.api.updateGitExclude({
                    worktreePath: activeWorktreePath,
                    patterns: skillsComp.gitExcludePatterns,
                    action: 'remove'
                  });
                }
              }
            }

            showToast(`Successfully deactivated ${comp.name}.`, 'success');
          }
        } catch (err) {
          showToast(`Error: ${err.message}`, 'error');
          target.checked = !isChecked;
        } finally {
          target.disabled = false;
          await refreshAgentToolkitStatus();
        }
      });
    });

  } catch (err) {
    listContainer.innerHTML = `<div style="color:var(--danger-default); padding:16px;">Failed to load status: ${err.message}</div>`;
  }
}

if (dom.btnCloseAgentToolkitScreen) {
  dom.btnCloseAgentToolkitScreen.addEventListener('click', hideAgentToolkitScreen);
}

if (dom.btnAgentToolkit) {
  dom.btnAgentToolkit.addEventListener('click', () => {
    const activeWorktreePath = getRequiredActiveWorktreePath();
    if (!activeWorktreePath) return;
    showAgentToolkitScreen();
  });
}

const { showModal, hideModal, showToast, initializeModalPrimitives } = createModalPrimitives(dom);
initializeModalPrimitives();

// ── Utilities ──────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Auto Refresh ───────────────────────────────────────
let autoRefreshIntervalId = null;

function startAutoRefreshLoop() {
  if (autoRefreshIntervalId) {
    clearInterval(autoRefreshIntervalId);
    autoRefreshIntervalId = null;
  }
  const intervalSeconds = state.settings?.autoRefreshInterval || 10;
  const intervalMs = intervalSeconds * 1000;
  autoRefreshIntervalId = setInterval(async () => {
    if (state.settings?.autoRefreshCurrentProject && state.selectedProjectPath) {
      try {
        await window.api.refreshWorktrees(state.selectedProjectPath);
        await loadWorkspaces();
      } catch (err) {
        console.error('Auto refresh failed:', err);
      }
    }
  }, intervalMs);
}

// ── Initialize ─────────────────────────────────────────
initializeRendererLifecycle({
  loadWorkspaceSidebarCollapsed,
  setWorkspaceSidebarCollapsed,
  loadTabSidebarCollapsed,
  setTabSidebarCollapsed,
  loadWorkspaces,
  PREWARM_TOOLS,
  cleanupPrewarm,
  state,
  ptyKill: window.api.ptyKill,
});

startAutoRefreshLoop();
