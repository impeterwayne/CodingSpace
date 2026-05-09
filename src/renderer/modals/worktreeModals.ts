async function openAddWorktreeModal({ project, dom, api, getAvailableWorktreeBranches, getOfficialWorktreeBasePath, branchComboHTML, setupBranchCombo, syncWorktreePathInput, configureModalFooter, showModal, focusModalInputLater, hideModal, createWorktreeSubmitHandler }) {
  dom.modalTitle.textContent = 'Add Worktree';
  const branches = await api.getBranches(project.path);
  const availableBranches = getAvailableWorktreeBranches(project, branches);
  const officialWorktreesDir = getOfficialWorktreeBasePath(project);

  dom.modalBody.innerHTML = `
    <div class="form-group">
      <label class="form-label">Branch</label>
      ${branchComboHTML()}
    </div>
    <div class="form-group">
      <label class="form-label">Worktree Path</label>
      <input class="form-input" id="wt-path-input" />
    </div>
    <p class="form-hint">This creates an official worktree under <code>projectname.worktrees</code>. To add a subworktree, right-click an official worktree and choose <strong>Add sub worktree</strong>.</p>
  `;

  const pathInput = dom.modalBody.querySelector('#wt-path-input');
  const comboContainer = dom.modalBody.querySelector('.branch-combo');
  const combo = setupBranchCombo({
    containerEl: comboContainer,
    branches: availableBranches,
    placeholder: 'Search or create a branch...',
    showCreateOption: true,
    onSelect: syncWorktreePathInput(pathInput, officialWorktreesDir, project.name),
  });

  const { 'modal-cancel': cancelBtn, 'modal-confirm': confirmBtn } = configureModalFooter([
    { id: 'modal-cancel', label: 'Cancel' },
    { id: 'modal-confirm', label: 'Create Worktree', kind: 'primary' },
  ]);
  const defaultConfirmLabel = confirmBtn.innerHTML;

  showModal();
  focusModalInputLater({ focus: () => combo.focus() });

  cancelBtn.addEventListener('click', hideModal);
  confirmBtn.addEventListener('click', createWorktreeSubmitHandler({
    project,
    combo,
    pathInput,
    button: confirmBtn,
    buttonLabel: defaultConfirmLabel,
    sourceWorktreePath: project.path,
  }));
}

async function openAddSubWorktreeModal({ project, sourceWorktree, dom, state, api, canCreateNestedWorktree, showToast, getAvailableWorktreeBranches, getWorktreeBasePath, esc, branchComboHTML, setupBranchCombo, syncWorktreePathInput, configureModalFooter, showModal, focusModalInputLater, hideModal, createWorktreeSubmitHandler }) {
  if (!canCreateNestedWorktree(project, sourceWorktree)) {
    showToast('Nested worktrees cannot be created from the local worktree', 'error');
    return;
  }

  dom.modalTitle.textContent = 'Add Nested Worktree';
  const branches = await api.getBranches(project.path);
  const availableBranches = getAvailableWorktreeBranches(project, branches);
  const subWorktreesDir = getWorktreeBasePath(project);

  dom.modalBody.innerHTML = `
    <div class="form-group">
      <label class="form-label">Source Worktree</label>
      <input class="form-input" value="${esc(sourceWorktree.name)}" disabled />
    </div>
    <div class="form-group">
      <label class="form-label">Branch</label>
      ${branchComboHTML()}
    </div>
    <div class="form-group">
      <label class="form-label">Worktree Path</label>
      <input class="form-input" id="sub-wt-path-input" />
    </div>
    <p class="form-hint">This creates a normal worktree from <strong>${esc(sourceWorktree.name)}</strong> and stores it under <code>projectname.subworktree</code> unless you changed the setting.</p>
  `;

  const pathInput = dom.modalBody.querySelector('#sub-wt-path-input');
  const comboContainer = dom.modalBody.querySelector('.branch-combo');

  const combo = setupBranchCombo({
    containerEl: comboContainer,
    branches: availableBranches,
    placeholder: 'Search or create a branch...',
    showCreateOption: true,
    onSelect: syncWorktreePathInput(pathInput, subWorktreesDir, project.name),
  });

  const { 'modal-cancel': cancelBtn, 'modal-confirm': confirmBtn } = configureModalFooter([
    { id: 'modal-cancel', label: 'Cancel' },
    { id: 'modal-confirm', label: 'Create Nested Worktree', kind: 'primary' },
  ]);
  const defaultConfirmLabel = confirmBtn.innerHTML;

  showModal();
  focusModalInputLater({ focus: () => combo.focus() });

  cancelBtn.addEventListener('click', hideModal);
  confirmBtn.addEventListener('click', createWorktreeSubmitHandler({
    project,
    combo,
    pathInput,
    button: confirmBtn,
    buttonLabel: defaultConfirmLabel,
    sourceWorktreePath: sourceWorktree.path,
    onSuccess: async (selectedBranch) => {
      const nextBranchParents = {
        ...(state.settings?.subworktreeBranchParents || {}),
        [selectedBranch]: sourceWorktree.branch,
      };
      state.settings = await api.updateSettings({
        ...state.settings,
        subworktreeBranchParents: nextBranchParents,
      });
    },
  }));
}

async function openMergeWorktreeModal({ project, wt, dom, api, showToast, esc, branchComboHTML, setupBranchCombo, configureModalFooter, showModal, focusModalInputLater, hideModal, withAsyncButtonState, refreshProjectWorkspaces, icons }) {
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

  const branches = await api.getBranches(project.path);
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

  const { 'modal-cancel': cancelBtn, 'modal-confirm': confirmBtn } = configureModalFooter([
    { id: 'modal-cancel', label: 'Cancel' },
    { id: 'modal-confirm', label: `${icons.gitBranch} Merge Branch`, kind: 'primary' },
  ]);
  const defaultConfirmLabel = confirmBtn.innerHTML;

  showModal();
  focusModalInputLater({ focus: () => combo.focus() });

  cancelBtn.addEventListener('click', hideModal);
  confirmBtn.addEventListener('click', async () => {
    const { branch: targetBranch } = combo.getSelected();
    if (!targetBranch) {
      showToast('Please select a local target branch', 'error');
      return;
    }

    const result = await withAsyncButtonState(confirmBtn, 'Merging...', async () => api.mergeWorktreeToBranch({
      projectPath: project.path,
      sourceBranch: wt.branch,
      targetBranch,
    }), defaultConfirmLabel);

    if (result.success) {
      showToast(`Merged ${wt.branch} into ${targetBranch}`, 'success');
      hideModal();
      await refreshProjectWorkspaces(project.path);
      return;
    }

    showToast(`Merge failed: ${result.error}`, 'error');
  });
}

async function openForceRemoveWorktreeModal({ project, wt, dom, api, showToast, esc, configureModalFooter, showModal, hideModal, withAsyncButtonState, refreshProjectWorkspaces, icons, closeWorktreeOwnedSessions, releaseWorktreeOwnedSessions }) {
  if (wt.path === project.path) {
    showToast('Cannot force remove the primary project worktree', 'error');
    return;
  }

  const canDeleteBranch = Boolean(wt.branch) && !wt.detached && !wt.bare;

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
    ${canDeleteBranch ? `
      <div class="form-group">
        <label class="form-label">Branch deletion</label>
        <label class="form-hint">
          <input type="checkbox" id="delete-branch-toggle" />
          <span>Delete branch <code>${esc(wt.branch)}</code> after removing this worktree. Off by default.</span>
        </label>
        <p class="form-hint">Leave it off to keep branch.</p>
      </div>
    ` : `
      <p class="form-hint">This runs <code>git worktree remove --force</code>. Branch deletion is unavailable for detached or bare worktrees.</p>
    `}
    <p class="form-hint">App closes its own terminals and prewarmed tool sessions for this worktree first.</p>
    <p class="form-hint">If another program still has files open here, removal can still fail with permission denied.</p>
    <p class="form-hint">Force remove can discard uncommitted changes in this worktree.</p>
  `;

  const { 'modal-cancel': cancelBtn, 'modal-confirm': confirmBtn } = configureModalFooter([
    { id: 'modal-cancel', label: 'Cancel' },
    { id: 'modal-confirm', label: `${icons.trash} Force Remove Worktree`, kind: 'primary', danger: true },
  ]);
  const baseConfirmLabel = confirmBtn.innerHTML;
  let currentConfirmLabel = baseConfirmLabel;
  const deleteBranchToggle = canDeleteBranch ? dom.modalBody.querySelector('#delete-branch-toggle') : null;

  const syncConfirmLabel = () => {
    if (deleteBranchToggle && deleteBranchToggle.checked) {
      currentConfirmLabel = `${icons.trash} Force Remove + Delete Branch`;
    } else {
      currentConfirmLabel = baseConfirmLabel;
    }
    confirmBtn.innerHTML = currentConfirmLabel;
  };

  if (deleteBranchToggle) {
    deleteBranchToggle.addEventListener('change', syncConfirmLabel);
    syncConfirmLabel();
  }

  showModal();

  cancelBtn.addEventListener('click', hideModal);
  confirmBtn.addEventListener('click', async () => {
    const deleteBranch = Boolean(deleteBranchToggle && deleteBranchToggle.checked);
    const result = await withAsyncButtonState(confirmBtn, 'Closing sessions and removing...', async () => {
      await closeWorktreeOwnedSessions(wt.path);
      return api.forceRemoveWorktree({
        projectPath: project.path,
        wtPath: wt.path,
        deleteBranch,
      });
    }, currentConfirmLabel);

    if (result.success) {
      showToast(deleteBranch ? `Removed worktree and deleted branch: ${wt.name}` : `Force removed: ${wt.name}`, 'success');
      hideModal();
      await refreshProjectWorkspaces(project.path);
      await releaseWorktreeOwnedSessions(wt.path);
      return;
    }

    await releaseWorktreeOwnedSessions(wt.path);
    showToast(`Failed: ${result.error}`, 'error');
  });
}

module.exports = {
  openAddWorktreeModal,
  openAddSubWorktreeModal,
  openMergeWorktreeModal,
  openForceRemoveWorktreeModal,
};
