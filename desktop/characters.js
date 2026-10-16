import catalog from './character-catalog.js';
import { drawCat, drawEatingCat, drawResultCat, drawAttackCat, drawRestingCat } from './cat.js';
import { drawDog, drawEatingDog, drawResultDog, drawAttackDog, drawRestingDog } from './dog.js';
import { drawSleeping } from './sleeping.js';
import { IDLE_DURATIONS } from './idle-behavior.js';
import manifest from './sprite-manifest.js';
import { drawSpriteCharacter } from './sprite-character.js';
export { charactersReady, CHARACTER_SIZE } from './sprite-character.js';

export const characters = catalog.map(character => ({ ...character, name: manifest[character.id].name, kind: character.name }));
export const characterFor = id => characters.find(character => character.id === id) ?? characters[0];

export function drawCharacter(ctx, id, state = 'idle', elapsed = 0) {
  const character = characterFor(id);
  if (drawSpriteCharacter(ctx, character.id, state, elapsed)) return;
  // A missing/corrupt local sheet must not make the pet impossible to click.
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  ctx.scale(ctx.canvas.width / 24, ctx.canvas.height / 24);
  drawLegacyCharacter(ctx, character.id, state, elapsed);
  ctx.restore();
}

export function drawLegacyCharacter(ctx, id, state = 'idle', elapsed = 0) {
  const character = characterFor(id);
  const dog = character.species === 'dog';
  const style = dog ? character : character.palette;
  if (Object.hasOwn(IDLE_DURATIONS, state)) {
    if (state === 'sleeping') {
      const edge = Math.min(elapsed, IDLE_DURATIONS.sleeping - elapsed);
      if (edge >= 600) return drawSleeping(ctx, elapsed - 600, character);
      if (edge < 100) return (dog ? drawDog : drawCat)(ctx, 0, style);
      return (dog ? drawRestingDog : drawRestingCat)(ctx, state, edge, style);
    }
    return (dog ? drawRestingDog : drawRestingCat)(ctx, state, elapsed, style);
  }
  if (state === 'eating') return (dog ? drawEatingDog : drawEatingCat)(ctx, elapsed, style);
  if (state === 'processing') return (dog ? drawEatingDog : drawEatingCat)(ctx, 400 + elapsed % 900, style);
  if (state === 'attack') return (dog ? drawAttackDog : drawAttackCat)(ctx, elapsed, style);
  if (state === 'success' || state === 'failure') return (dog ? drawResultDog : drawResultCat)(ctx, state, elapsed, style);
  return (dog ? drawDog : drawCat)(ctx, elapsed, style);
}

const idleAnchors = new Map();
export function characterIdleAnchor(id) {
  const character = characterFor(id);
  if (!idleAnchors.has(character.id)) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 48;
    const ctx = canvas.getContext('2d');
    drawCharacter(ctx, character.id, 'idle', 0);
    const pixels = ctx.getImageData(0, 0, 48, 48).data;
    let first = -1, last = -1;
    for (let i = 0; i < 48 * 48; i++) if (pixels[i * 4 + 3] > 0) {
      if (first < 0) first = i;
      last = i;
    }
    idleAnchors.set(character.id, first < 0 ? null : {
      top: Math.floor(first / 48) / 48, bottom: (Math.floor(last / 48) + 1) / 48,
    });
  }
  return idleAnchors.get(character.id);
}
