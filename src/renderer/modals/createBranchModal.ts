async function openCreateBranchModal({ project, dom, icons, configureModalFooter, showModal, focusModalInputLater, hideModal, showToast, isInvalidGitBranchName, withAsyncButtonState, bindModalEnterSubmit, api }) {
  dom.modalTitle.textContent = 'Create Branch';

  dom.modalBody.innerHTML = `
    <div class="form-group">
      <label class="form-label">New Branch Name</label>
      <input class="form-input" id="new-branch-name" placeholder="e.g. feature/my-feature" autocomplete="off" spellcheck="false" />
    </div>
    <p class="form-hint">Creates a new branch from the current HEAD. You can create a worktree for it later.</p>
  `;

  const nameInput = dom.modalBody.querySelector('#new-branch-name');
  const { 'modal-cancel': cancelBtn, 'modal-confirm': confirmBtn } = configureModalFooter([
    { id: 'modal-cancel', label: 'Cancel' },
    { id: 'modal-confirm', label: `${icons.gitBranch} Create Branch`, kind: 'primary' },
  ]);
  const defaultConfirmLabel = confirmBtn.innerHTML;

  showModal();
  focusModalInputLater(nameInput);

  cancelBtn.addEventListener('click', hideModal);
  confirmBtn.addEventListener('click', async () => {
    const branchName = nameInput.value.trim();
    if (!branchName) { showToast('Please enter a branch name', 'error'); return; }
    if (isInvalidGitBranchName(branchName)) {
      showToast('Invalid branch name', 'error');
      return;
    }

    const result = await withAsyncButtonState(
      confirmBtn,
      'Creating...',
      async () => api.createBranch({ projectPath: project.path, branchName }),
      defaultConfirmLabel
    );

    if (result.success) {
      showToast(`Branch created: ${branchName}`, 'success');
      hideModal();
      return;
    }

    showToast(`Failed: ${result.error}`, 'error');
  });

  bindModalEnterSubmit(nameInput, confirmBtn);
}

module.exports = {
  openCreateBranchModal,
};
