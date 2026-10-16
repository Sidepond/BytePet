// Original lying-down poses share the same 24px canvas and ground line as idle.
export function drawSleeping(ctx, elapsed, { species, shape, palette: p }) {
  ctx.clearRect(0, 0, 24, 24);
  ctx.imageSmoothingEnabled = false;
  const rows = (pixels, x, y) => pixels.forEach((row, dy) => [...row].forEach((cell, dx) => {
    if (!p[cell]) return;
    ctx.fillStyle = p[cell];
    ctx.fillRect(x + dx, y + dy, 1, 1);
  }));
  const breath = Math.floor(elapsed / 1400) % 2;
  ctx.fillStyle = '#33251f24';
  ctx.fillRect(2, 22, 21, 1);
  rows([
    '....oooooooo...', '...offffffffoo.', '..offfffffffffo',
    '.offffllllfffffo', 'offfllllllffffo', 'offccccccccfffo',
    '.ooooooooooooo.',
  ], 8, 16 - breath);
  // Ears preserve each dog's silhouette, even when curled up.
  if (species === 'cat') {
    rows(['oo......oo', 'ofo....ofo', 'opfoooofpo'], 3, 11);
  } else if (shape === 'retriever') {
    rows(['.ooo', 'osso', 'osso', 'osso', '.oo.'], 1, 15);
    rows(['ooo.', 'osso', 'osso', 'osso', '.oo.'], 12, 15);
  } else {
    const ears = shape === 'corgi' ? ['oo..', 'ofo.', 'opfo', 'offo'] : ['oo..', 'opoo', 'offo'];
    rows(ears, 3, shape === 'corgi' ? 10 : 11);
    rows(ears.map(row => [...row].reverse().join('')), 10, shape === 'corgi' ? 10 : 11);
  }
  rows([
    '..oooooooo..', '.offllllffo.', 'offllllllffo', 'ofllccccllfo',
    'ofccccccccfo', '.offccccffo.', '..oooooooo..',
  ], 2, 14);
  ctx.fillStyle = p.o;
  ctx.fillRect(5, 17, 2, 1);
  ctx.fillRect(10, 17, 2, 1);
  ctx.fillStyle = species === 'cat' ? p.p : p.o;
  ctx.fillRect(8, 18, species === 'cat' ? 1 : 2, 1);
  rows(['.oooo..oooo.', 'occccoocccco', '.oooo..oooo.'], 3, 20);
  if (species === 'cat') {
    rows(['...ooooooo', '..offffffo', '...oooooo.'], 13, 19);
  } else if (shape === 'shiba') {
    rows(['.oooo', 'offfo', 'of.oo', '.oo..'], 18, 17);
  } else if (shape === 'retriever') {
    rows(['..ooo', '.offo', 'offo.', '.oo..'], 18, 18);
  } else {
    rows(['.oo', 'ofo', '.oo'], 20, 19);
  }
  // Small pixel Zs rise slowly above the sleeping pet.
  const y = 7 - Math.floor(elapsed / 1100) % 3;
  ctx.fillStyle = '#6a99b4';
  for (const [x, dy] of [[16, 0], [20, -3]]) {
    ctx.fillRect(x, y + dy, 3, 1);
    ctx.fillRect(x + 1, y + dy + 1, 1, 1);
    ctx.fillRect(x, y + dy + 2, 3, 1);
  }
}
