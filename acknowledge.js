(function () {
  function clickAcknowledge() {
    const btn = document.querySelector('button.action-acknowledge');
    if (btn) {
      btn.click();
      observer.disconnect();
    }
  }

  const observer = new MutationObserver(clickAcknowledge);
  observer.observe(document.body, { childList: true, subtree: true });

  // Also try immediately in case the DOM is already ready
  clickAcknowledge();
})();