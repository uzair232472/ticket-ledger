import prisma from '../config/prisma.js';

// The fixed event categories (Prisma EventType). Organizers can't add to or rename these; when none fits
// they add a custom category, stored separately (CustomCategory) and used with type OTHER.
export const PREDEFINED_CATEGORIES = [
  { type: 'CRICKET_MATCH', label: 'Cricket Match (PSL)', keywords: ['cricket', 'psl'] },
  { type: 'MUSIC_CONCERT', label: 'Music Concert', keywords: ['concert'] },
  { type: 'MUSIC_FESTIVAL', label: 'Music Festival', keywords: [] },
  { type: 'KABADDI', label: 'Kabaddi Match', keywords: ['kabaddi'] },
  { type: 'FOOTBALL_MATCH', label: 'Football Match', keywords: ['football', 'soccer', 'futsal'] },
  { type: 'BOXING', label: 'Boxing Match', keywords: ['boxing'] },
  { type: 'HOCKEY_MATCH', label: 'Hockey Match', keywords: ['hockey'] },
  { type: 'QAWWALI', label: 'Qawwali Night', keywords: ['qawwali'] },
  { type: 'THEATRE', label: 'Theatre', keywords: ['theatre', 'theater'] },
  { type: 'CONFERENCE', label: 'Conference', keywords: ['conference'] },
  { type: 'GENERAL_ADMISSION', label: 'General Admission', keywords: [] },
];

export class CategoryError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const words = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const FILLER = new Set(['match', 'matches', 'night', 'nights', 'event', 'events', 'show', 'shows', 'the', 'a', 'an']);
const core = (text) => words(text).filter((w) => !FILLER.has(w)).join(' ');
export const categorySlug = (name) => words(name).join('-');

/** The predefined category a proposed custom name duplicates, if any ("Cricket", "PSL final", "Music festival"). */
export function matchPredefined(name) {
  const proposed = core(name);
  const proposedWords = new Set(words(name));
  const containsPhrase = (phrase) => ` ${proposed} `.includes(` ${phrase} `);
  return PREDEFINED_CATEGORIES.find(
    (c) =>
      containsPhrase(core(c.label)) ||
      containsPhrase(core(c.label.replace(/\(.*\)/, ''))) ||
      c.type.toLowerCase().replace(/_/g, ' ') === words(name).join(' ') ||
      c.keywords.some((k) => proposedWords.has(k)),
  );
}

/** Checks a custom category name; returns the cleaned name or throws a 400 CategoryError. */
export function validateCategoryName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 3) throw new CategoryError(400, 'Category name must be at least 3 characters.');
  if (name.length > 40) throw new CategoryError(400, 'Category name must be at most 40 characters.');
  if (!/^[A-Za-z0-9][A-Za-z0-9 &'\-]*$/.test(name) || !/[A-Za-z]/.test(name)) {
    throw new CategoryError(400, 'Use letters, numbers, spaces, & \' and - only.');
  }
  const existing = matchPredefined(name);
  if (existing) {
    throw new CategoryError(
      400,
      `“${existing.label}” is already a category. Choose it from the list instead of adding a new one.`,
      { predefinedType: existing.type },
    );
  }
  return name;
}

export const listCategories = async () => ({
  predefined: PREDEFINED_CATEGORIES.map(({ type, label }) => ({ type, label })),
  custom: await prisma.customCategory.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true } }),
});

/** Adds a custom category, or returns the existing one with the same name. */
export async function addCustomCategory(rawName, userId) {
  const name = validateCategoryName(rawName);
  const slug = categorySlug(name);
  const existing = await prisma.customCategory.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } });
  if (existing) return { category: existing, created: false };
  try {
    const category = await prisma.customCategory.create({ data: { name, slug, createdById: userId }, select: { id: true, name: true, slug: true } });
    return { category, created: true };
  } catch (error) {
    // Two organizers adding the same name at once: the second one gets the first one's category
    if (error.code === 'P2002') {
      return { category: await prisma.customCategory.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } }), created: false };
    }
    throw error;
  }
}

/**
 * Event columns for a chosen category: a predefined type, or OTHER with the custom category's id and name.
 * Throws a 400 CategoryError when OTHER has no valid custom category.
 */
export async function categoryColumns(type, customCategoryId, db = prisma) {
  if (type !== 'OTHER') return { type, customCategoryId: null, categoryLabel: null };
  if (!customCategoryId) throw new CategoryError(400, 'Choose or add your category.', { field: 'type' });
  const category = await db.customCategory.findUnique({ where: { id: customCategoryId } });
  if (!category) throw new CategoryError(400, 'That category no longer exists. Choose or add it again.', { field: 'type' });
  return { type: 'OTHER', customCategoryId: category.id, categoryLabel: category.name };
}
