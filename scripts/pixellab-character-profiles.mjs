// Art-generation profiles only; these do not change the shipped pet catalog.
export const profiles = {
  marmalade: { name: '마멀레이드', kind: '치즈 고양이', catalogId: 'cat-cheese', species: 'kitten', seed: 117 },
  tuxedo: {
    name: '오레오', kind: '턱시도 고양이', catalogId: 'cat-tuxedo', species: 'kitten', seed: 201,
    description: 'One adorable black and white tuxedo kitten desktop pet. Round cheeky face, black cap and ears, a WHITE inverted V muzzle blaze, white chest bib and four white sock paws, emerald bead eyes, a little coral red bow tie. Compact pear-shaped body and a long black tail with white tip curled beside it. Clearly a tuxedo cat, with strong large black and white patches.',
    identity: 'black coat, white muzzle blaze and chest bib, white socks, coral red bow tie',
    // Keep the generated landing pose and the eye-opening frame; drop one
    // repeated closed-eye pose so the 8-cell loop closes smoothly.
    frameOrder: { idle: [0, 1, 2, 3, 4, 5, 7, 8] },
  },
  midnight: {
    name: '루나', kind: '까망 고양이', catalogId: 'cat-black', species: 'kitten', seed: 211,
    description: 'One adorable all-black kitten desktop pet. Rounded face with slightly taller pointed ears, glowing amber gold bead eyes, tiny pink nose. Solid charcoal fur with soft indigo highlights, no white patches. Small lavender triangular neckerchief. Petite compact body, elegant long tail curved into a hook beside it. A curious little midnight cat with a distinct mischievous expression.',
    identity: 'solid charcoal fur, indigo highlights, amber eyes, pink nose and lavender neckerchief',
  },
  shiba: {
    name: '모찌', kind: '시바', catalogId: 'dog-shiba', species: 'Shiba Inu puppy', seed: 221,
    description: 'One adorable Shiba Inu puppy desktop pet. Broad round smiling cheeky face, short upright triangular ears, cinnamon orange fur, cream cheeks and belly, tiny cream eyebrow dots, small black nose and dark bead eyes. Stocky compact body with neat paws, a clearly visible tightly curled ring tail over its rump. Small moss green bandana. Dog muzzle and Shiba proportions, not a cat.',
    identity: 'cinnamon orange coat, cream cheeks and eyebrow dots, triangular ears, curled ring tail and moss green bandana',
  },
  retriever: {
    name: '허니', kind: '리트리버', catalogId: 'dog-retriever', species: 'golden retriever puppy', seed: 231,
    description: 'One adorable golden retriever puppy desktop pet. Soft floppy ears hanging down beside a broad rounded face, gentle dark bead eyes, rounded black nose and a short wide dog muzzle. Honey golden fluffy fur with pale cream chest, chubby paws and a soft feathered tail beside it. Small sky blue bandana. Friendly slightly clumsy puppy with floppy ears, no pointy ears.',
    identity: 'honey golden fluffy coat, cream chest, broad muzzle, floppy ears, feathered tail and sky blue bandana',
  },
  corgi: {
    name: '비스킷', kind: '코기', catalogId: 'dog-corgi', species: 'Welsh corgi puppy', seed: 241,
    description: 'One adorable Welsh corgi puppy desktop pet. Very large upright rounded triangular ears, short stubby legs, a low long loaf-shaped body, a foxlike smiling dog muzzle. Toast orange coat, bold white forehead blaze running down to muzzle, white chest and short white sock paws. Tiny bobtail, dark bead eyes and black nose. Small burgundy neckerchief. Distinctive huge ears and short legs.',
    identity: 'toast orange coat, white forehead blaze and chest, huge upright ears, short legs, tiny bobtail and burgundy neckerchief',
    removeFloating: ['sleeping'],
  },
};

export const sharedStyle = 'Sitting comfortably, full body, front three-quarter view facing slightly right. Oversized rounded head and small appealing body. Chunky readable retro game pixel art matching a cozy desktop pet set, warm limited palette, flat two-tone shading, clean single-pixel dark outline, no dithering, no gradients, no text, no props, no ground shadow. Centered with transparent breathing room around the entire silhouette.';
