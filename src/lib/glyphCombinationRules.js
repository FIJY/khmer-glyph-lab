import { CATEGORY_COLORS } from './khmerPositions.js';

/**
 * Центральный файл для правил по конкретным сочетаниям символов/глифов.
 *
 * Если нужно добавить особое поведение для конкретного сочетания,
 * начинайте с этого набора и функции `shouldSplitBaseForDependentVowel`.
 */
export const SPLIT_BASE_FOR_DEPENDENT_VOWELS = new Set([
  0x17be, // ើ
  0x17bf, // ឿ
  0x17c0, // ៀ
  0x17c4, // ោ
  0x17c5  // ៅ
]);

export function shouldSplitBaseForDependentVowel(char) {
  if (!char) return false;
  return SPLIT_BASE_FOR_DEPENDENT_VOWELS.has(char.codePointAt(0));
}

export function getColorForCategory(category) {
  return CATEGORY_COLORS[category] || '#111111';
}
