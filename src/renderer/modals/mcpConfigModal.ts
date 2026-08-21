const DEFAULT_MCP_SERVERS = {
  "figma-mcp-android": {
    "command": "npx",
    "args": [
      "-y",
      "@impeterwayne/figma-mcp-android@latest"
    ],
    "disabled": true
  },
  "gradle": {
    "command": "jbang",
    "args": [
      "run",
      "--quiet",
      "--fresh",
      "gradle-mcp@rnett"
    ],
    "env": {
      "JAVA_HOME": "C:\\Users\\Admin\\.jbang\\cache\\jdks\\21"
    },
    "disabled": true
  },
  "ghidra-mcp": {
    "command": "python",
    "args": [
      "D:\\Tools\\Ghidra\\ghidra_12.1_PUBLIC\\bridge_mcp_ghidra.py"
    ],
    "disabled": true
  },
  "http-toolkit": {
    "command": "C:\\Users\\Admin\\AppData\\Local\\Programs\\HTTP Toolkit\\resources\\httptoolkit-mcp.cmd",
    "disabled": true
  },
  "pencil": {
    "command": "D:\\Tools\\Pencil\\resources\\app.asar.unpacked\\out\\mcp-server-windows-x64.exe",
    "args": [
      "--app",
      "desktop"
    ],
    "env": {},
    "disabled": true
  },
  "scrcpy": {
    "command": "npx",
    "args": [
      "scrcpy-mcp"
    ],
    "disabled": true
  }
};

async function openMcpConfigModal({
  title,
  dirPath,
  dom,
  icons,
  configureModalFooter,
  showModal,
  hideModal,
  withAsyncButtonState,
  showToast,
  api,
}) {
  dom.modalTitle.textContent = title;

  // Inject custom styles if not already present
  let styleEl = document.getElementById('mcp-config-modal-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'mcp-config-modal-styles';
    styleEl.innerHTML = `
      .json-key { color: var(--blue); font-weight: 500; }
      .json-string { color: var(--green); }
      .json-number { color: var(--orange); }
      .json-boolean { color: var(--accent-light); font-weight: 600; }
      .json-null { color: var(--text-muted); font-style: italic; }
      
      .mcp-checkbox-container input:checked ~ .checkmark {
        background-color: var(--accent);
        border-color: var(--accent);
      }
      .mcp-checkbox-container input:checked ~ .checkmark::after {
        content: "";
        position: absolute;
        left: 5px;
        top: 2px;
        width: 4px;
        height: 8px;
        border: solid white;
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
      }
      .mcp-server-card {
        border: 1px solid var(--border-default);
      }
      .mcp-server-card:hover {
        border-color: var(--border-strong);
        background: var(--bg-card-hover) !important;
      }
      .mcp-server-card.disabled-server {
        opacity: 0.6;
        border-style: dashed;
      }
      .mcp-server-status-badge.status-active {
        background: var(--green-dim);
        color: var(--green);
      }
      .mcp-server-status-badge.status-disabled {
        background: var(--red-dim);
        color: var(--red);
      }
    `;
    document.head.appendChild(styleEl);
  }

  dom.modalBody.innerHTML = `
    <div class="form-group" style="margin-bottom: var(--section-gap-md);">
      <label class="form-label" for="mcp-tool-select">Select Tool</label>
      <select class="form-select" id="mcp-tool-select" style="background-color: var(--bg-input); border: 1px solid var(--border-default); border-radius: var(--radius-sm); color: var(--text-primary); font-family: var(--font-sans); font-size: 12.5px; padding: 9px 12px; outline: none; width: 100%; cursor: pointer;">
        <option value="antigravity">Antigravity (.agents/mcp_config.json)</option>
        <option value="opencode">OpenCode (.opencode.json)</option>
        <option value="claude">Claude Code (.mcp.json)</option>
      </select>
    </div>
    
    <div class="mcp-split-container" style="display: flex; gap: 20px; height: 480px; min-height: 480px; margin-top: 10px;">
      <!-- Left column: Servers Checkbox UI -->
      <div class="mcp-left-column" style="flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100%;">
        <div class="form-label" style="margin-bottom: 8px; font-weight: 600;">Active Servers</div>
        <div id="mcp-servers-list" style="flex: 1; overflow-y: auto; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-input); padding: 12px; display: flex; flex-direction: column; gap: 10px;">
          <!-- Server list is populated here -->
        </div>
      </div>
      
      <!-- Right column: Beautified JSON Viewer / Editor -->
      <div class="mcp-right-column" style="flex: 1.3; display: flex; flex-direction: column; min-width: 0; height: 100%;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <label class="form-label" style="margin: 0; font-weight: 600;">Configuration JSON</label>
          <button id="mcp-btn-edit-mode" class="btn-secondary" style="padding: 4px 10px; font-size: 11px; height: 26px; display: flex; align-items: center; gap: 6px; border: 1px solid var(--border-default); background: var(--bg-surface); border-radius: var(--radius-sm); color: var(--text-primary); cursor: pointer; transition: all var(--transition-fast);">
            <span class="mcp-edit-btn-icon">✏️</span> <span class="mcp-edit-btn-text">Edit Raw JSON</span>
          </button>
        </div>
        
        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">
          Path: <code id="mcp-config-path-code" style="word-break: break-all; font-family: var(--font-mono); color: var(--text-secondary);"></code>
        </div>
        
        <div style="position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; height: 100%;">
          <!-- View Pane (Syntax highlighted) -->
          <pre id="mcp-json-pre" style="flex: 1; margin: 0; font-family: var(--font-mono); font-size: 11.5px; line-height: 1.5; padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-default); background: var(--bg-surface); overflow: auto; white-space: pre-wrap; word-break: break-all; color: var(--text-primary);"></pre>
          
          <!-- Edit Pane (Textarea) -->
          <textarea 
            id="mcp-config-textarea" 
            style="display: none; flex: 1; margin: 0; font-family: var(--font-mono); font-size: 11.5px; line-height: 1.5; padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-default); background: var(--bg-surface); color: var(--text-primary); resize: none; outline: none; transition: border-color var(--transition-fast); height: 100%; width: 100%; box-sizing: border-box;" 
            spellcheck="false" 
            autocomplete="off"
            placeholder="Loading config..."
          ></textarea>
        </div>
      </div>
    </div>
  `;

  const select = dom.modalBody.querySelector('#mcp-tool-select');
  const pathCode = dom.modalBody.querySelector('#mcp-config-path-code');
  const textarea = dom.modalBody.querySelector('#mcp-config-textarea');
  const jsonPre = dom.modalBody.querySelector('#mcp-json-pre');
  const editBtn = dom.modalBody.querySelector('#mcp-btn-edit-mode');
  const editBtnText = editBtn.querySelector('.mcp-edit-btn-text');
  const editBtnIcon = editBtn.querySelector('.mcp-edit-btn-icon');
  const serversContainer = dom.modalBody.querySelector('#mcp-servers-list');
  
  // Set modal width to 950px for comfortable split layout
  dom.modal.style.width = '950px';

  const { 'modal-cancel': cancelBtn, 'modal-confirm': confirmBtn } = configureModalFooter([
    { id: 'modal-cancel', label: 'Cancel' },
    { id: 'modal-confirm', label: `${icons.settings} Save Config`, kind: 'primary' },
  ]);

  let currentTool = 'antigravity';
  let lastLoadedContent = '';
  let currentJsonObj = null;
  let isEditMode = false;

  const getPathForTool = (tool) => {
    if (tool === 'antigravity') return `${dirPath}/.agents/mcp_config.json`;
    if (tool === 'opencode') return `${dirPath}/.opencode.json`;
    if (tool === 'claude') return `${dirPath}/.mcp.json`;
    return '';
  };

  const highlightJson = (jsonStr) => {
    let html = jsonStr
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    return html.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, function (match) {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'json-key';
        } else {
          cls = 'json-string';
        }
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return '<span class="' + cls + '">' + match + '</span>';
    });
  };

  const renderHighlightedJson = (content) => {
    jsonPre.innerHTML = highlightJson(content);
  };

  const renderInvalidJsonState = (errorMessage) => {
    serversContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; color: var(--red); font-size: 12px; padding: 20px; gap: 8px;">
        <span style="font-size: 24px;">⚠️</span>
        <strong>Invalid JSON Syntax</strong>
        <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); background: var(--red-dim); padding: 8px; border-radius: var(--radius-xs); word-break: break-all; width: 100%;">
          ${errorMessage}
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">
          Click "Edit Raw JSON" to correct syntax errors.
        </div>
      </div>
    `;
    jsonPre.innerHTML = `<span style="color: var(--text-muted); font-style: italic;">Unable to format due to JSON syntax error.</span>`;
  };

  const handleCheckboxChange = (serverName, isChecked) => {
    if (!currentJsonObj) return;
    if (!currentJsonObj.mcpServers) currentJsonObj.mcpServers = {};
    
    if (isChecked) {
      if (!currentJsonObj.mcpServers[serverName]) {
        // Populate with default config if not present
        const defaultVal = DEFAULT_MCP_SERVERS[serverName];
        if (defaultVal) {
          // Clone it so we don't mutate the reference
          currentJsonObj.mcpServers[serverName] = JSON.parse(JSON.stringify(defaultVal));
          // Explicitly make sure disabled is false/deleted when turned ON
          delete currentJsonObj.mcpServers[serverName].disabled;
        } else {
          currentJsonObj.mcpServers[serverName] = { command: '', args: [], disabled: false };
        }
      } else {
        currentJsonObj.mcpServers[serverName].disabled = false;
      }
    } else {
      if (currentJsonObj.mcpServers[serverName]) {
        currentJsonObj.mcpServers[serverName].disabled = true;
      }
    }
    
    const newContent = JSON.stringify(currentJsonObj, null, 2);
    textarea.value = newContent;
    renderHighlightedJson(newContent);
    renderServerList(currentJsonObj);
  };

  const renderServerList = (jsonObj) => {
    serversContainer.innerHTML = '';
    const mcpServers = jsonObj.mcpServers || {};
    
    // Union of default keys and keys in mcpServers
    const serverNames = Array.from(new Set([
      ...Object.keys(DEFAULT_MCP_SERVERS),
      ...Object.keys(mcpServers)
    ]));
    
    if (serverNames.length === 0) {
      serversContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; color: var(--text-muted); font-size: 12px; padding: 20px;">
          <span style="font-size: 24px; margin-bottom: 8px;">🔌</span>
          No MCP servers defined.
        </div>
      `;
      return;
    }
    
    serverNames.forEach(name => {
      // Find server configuration from jsonObj, fallback to DEFAULT_MCP_SERVERS
      const serverInObj = mcpServers[name];
      const defaultVal = DEFAULT_MCP_SERVERS[name];
      const serverObj = serverInObj || defaultVal || {};
      
      // A server is active (enabled) if it exists in jsonObj and is NOT disabled
      const isEnabled = serverInObj && serverInObj.disabled !== true;
      const isDisabled = !isEnabled;
      
      let cmdText = serverObj.command || '';
      if (serverObj.args && Array.isArray(serverObj.args)) {
        cmdText += ' ' + serverObj.args.join(' ');
      }
      
      const card = document.createElement('div');
      card.className = `mcp-server-card ${isDisabled ? 'disabled-server' : ''}`;
      card.style.cssText = `
        border: 1px solid var(--border-default);
        border-radius: var(--radius-sm);
        padding: 10px;
        background: var(--bg-surface);
        display: flex;
        align-items: flex-start;
        gap: 10px;
        transition: all var(--transition-fast);
        cursor: pointer;
      `;
      
      card.innerHTML = `
        <label class="mcp-checkbox-container" style="display: block; position: relative; cursor: pointer; user-select: none; margin-top: 2px;">
          <input type="checkbox" class="mcp-server-checkbox" data-server-name="${name}" ${isEnabled ? 'checked' : ''} style="position: absolute; opacity: 0; cursor: pointer; height: 0; width: 0;">
          <span class="checkmark" style="position: relative; display: inline-block; height: 16px; width: 16px; background-color: var(--bg-input); border: 1px solid var(--border-default); border-radius: var(--radius-xs); transition: all 0.2s;"></span>
        </label>
        
        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; pointer-events: none;">
          <div class="mcp-server-title-row" style="display: flex; justify-content: space-between; align-items: center; pointer-events: none;">
            <span class="mcp-server-name" style="font-weight: 600; font-size: 13px; color: var(--text-primary); font-family: var(--font-sans); pointer-events: none;">${name}</span>
            <span class="mcp-server-status-badge ${isDisabled ? 'status-disabled' : 'status-active'}" style="font-size: 9px; padding: 1px 6px; border-radius: var(--radius-xs); font-weight: 600; text-transform: uppercase; pointer-events: none;">
              ${isDisabled ? 'disabled' : 'enabled'}
            </span>
          </div>
          
          <div class="mcp-server-command" style="font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); word-break: break-all; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none;" title="${cmdText}">
            ${cmdText}
          </div>
        </div>
      `;
      
      card.addEventListener('click', () => {
        const checkbox = card.querySelector('.mcp-server-checkbox');
        checkbox.checked = !checkbox.checked;
        handleCheckboxChange(name, checkbox.checked);
      });
      
      const checkmarkContainer = card.querySelector('.mcp-checkbox-container');
      checkmarkContainer.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      
      const checkboxEl = card.querySelector('.mcp-server-checkbox');
      checkboxEl.addEventListener('change', () => {
        handleCheckboxChange(name, checkboxEl.checked);
      });
      
      serversContainer.appendChild(card);
    });
  };

  const parseAndRender = () => {
    const content = textarea.value.trim();
    try {
      currentJsonObj = JSON.parse(content);
      if (!currentJsonObj.mcpServers) {
        currentJsonObj.mcpServers = {};
      }
      renderServerList(currentJsonObj);
      renderHighlightedJson(content);
    } catch (e) {
      currentJsonObj = null;
      renderInvalidJsonState(e.message);
    }
  };

  const loadConfigForTool = async (tool) => {
    textarea.value = '';
    textarea.placeholder = 'Loading config...';
    pathCode.textContent = getPathForTool(tool);
    
    isEditMode = false;
    editBtnText.textContent = 'Edit Raw JSON';
    editBtnIcon.textContent = '✏️';
    jsonPre.style.display = 'block';
    textarea.style.display = 'none';
    
    try {
      const result = await api.readMcpConfig(dirPath, tool);
      if (result.success) {
        const content = result.content || '{\n  "mcpServers": {}\n}';
        textarea.value = content;
        lastLoadedContent = content;
        parseAndRender();
      } else {
        showToast(`Failed to load config: ${result.error}`, 'error');
        lastLoadedContent = '';
        renderInvalidJsonState(result.error);
      }
    } catch (err) {
      showToast(`Error reading config: ${err.message}`, 'error');
      lastLoadedContent = '';
      renderInvalidJsonState(err.message);
    }
  };

  showModal();
  textarea.focus();

  // Load initial config
  await loadConfigForTool(currentTool);

  editBtn.addEventListener('click', () => {
    if (isEditMode) {
      const content = textarea.value.trim();
      try {
        JSON.parse(content);
        isEditMode = false;
        editBtnText.textContent = 'Edit Raw JSON';
        editBtnIcon.textContent = '✏️';
        jsonPre.style.display = 'block';
        textarea.style.display = 'none';
        parseAndRender();
      } catch (e) {
        showToast(`Invalid JSON: ${e.message}`, 'error');
        textarea.style.borderColor = 'var(--red)';
        setTimeout(() => {
          textarea.style.borderColor = 'var(--border-default)';
        }, 1000);
      }
    } else {
      isEditMode = true;
      editBtnText.textContent = 'View Formatted';
      editBtnIcon.textContent = '👁️';
      jsonPre.style.display = 'none';
      textarea.style.display = 'block';
      textarea.focus();
    }
  });

  select.addEventListener('change', async () => {
    const nextTool = select.value;
    if (textarea.value.trim() !== lastLoadedContent.trim()) {
      const discard = confirm('You have unsaved changes. Do you want to discard them and switch tools?');
      if (!discard) {
        select.value = currentTool;
        return;
      }
    }
    currentTool = nextTool;
    await loadConfigForTool(currentTool);
  });

  cancelBtn.addEventListener('click', hideModal);

  confirmBtn.addEventListener('click', async () => {
    if (isEditMode) {
      const content = textarea.value.trim();
      try {
        JSON.parse(content);
      } catch (e) {
        showToast(`Invalid JSON: ${e.message}`, 'error');
        return;
      }
    }

    const content = textarea.value.trim();
    const result = await withAsyncButtonState(
      confirmBtn,
      'Saving...',
      async () => api.writeMcpConfig(dirPath, currentTool, content)
    );

    if (result.success) {
      showToast('MCP config saved', 'success');
      lastLoadedContent = content;
      hideModal();
    } else {
      showToast(`Failed to save config: ${result.error}`, 'error');
    }
  });
}

module.exports = {
  openMcpConfigModal,
};
