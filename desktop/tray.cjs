const { Menu, Tray, nativeImage } = require('electron');

function createTrayIcon() {
  // A monochrome pixel cat, with transparent eyes and padding. Supply both
  // densities so the menu bar stays crisp on standard and Retina displays.
  const rows = [
    '................',
    '..##........##..',
    '..###......###..',
    '..####....####..',
    '..############..',
    '.##############.',
    '.##############.',
    '.###..####..###.',
    '.###..####..###.',
    '.##############.',
    '..#####..#####..',
    '..############..',
    '...##########...',
    '....########....',
    '................',
    '................',
  ];
  const icon = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const size = rows.length * scale;
    const bitmap = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (rows[Math.floor(y / scale)][Math.floor(x / scale)] === '#') bitmap[(y * size + x) * 4 + 3] = 255;
      }
    }
    const image = nativeImage.createFromBitmap(bitmap, { width: size, height: size });
    icon.addRepresentation({ scaleFactor: scale, buffer: image.toPNG() });
  }
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  return icon;
}

function createStatusTray(toggleVisibility) {
  const tray = new Tray(createTrayIcon());
  function refresh(hidden) {
    tray.setToolTip(hidden ? 'BytePet · 숨김' : 'BytePet');
    tray.setContextMenu(Menu.buildFromTemplate([
      { id: 'toggle-pet-visibility', label: hidden ? '다시 표시' : '잠시 숨기기', click: toggleVisibility },
      { type: 'separator' },
      { label: 'BytePet 종료', role: 'quit' },
    ]));
  }
  refresh(false);
  return { refresh, dispose() { tray.destroy(); } };
}

module.exports = { createStatusTray };
