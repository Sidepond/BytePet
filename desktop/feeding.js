export function resultMessage(result) {
  if (!result.ok) return result.error;
  const { items, errors } = result.value;
  const saved = items.length ? `${items.length}개를 보관함에 저장했어요.` : '';
  return [saved, ...errors].filter(Boolean).join(' ');
}

export function enableFoodDrop(target, consume, accepts = () => true) {
  let depth = 0;
  target.addEventListener('dragenter', event => {
    if (!accepts(event)) return;
    event.preventDefault();
    depth++;
    target.classList.add('food-over');
  });
  target.addEventListener('dragover', event => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  target.addEventListener('dragleave', () => {
    if (--depth <= 0) { depth = 0; target.classList.remove('food-over'); }
  });
  target.addEventListener('drop', event => {
    event.preventDefault(); // Never navigate to a dropped file or URL.
    depth = 0;
    target.classList.remove('food-over');
    if (!accepts(event)) return;
    // Read DataTransfer synchronously: its contents expire after this event.
    const files = Array.from(event.dataTransfer.files);
    const text = event.dataTransfer.getData('text/plain');
    consume(() => files.length ? window.food.saveFiles(files) : window.food.saveText(text));
  });
}
