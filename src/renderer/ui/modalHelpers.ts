function createModalHelpers(dom) {
  function buildModalFooterHTML(actions) {
    return actions
      .map(({ id, label, kind = 'secondary', danger = false }) => {
        const className = kind === 'primary'
          ? `btn-primary${danger ? ' danger-btn' : ''}`
          : 'btn-secondary';
        return `<button class="${className}" id="${id}">${label}</button>`;
      })
      .join('');
  }

  function configureModalFooter(actions) {
    dom.modalFooter.innerHTML = buildModalFooterHTML(actions);
    return actions.reduce((acc, action) => {
      acc[action.id] = dom.modalFooter.querySelector(`#${action.id}`);
      return acc;
    }, {});
  }

  function focusModalInputLater(element) {
    setTimeout(() => element.focus(), 100);
  }

  function bindModalEnterSubmit(inputEl, submitButton) {
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitButton.click();
      }
    });
  }

  async function withAsyncButtonState(button, pendingLabel, action, resetLabel) {
    const label = resetLabel || button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span> ${pendingLabel}`;
    try {
      return await action();
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.innerHTML = label;
      }
    }
  }

  return {
    configureModalFooter,
    focusModalInputLater,
    bindModalEnterSubmit,
    withAsyncButtonState,
  };
}

module.exports = {
  createModalHelpers,
};
