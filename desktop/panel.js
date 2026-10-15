const draft = document.querySelector('#draft');
document.querySelector('#close').addEventListener('click', () => window.utilityPanel.close());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.isComposing) {
    event.preventDefault();
    window.utilityPanel.close();
  }
});
window.utilityPanel.onOpen(() => draft.focus({ preventScroll: true }));
