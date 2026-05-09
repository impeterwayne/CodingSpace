async function openSettingsModal({ dom, state, icons, configureModalFooter, showModal, focusModalInputLater, hideModal, withAsyncButtonState, showToast, bindModalEnterSubmit, api }) {
  dom.modalTitle.textContent = 'Settings';

  dom.modalBody.innerHTML = `
    <div class="form-group">
      <label class="form-label">Sub Worktree Base Path</label>
      <input class="form-input" id="settings-worktree-base-path" placeholder="Leave empty to use projectname.subworktree" autocomplete="off" spellcheck="false" />
      <p class="form-hint">Set where sub worktrees are stored. Leave it empty to use the default <code>projectname.subworktree</code> location.</p>
    </div>
  `;

  const basePathInput = dom.modalBody.querySelector('#settings-worktree-base-path');
  basePathInput.value = state.settings?.worktreeBasePath || '';

  const { 'modal-cancel': cancelBtn, 'modal-confirm': confirmBtn } = configureModalFooter([
    { id: 'modal-cancel', label: 'Cancel' },
    { id: 'modal-confirm', label: `${icons.settings} Save Settings`, kind: 'primary' },
  ]);

  showModal();
  focusModalInputLater(basePathInput);

  cancelBtn.addEventListener('click', hideModal);
  confirmBtn.addEventListener('click', async () => {
    const settings = await withAsyncButtonState(confirmBtn, 'Saving...', async () => api.updateSettings({
      worktreeBasePath: basePathInput.value,
    }));

    state.settings = settings || { worktreeBasePath: '' };
    showToast('Settings saved', 'success');
    hideModal();
  });

  bindModalEnterSubmit(basePathInput, confirmBtn);
}

module.exports = {
  openSettingsModal,
};
