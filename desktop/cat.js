export const SIZE = 24;
export const CYCLE_MS = 4800;
export const EATING_MS = 1800;

const palette = {
  o: '#53382f',
  f: '#edaa55',
  l: '#ffd58b',
  s: '#cb773d',
  c: '#fff0ca',
  p: '#e78d88',
};

// Original 24px ByteCat artwork. Transparent cells stay transparent.
const head = [
  '.oo..........oo.',
  '.ofo........ofo.',
  '.opfoooooooofpo.',
  '.ofpllllllllpfo.',
  'offllssllssllffo',
  'ofllllllllllllfo',
  'ofllllllllllllfo',
  'ofllllllllllllfo',
  'ofllccccccccllfo',
  '.ofccccccccccfo.',
  '..ooffffffoo....',
];

function paintRows(ctx, rows, x, y) {
  rows.forEach((row, dy) => {
    [...row].forEach((pixel, dx) => {
      if (!palette[pixel]) return;
      ctx.fillStyle = palette[pixel];
      ctx.fillRect(x + dx, y + dy, 1, 1);
    });
  });
}

export function getIdlePose(elapsed) {
  const t = ((elapsed % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
  return {
    lift: t >= 1200 && t < 2400 ? -1 : 0,
    blink: (t >= 3200 && t < 3360) || (t >= 3520 && t < 3680),
    tail: [0, 1, 2, 3, 2, 1, 0, 0][Math.floor(t / 600)],
  };
}

export function drawCat(ctx, elapsed) {
  const pose = getIdlePose(elapsed);
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = '#33251f24';
  ctx.fillRect(4, 22, 17, 1);

  // Tail moves independently while paws remain planted.
  const tips = [[21, 15], [22, 14], [21, 13], [20, 14]];
  const [tx, ty] = tips[pose.tail];
  ctx.fillStyle = palette.o;
  ctx.fillRect(18, 19, 5, 3);
  ctx.fillRect(21, ty + 1, 2, 6);
  ctx.fillRect(tx, ty, 2, 2);
  ctx.fillStyle = palette.f;
  ctx.fillRect(18, 20, 4, 1);
  ctx.fillRect(21, ty + 2, 1, 6);

  paintRows(ctx, [
    '...oooooooo...',
    '..offfffffoo..',
    '.offfcccfffoo.',
    '.offccccfffoo.',
    '.osfccccffsfo.',
    '.offccccfffoo.',
    '.offccccfffoo.',
    'oofffcooffffoo',
    'occccoocccccco',
    '.oooo..oooooo.',
  ], 5, 13);

  paintRows(ctx, head, 4, 3 + pose.lift);
  ctx.fillStyle = palette.o;
  ctx.fillRect(8, 9 + pose.lift, 2, pose.blink ? 1 : 2);
  ctx.fillRect(15, 9 + pose.lift, 2, pose.blink ? 1 : 2);
  if (!pose.blink) {
    ctx.fillStyle = '#fff8e9';
    ctx.fillRect(8, 9 + pose.lift, 1, 1);
    ctx.fillRect(15, 9 + pose.lift, 1, 1);
  }
  ctx.fillStyle = palette.p;
  ctx.fillRect(12, 11 + pose.lift, 1, 1);
  ctx.fillStyle = palette.o;
  ctx.fillRect(11, 12 + pose.lift, 1, 1);
  ctx.fillRect(13, 12 + pose.lift, 1, 1);
  ctx.fillStyle = '#459b8f';
  ctx.fillRect(8, 14, 9, 1);
  ctx.fillStyle = '#ffe293';
  ctx.fillRect(12, 15, 2, 2);
}

export function drawEatingCat(ctx, elapsed) {
  drawCat(ctx, 0);
  const chewing = elapsed >= 400 && elapsed < 1350;
  const mouthHeight = chewing ? 1 + Math.floor(elapsed / 150) % 2 : 1;
  // Cover the idle mouth, then chew with lifted paws and pink cheeks.
  ctx.fillStyle = palette.c;
  ctx.fillRect(10, 12, 5, 2);
  ctx.fillStyle = palette.o;
  ctx.fillRect(11, 12, 3, mouthHeight);
  ctx.fillStyle = palette.p;
  ctx.fillRect(7, 11, 2, 1);
  ctx.fillRect(16, 11, 2, 1);
  if (elapsed < 1350) {
    ctx.fillStyle = palette.l;
    ctx.fillRect(9, 14, 2, 2);
    ctx.fillRect(14, 14, 2, 2);
    ctx.fillStyle = '#459b8f';
    const x = elapsed < 400 ? 18 - Math.floor(elapsed / 80) : 12;
    ctx.fillRect(x, 13, chewing ? 1 : 3, 2);
  } else {
    // A small heart marks successful feeding before returning to idle.
    ctx.fillStyle = palette.p;
    paintRows(ctx, ['p.p', 'ppp', '.p.'], 19, 3);
    ctx.fillStyle = palette.o;
    ctx.fillRect(11, 12, 1, 1);
    ctx.fillRect(13, 12, 1, 1);
    ctx.fillRect(12, 13, 1, 1);
  }
}
