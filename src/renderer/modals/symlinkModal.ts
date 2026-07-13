async function openSymlinkModal({ activeWorktreePath, dom, state, icons, configureModalFooter, showModal, hideModal, showToast, api }) {
  dom.modalTitle.textContent = 'Manage Symlinks';

  // Add custom class to modal for sizing
  dom.modal.classList.add('symlink-modal');

  const activeWorktreeName = activeWorktreePath ? activeWorktreePath.split(/[\\/]/).pop() : 'No active project';

  dom.modalBody.innerHTML = `
    <div style="margin-bottom: 12px;">
      <span class="form-label" style="display:inline;">Active Worktree: </span>
      <span class="symlink-name" style="font-family: var(--font-mono); font-size:12px;">${activeWorktreeName}</span>
      <div style="font-size: 11px; color: var(--text-tertiary); word-break: break-all; margin-top: 4px;">
        ${activeWorktreePath || 'Please select a worktree first.'}
      </div>
    </div>

    <div style="margin-bottom: 8px;">
      <label class="form-label">Managed Symlink Targets</label>
      <div id="symlink-list-container"></div>
    </div>

    <div class="symlink-add-section">
      <label class="form-label">Add Managed Symlink Target</label>
      <div class="symlink-add-row">
        <input type="text" class="form-input" id="new-symlink-path" placeholder="Click Browse to select target folder..." readonly style="cursor: pointer;" />
        <button type="button" class="btn-secondary" id="btn-browse-symlink">Browse...</button>
      </div>
      <div class="symlink-add-row" style="margin-top: 8px;">
        <input type="text" class="form-input" id="new-symlink-name" placeholder="Symlink name (defaults to folder name)" autocomplete="off" spellcheck="false" />
        <button type="button" class="btn-primary" id="btn-add-symlink-target">${icons.plus} Add to list</button>
      </div>
    </div>
  `;

  configureModalFooter([
    { id: 'modal-close', label: 'Close' },
  ]);

  const closeBtn = dom.modalFooter.querySelector('#modal-close');
  const pathInput = dom.modalBody.querySelector('#new-symlink-path');
  const nameInput = dom.modalBody.querySelector('#new-symlink-name');
  const browseBtn = dom.modalBody.querySelector('#btn-browse-symlink');
  const addBtn = dom.modalBody.querySelector('#btn-add-symlink-target');

  const getLeafName = (dirPath) => {
    return dirPath.split(/[\\/]/).filter(Boolean).pop() || '';
  };

  const handleBrowse = async () => {
    try {
      const selectedDir = await api.selectDirectory('Select Folder to Symlink');
      if (selectedDir) {
        pathInput.value = selectedDir;
        if (!nameInput.value.trim()) {
          nameInput.value = getLeafName(selectedDir);
        }
      }
    } catch (err) {
      showToast(`Browse failed: ${err.message}`, 'error');
    }
  };

  pathInput.addEventListener('click', handleBrowse);
  browseBtn.addEventListener('click', handleBrowse);

  const saveAndReload = async (updatedTargets) => {
    const nextSettings = {
      ...state.settings,
      symlinkTargets: updatedTargets,
    };
    state.settings = await api.updateSettings(nextSettings);
    await renderSymlinkList(dom.modalBody, activeWorktreePath, state.settings.symlinkTargets, api, icons, showToast, saveAndReload);
  };

  addBtn.addEventListener('click', async () => {
    const pathVal = pathInput.value.trim();
    let nameVal = nameInput.value.trim();

    if (!pathVal) {
      showToast('Please select a target folder first', 'error');
      return;
    }
    if (!nameVal) {
      nameVal = getLeafName(pathVal);
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
    await saveAndReload(updated);

    // Clear inputs
    pathInput.value = '';
    nameInput.value = '';
    showToast(`Added "${nameVal}" to managed symlinks`, 'success');
  });

  // Scan and merge existing symlinks in the active worktree
  let initialTargets = state.settings?.symlinkTargets || [];
  if (activeWorktreePath) {
    try {
      const scanned = await api.scanSymlinks({ worktreePath: activeWorktreePath });
      if (scanned && scanned.length > 0) {
        let changed = false;
        const updated = [...initialTargets];

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
          state.settings = await api.updateSettings({
            ...state.settings,
            symlinkTargets: updated,
          });
          initialTargets = state.settings.symlinkTargets;
        }
      }
    } catch (e) {
      console.warn('Failed to scan and merge symlinks:', e.message);
    }
  }

  await renderSymlinkList(dom.modalBody, activeWorktreePath, initialTargets, api, icons, showToast, saveAndReload);

  showModal();

  const cleanup = () => {
    dom.modal.classList.remove('symlink-modal');
  };

  closeBtn.addEventListener('click', () => {
    cleanup();
    hideModal();
  });

  // Also hook click outside or ESC close
  const overlay = dom.modalOverlay;
  const overlayCloser = (e) => {
    if (e.target === overlay) {
      cleanup();
    }
  };
  overlay.addEventListener('click', overlayCloser);
  
  const originalCloseHandler = dom.modalCloseBtn.onclick;
  dom.modalCloseBtn.onclick = () => {
    cleanup();
    hideModal();
    if (originalCloseHandler) originalCloseHandler();
  };
}

async function renderSymlinkList(modalBody, activeWorktreePath, symlinkTargets, api, icons, showToast, saveAndReload) {
  const listContainer = modalBody.querySelector('#symlink-list-container');
  if (!listContainer) return;

  if (!symlinkTargets || symlinkTargets.length === 0) {
    listContainer.innerHTML = `
      <div class="symlink-empty-state">
        <div class="symlink-empty-icon" style="font-size:24px;">🔗</div>
        <div style="font-weight:600; margin-top:4px;">No managed symlinks yet</div>
        <p class="form-hint" style="margin:4px 0 0; font-size:11px;">Add a target folder below to link it to your active project.</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = `<div style="display:flex; justify-content:center; padding:16px; align-items:center; gap:8px;"><span class="spinner"></span> Checking status...</div>`;

  if (!activeWorktreePath) {
    listContainer.innerHTML = `
      <div class="symlink-empty-state">
        <div style="font-weight:600; color: var(--danger-default);">No Active Worktree</div>
        <p class="form-hint" style="margin:4px 0 0; font-size:11px;">Open a worktree or project first to select/unselect symlinks.</p>
      </div>
    `;
    return;
  }

  try {
    const statuses = await Promise.all(
      symlinkTargets.map(async (t) => {
        try {
          const status = await api.checkSymlinkStatus({
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
            const res = await api.createSymlink({ worktreePath: activeWorktreePath, name, targetPath });
            if (res.success) {
              showToast(`Linked ${name} successfully!`, 'success');
            } else {
              showToast(`Link failed: ${res.error}`, 'error');
              target.checked = false;
            }
          } else {
            showToast(`Removing symlink for ${name}...`, 'info');
            const res = await api.deleteSymlink({ worktreePath: activeWorktreePath, name });
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
          // Re-render to update status badges
          renderSymlinkList(modalBody, activeWorktreePath, symlinkTargets, api, icons, showToast, saveAndReload);
        }
      });
    });

    // Bind delete target events
    listContainer.querySelectorAll('.symlink-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const name = btn.dataset.name;
        const updated = symlinkTargets.filter((t) => t.name !== name);
        await saveAndReload(updated);
      });
    });

  } catch (err) {
    listContainer.innerHTML = `<div style="color:var(--danger-default); padding:16px;">Failed to load status: ${err.message}</div>`;
  }
}

module.exports = {
  openSymlinkModal,
};
