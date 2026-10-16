const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
function characterBounds(pet, appearance) {
  const center = appearance.ground && appearance.menuSide === 'left' ? pet.width - 64 : 64;
  return { x: pet.x + Math.max(0, Math.min(pet.width - 112, center - 56)), y: pet.y + pet.height - 125, width: 112, height: 112 };
}
function badgeBounds(pet, area, appearance, position = 'ground', visibleCharacter = null, rowCount = 2) {
  const frame = characterBounds(pet, appearance);
  if (position === 'ground') {
    // Center on the ground strip (bottom: 4px, height: 16px), independent of sprite alpha.
    const width = Math.max(1, Math.min(120, pet.width - 16, area.width));
    const height = Math.min(rowCount === 1 ? 16 : 24, area.height);
    const x = Math.max(pet.x + 8, Math.min(frame.x + (frame.width - width) / 2, pet.x + pet.width - 8 - width));
    return {
      x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(pet.y + pet.height - 12 - height / 2, area.y + area.height - height))),
      width, height, side: 'ground',
    };
  }
  const character = visibleCharacter ? { ...frame, y: pet.y + visibleCharacter.y, height: visibleCharacter.height } : frame;
  const width = Math.min(140, area.width), height = Math.min(rowCount === 1 ? 26 : 40, area.height), gap = 4;
  const candidates = {
    top: { x: character.x + (character.width - width) / 2, y: character.y - height - gap },
    left: { x: character.x - width - gap, y: character.y + (character.height - height) / 2 },
    right: { x: character.x + character.width + gap, y: character.y + (character.height - height) / 2 },
    bottom: { x: character.x + (character.width - width) / 2, y: character.y + character.height + gap },
  };
  const clamp = value => ({ x: Math.round(Math.max(area.x, Math.min(value.x, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(value.y, area.y + area.height - height))), width, height });
  const ordered = [position, ...Object.keys(candidates).filter(key => key !== position)];
  const fitting = ordered.find(key => {
    const r = candidates[key]; return r.x >= area.x && r.y >= area.y && r.x + width <= area.x + area.width && r.y + height <= area.y + area.height;
  });
  if (fitting) return { ...clamp(candidates[fitting]), side: fitting };
  const fitted = ordered.map(key => ({ ...clamp(candidates[key]), side: key }));
  fitted.sort((a, b) => overlap(a, character) - overlap(b, character));
  return fitted[0];
}
module.exports = { characterBounds, badgeBounds };
