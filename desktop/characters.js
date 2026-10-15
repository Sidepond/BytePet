import catalog from './character-catalog.js';
import { drawCat, drawEatingCat, drawResultCat, drawAttackCat } from './cat.js';
import { drawDog, drawEatingDog, drawResultDog, drawAttackDog } from './dog.js';

export const characters = catalog;
export const characterFor = id => characters.find(character => character.id === id) ?? characters[0];

export function drawCharacter(ctx, id, state = 'idle', elapsed = 0) {
  const character = characterFor(id);
  const dog = character.species === 'dog';
  const style = dog ? character : character.palette;
  if (state === 'eating') return (dog ? drawEatingDog : drawEatingCat)(ctx, elapsed, style);
  if (state === 'processing') return (dog ? drawEatingDog : drawEatingCat)(ctx, 400 + elapsed % 900, style);
  if (state === 'attack') return (dog ? drawAttackDog : drawAttackCat)(ctx, elapsed, style);
  if (state === 'success' || state === 'failure') return (dog ? drawResultDog : drawResultCat)(ctx, state, elapsed, style);
  return (dog ? drawDog : drawCat)(ctx, elapsed, style);
}
