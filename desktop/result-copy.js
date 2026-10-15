export function setupResultCopy(statusSelector, actions) {
  const status = document.querySelector(statusSelector);
  const buttons = actions.map(([selector]) => document.querySelector(selector));
  let available = false;
  let version = 0;
  function setAvailable(value) {
    available = value;
    version++;
    status.textContent = '';
    status.classList.remove('error');
    buttons.forEach(button => { button.disabled = !value; });
  }
  actions.forEach(([_selector, getText], index) => {
    buttons[index].addEventListener('click', async () => {
      if (!available || buttons[index].disabled) return;
      const current = version;
      buttons.forEach(button => { button.disabled = true; });
      status.classList.remove('error');
      status.textContent = '복사하고 있어요…';
      try {
        const response = await window.resultTools.copy(getText());
        if (current !== version) return;
        status.textContent = response.ok ? '클립보드에 복사했어요.' : response.error;
        status.classList.toggle('error', !response.ok);
      } catch {
        if (current !== version) return;
        status.textContent = '클립보드에 복사하지 못했어요. 다시 시도해 주세요.';
        status.classList.add('error');
      } finally {
        if (current === version) {
          buttons.forEach(button => { button.disabled = !available; });
          status.scrollIntoView({ block: 'nearest' });
        }
      }
    });
  });
  setAvailable(false);
  return setAvailable;
}
