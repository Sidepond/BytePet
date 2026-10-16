import manifest from './sprite-manifest.js';

// The PNGs are exact 2× copies of 48px pixel art. Draw at logical resolution;
// the pet displays it at 112px and settings at 48px with nearest-pixel scaling.
export const CHARACTER_SIZE = 48;
export const LANDING_MS = 300;
const sheets = new Map();

export function frameAt(durations, elapsed) {
  const cycle = durations.reduce((total, duration) => total + duration, 0);
  let time = (Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0) % cycle;
  for (let index = 0; index < durations.length; index++) {
    if (time < durations[index]) return index;
    time -= durations[index];
  }
  return 0;
}

async function loadSheet(key, file) {
  const image = new Image();
  image.src = new URL(file, import.meta.url).href;
  try {
    await image.decode();
    if (image.naturalWidth !== 384 || image.naturalHeight !== 192) throw new Error('Invalid sprite dimensions');
    sheets.set(key, image);
  } catch {
    console.warn(`BytePet: could not load character sheet ${key}; using fallback artwork.`);
  }
}

// Preload once per renderer. Selection and reactions are synchronous afterwards,
// so a slow image cannot replace a more recently selected character.
export const charactersReady = typeof Image === 'undefined' ? Promise.resolve() : Promise.all(
  Object.entries(manifest).flatMap(([id, character]) => Object.entries(character.actions)
    .map(([action, { file }]) => loadSheet(`${id}/${action}`, file))),
);

const effects = {
  success: { color: '#e78d88', pixels: ['01010', '11111', '11111', '01110', '00100'] },
  failure: { color: '#c98654', pixels: ['010', '010', '010', '000', '010'] },
  attack: { color: '#e8b85c', pixels: ['00100', '00100', '11111', '00100', '00100'] },
};

export function drawSpriteCharacter(ctx, id, state, elapsed) {
  const requested = state === 'eating' || state === 'processing' ? 'eating' : ['sleeping', 'dragging'].includes(state) ? state : 'idle';
  const action = requested === 'dragging' && !sheets.has(`${id}/dragging`) ? 'idle' : requested;
  const image = sheets.get(`${id}/${action}`);
  if (!image) return false;
  const effect = effects[state];
  // Tool processing is brief; play the bite a little faster within that phase.
  const time = state === 'processing' ? elapsed * 2 : elapsed;
  const index = state === 'landing' ? 0 : frameAt(manifest[id].actions[action].durationMs, time);
  // A brief pixel-aligned drop and one-pixel settling motion, with no stretching.
  const offsetY = state === 'landing' ? [-4, -2, 0, 1, 0][Math.min(4, Math.floor(Math.max(0, elapsed) / (LANDING_MS / 5)))] : 0;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(ctx.canvas.width / CHARACTER_SIZE, ctx.canvas.height / CHARACTER_SIZE);
  ctx.drawImage(image, index % 4 * 96, Math.floor(index / 4) * 96, 96, 96, 0, offsetY, 48, 48);
  // Until dedicated reaction sheets are made, preserve the new silhouette and
  // show a small pixel cue above it. Never switch to the old pet mid-reaction.
  if (effect) {
    const y = 2 + (Math.floor(elapsed / 180) % 2);
    const x = Math.floor((48 - effect.pixels[0].length) / 2);
    ctx.fillStyle = effect.color;
    effect.pixels.forEach((row, dy) => [...row].forEach((pixel, dx) => {
      if (pixel === '1') ctx.fillRect(x + dx, y + dy, 1, 1);
    }));
  }
  ctx.restore();
  return true;
}
