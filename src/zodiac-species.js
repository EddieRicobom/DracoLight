export const ZODIAC_ANIMALS = Object.freeze([
  { id: 'rat', label: 'Rato' },
  { id: 'ox', label: 'Boi' },
  { id: 'tiger', label: 'Tigre' },
  { id: 'rabbit', label: 'Coelho' },
  { id: 'snake', label: 'Serpente' },
  { id: 'horse', label: 'Cavalo' },
  { id: 'goat', label: 'Cabra' },
  { id: 'monkey', label: 'Macaco' },
  { id: 'rooster', label: 'Galo' },
  { id: 'dog', label: 'Cão' },
  { id: 'pig', label: 'Porco' },
].map(Object.freeze));

const SPECIES_IDS = new Set(ZODIAC_ANIMALS.map(({ id }) => id));

export function isZodiacSpecies(id) {
  return SPECIES_IDS.has(id);
}
