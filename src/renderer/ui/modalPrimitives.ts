function createModalPrimitives(dom) {
  function showModal() {
    dom.modalOverlay.style.display = '';
  }

  function hideModal() {
    dom.modalOverlay.style.display = 'none';
  }

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

  function initializeModalPrimitives() {
    dom.modalCloseBtn.addEventListener('click', hideModal);
    dom.modalOverlay.addEventListener('click', (e) => {
      if (e.target === dom.modalOverlay) hideModal();
    });
  }

  return {
    showModal,
    hideModal,
    showToast,
    initializeModalPrimitives,
  };
}

module.exports = {
  createModalPrimitives,
};
