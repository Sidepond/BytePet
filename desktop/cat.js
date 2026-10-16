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

function paintRows(ctx, rows, x, y, colors = palette) {
  rows.forEach((row, dy) => {
    [...row].forEach((pixel, dx) => {
      if (!colors[pixel]) return;
      ctx.fillStyle = colors[pixel];
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

export function drawCat(ctx, elapsed, colors = palette, overrides = {}) {
  const pose = { ...getIdlePose(elapsed), ...overrides };
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = '#33251f24';
  ctx.fillRect(4, 22, 17, 1);

  // Tail moves independently while paws remain planted.
  const tips = [[21, 15], [22, 14], [21, 13], [20, 14]];
  const [tx, ty] = tips[pose.tail];
  ctx.fillStyle = colors.o;
  ctx.fillRect(18, 19, 5, 3);
  ctx.fillRect(21, ty + 1, 2, 6);
  ctx.fillRect(tx, ty, 2, 2);
  ctx.fillStyle = colors.f;
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
  ], 5, 13, colors);

  paintRows(ctx, head, 4, 3 + pose.lift, colors);
  ctx.fillStyle = colors.eye ?? colors.o;
  ctx.fillRect(8, 9 + pose.lift, 2, pose.blink ? 1 : 2);
  ctx.fillRect(15, 9 + pose.lift, 2, pose.blink ? 1 : 2);
  if (!pose.blink) {
    ctx.fillStyle = '#fff8e9';
    ctx.fillRect(8, 9 + pose.lift, 1, 1);
    ctx.fillRect(15, 9 + pose.lift, 1, 1);
  }
  ctx.fillStyle = colors.p;
  ctx.fillRect(12, 11 + pose.lift, 1, 1);
  ctx.fillStyle = colors.o;
  ctx.fillRect(11, 12 + pose.lift, 1, 1);
  ctx.fillRect(13, 12 + pose.lift, 1, 1);
  ctx.fillStyle = '#459b8f';
  ctx.fillRect(8, 14, 9, 1);
  ctx.fillStyle = '#ffe293';
  ctx.fillRect(12, 15, 2, 2);
}

export function drawRestingCat(ctx, state, elapsed, colors = palette) {
  if (state === 'sleeping') {
    drawCat(ctx, 0, colors, { blink: true, lift: elapsed < 300 ? 1 : 2 });
    return;
  }
  const stretching = state === 'stretching';
  const active = elapsed >= 400 && elapsed < (stretching ? 2700 : 4200);
  drawCat(ctx, 0, colors, { blink: active, lift: stretching && active ? -1 : 0 });
  if (!active) return;
  if (stretching) {
    const raised = elapsed >= 800 && elapsed <= 2300;
    const arm = ['.oo.', 'occo', 'offo', ...Array(raised ? 8 : 3).fill('.ofo'), '.oo.'];
    paintRows(ctx, arm, 2, raised ? 5 : 11, colors);
    paintRows(ctx, arm, 19, raised ? 5 : 11, colors);
    ctx.fillStyle = colors.o;
    ctx.fillRect(12, 11, 2, 2);
  } else {
    // Lift a paw to the cheek, then rub in short strokes.
    const y = 10 + Math.floor(elapsed / 300) % 2;
    paintRows(ctx, ['.oo.', 'occo', 'offo', 'offo', 'offo', '.oo.'], 7, y, colors);
    ctx.fillStyle = colors.p;
    if (Math.floor(elapsed / 600) % 2) ctx.fillRect(11, 12, 1, 2);
  }
}

export function drawEatingCat(ctx, elapsed, colors = palette) {
  drawCat(ctx, 0, colors);
  const chewing = elapsed >= 400 && elapsed < 1350;
  const mouthHeight = chewing ? 1 + Math.floor(elapsed / 150) % 2 : 1;
  // Cover the idle mouth, then chew with lifted paws and pink cheeks.
  ctx.fillStyle = colors.c;
  ctx.fillRect(10, 12, 5, 2);
  ctx.fillStyle = colors.o;
  ctx.fillRect(11, 12, 3, mouthHeight);
  ctx.fillStyle = colors.p;
  ctx.fillRect(7, 11, 2, 1);
  ctx.fillRect(16, 11, 2, 1);
  if (elapsed < 1350) {
    ctx.fillStyle = colors.l;
    ctx.fillRect(9, 14, 2, 2);
    ctx.fillRect(14, 14, 2, 2);
    ctx.fillStyle = '#459b8f';
    const x = elapsed < 400 ? 18 - Math.floor(elapsed / 80) : 12;
    ctx.fillRect(x, 13, chewing ? 1 : 3, 2);
  } else {
    // A small heart marks successful feeding before returning to idle.
    ctx.fillStyle = colors.p;
    paintRows(ctx, ['p.p', 'ppp', '.p.'], 19, 3, colors);
    ctx.fillStyle = colors.o;
    ctx.fillRect(11, 12, 1, 1);
    ctx.fillRect(13, 12, 1, 1);
    ctx.fillRect(12, 13, 1, 1);
  }
}

export function drawResultCat(ctx, state, elapsed, colors = palette) {
  if (state === 'success') {
    drawEatingCat(ctx, 1500, colors);
    ctx.fillStyle = '#459b8f';
    const y = Math.floor(elapsed / 200) % 2 ? 4 : 5;
    ctx.fillRect(2, y, 1, 3);
    ctx.fillRect(1, y + 1, 3, 1);
    return;
  }
  drawCat(ctx, 0, colors);
  // Raised eyebrows, a small round mouth, and a blue question mark.
  ctx.fillStyle = colors.o;
  ctx.fillRect(8, 7, 2, 1);
  ctx.fillRect(15, 8, 2, 1);
  ctx.fillStyle = colors.c;
  ctx.fillRect(10, 12, 5, 2);
  ctx.fillStyle = colors.o;
  ctx.fillRect(12, 12, 2, 2);
  ctx.fillStyle = '#6a99b4';
  const y = Math.floor(elapsed / 250) % 2 ? 1 : 2;
  ctx.fillRect(20, y, 3, 1);
  ctx.fillRect(22, y + 1, 1, 1);
  ctx.fillRect(21, y + 2, 1, 1);
  ctx.fillRect(21, y + 4, 1, 1);
}

export function drawAttackCat(ctx, elapsed, colors = palette) {
  drawCat(ctx, 0, colors);
  const extended = Math.floor(elapsed / 130) % 4 >= 1;
  // Lift the right paw, then swipe outwards with a small impact spark.
  paintRows(ctx, extended ? ['ooooo', 'offfo', 'occco', '.ooo.'] : ['ooo', 'ofo', 'oco', 'ooo'], extended ? 17 : 15, 13, colors);
  ctx.fillStyle = colors.o;
  ctx.fillRect(8, 8, 2, 1);
  ctx.fillRect(15, 8, 2, 1);
  if (extended) {
    ctx.fillStyle = '#ffe293';
    ctx.fillRect(22, 10, 1, 3);
    ctx.fillRect(21, 11, 3, 1);
  }
}
