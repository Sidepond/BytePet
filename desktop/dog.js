import { getIdlePose } from './cat.js';

function rows(ctx, pixels, x, y, palette) {
  pixels.forEach((row, dy) => [...row].forEach((cell, dx) => {
    if (!palette[cell]) return;
    ctx.fillStyle = palette[cell];
    ctx.fillRect(x + dx, y + dy, 1, 1);
  }));
}

export function drawDog(ctx, elapsed, { shape, palette: p }) {
  const pose = getIdlePose(elapsed);
  ctx.clearRect(0, 0, 24, 24);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#33251f24';
  ctx.fillRect(4, 22, 17, 1);
  const tailLift = pose.tail % 2;
  if (shape === 'shiba') {
    rows(ctx, ['.oooo', 'offfo', 'of.oo', 'of...', 'oo...'], 18, 15 - tailLift, p);
  } else if (shape === 'retriever') {
    rows(ctx, ['..oo', '.off', 'offo', 'ofo.', 'oo..'], 18, 15 - tailLift, p);
  } else {
    rows(ctx, ['oo.', 'ofo', 'oo.'], 19, 18 - tailLift, p);
  }
  const body = shape === 'corgi' ? [
    '.oooooooooooo.', 'offfccccfffffo', 'offfccccfffffo', 'occccoooocccco', '.oooo....oooo.',
  ] : [
    '..oooooooo..', '.offccccffo.', 'offfccccfffo', 'offfccccfffo',
    'offfccccfffo', 'offfccccfffo', 'occccoocccco', '.oooo..oooo.',
  ];
  rows(ctx, body, shape === 'corgi' ? 5 : 6, shape === 'corgi' ? 18 : 15, p);
  const lift = pose.lift;
  if (shape === 'retriever') {
    rows(ctx, ['.ooo', 'osso', 'osso', 'osso', 'osso', 'osso', '.oo.'], 2, 7 + lift, p);
    rows(ctx, ['ooo.', 'osso', 'osso', 'osso', 'osso', 'osso', '.oo.'], 18, 7 + lift, p);
  } else {
    const ears = shape === 'corgi' ? ['oo...', 'ofo..', 'opfo.', 'oppfo', 'offfo', '.ooo.'] : ['oo..', 'ofo.', 'opfo', 'offo'];
    rows(ctx, ears, shape === 'corgi' ? 3 : 5, (shape === 'corgi' ? 2 : 3) + lift, p);
    rows(ctx, ears.map(row => [...row].reverse().join('')), shape === 'corgi' ? 16 : 15, (shape === 'corgi' ? 2 : 3) + lift, p);
  }
  rows(ctx, [
    '..oooooooooooo..', '.offffffffffffo.',
    'offllllllllllffo', 'offllllllllllffo', 'offllllllllllffo',
    'offllccccccllffo', 'oflcccccccccclfo', '.ofcccoooccccfo.',
    '..ofccccccccfo..', '...oooffffooo...', '......oooo......',
  ], 4, 6 + lift, p);
  if (shape === 'corgi') {
    ctx.fillStyle = p.c;
    ctx.fillRect(11, 7 + lift, 2, 5);
  }
  ctx.fillStyle = p.o;
  ctx.fillRect(8, 10 + lift, 2, pose.blink ? 1 : 2);
  ctx.fillRect(15, 10 + lift, 2, pose.blink ? 1 : 2);
  if (!pose.blink) {
    ctx.fillStyle = '#fff8e9';
    ctx.fillRect(8, 10 + lift, 1, 1);
    ctx.fillRect(15, 10 + lift, 1, 1);
  }
  ctx.fillStyle = p.o;
  ctx.fillRect(11, 12 + lift, 3, 1);
  ctx.fillRect(12, 13 + lift, 1, 1);
  ctx.fillRect(11, 14 + lift, 1, 1);
  ctx.fillRect(13, 14 + lift, 1, 1);
  ctx.fillStyle = '#b65f60';
  ctx.fillRect(8, 16, 9, 1);
  ctx.fillStyle = '#ffe293';
  ctx.fillRect(12, 17, 2, 2);
}

export function drawEatingDog(ctx, elapsed, character) {
  drawDog(ctx, 0, character);
  const p = character.palette;
  ctx.fillStyle = p.c;
  ctx.fillRect(10, 14, 5, 2);
  ctx.fillStyle = p.o;
  ctx.fillRect(11, 14, 3, elapsed >= 400 && elapsed < 1350 ? 1 + Math.floor(elapsed / 150) % 2 : 1);
  if (elapsed < 1350) {
    ctx.fillStyle = p.l;
    ctx.fillRect(9, 16, 2, 2);
    ctx.fillRect(15, 16, 2, 2);
    ctx.fillStyle = '#b65f60';
    ctx.fillRect(elapsed < 400 ? 18 - Math.floor(elapsed / 80) : 12, 15, 2, 2);
  } else {
    rows(ctx, ['p.p', 'ppp', '.p.'], 20, 2, p);
    ctx.fillStyle = p.p;
    ctx.fillRect(12, 15, 1, 1);
  }
}

export function drawResultDog(ctx, state, elapsed, character) {
  if (state === 'success') return drawEatingDog(ctx, 1500, character);
  drawDog(ctx, 0, character);
  ctx.fillStyle = character.palette.o;
  ctx.fillRect(8, 8, 2, 1);
  ctx.fillRect(15, 9, 2, 1);
  ctx.fillStyle = '#6a99b4';
  const y = Math.floor(elapsed / 250) % 2 ? 1 : 2;
  ctx.fillRect(20, y, 3, 1);
  ctx.fillRect(22, y + 1, 1, 1);
  ctx.fillRect(21, y + 2, 1, 1);
  ctx.fillRect(21, y + 4, 1, 1);
}

export function drawAttackDog(ctx, elapsed, character) {
  drawDog(ctx, 0, character);
  const extended = Math.floor(elapsed / 130) % 4 >= 1;
  // A toy hammer swings from the raised paw; the feet remain planted.
  ctx.fillStyle = character.palette.l;
  ctx.fillRect(16, 17, 3, 2);
  ctx.fillStyle = '#87634d';
  ctx.fillRect(extended ? 20 : 18, extended ? 15 : 11, 1, 7);
  rows(ctx, ['ooooo', 'offfo', 'offfo', 'ooooo'], extended ? 18 : 16, extended ? 13 : 8,
    { o: '#794351', f: '#e69aa0' });
  if (extended) {
    ctx.fillStyle = '#ffe293';
    ctx.fillRect(22, 19, 1, 3);
    ctx.fillRect(21, 20, 3, 1);
  }
}
