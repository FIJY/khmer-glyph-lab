import { CATEGORY_COLORS } from './khmerPositions.js';

/**
 * Центральный файл для правил по конкретным сочетаниям символов/глифов.
 */
export const SPLIT_BASE_FOR_DEPENDENT_VOWELS = new Set([
  0x17be, // ើ
  0x17bf, // ឿ
  0x17c0, // ៀ
  0x17c4, // ោ
  0x17c5  // ៅ
]);

/**
 * НОВОЕ: Специальные правила для комбинаций subscript + vowel
 *
 * Формат ключа: "subscript_text+vowel_codepoint"
 * Например: "្ប+6070" для комбинации ្ប + ា (U+17B6 = 6070)
 */
export const SUBSCRIPT_VOWEL_COMBINATIONS = {
  // Комбинация: subscript ្ប + vowel ា
  '្ប+6070': {
    splitMode: 'three-way',
    description: 'ក្បា pattern - base + subscript + vowel',
  },

  // Добавь другие проблемные комбинации здесь:
  // '្រ+6070': { splitMode: 'three-way', description: 'ត្រា pattern' },
};

export function shouldSplitBaseForDependentVowel(char) {
  if (!char) return false;
  return SPLIT_BASE_FOR_DEPENDENT_VOWELS.has(char.codePointAt(0));
}

/**
 * НОВОЕ: Проверяет есть ли специальное правило для комбинации
 */
export function getSubscriptVowelRule(subscriptText, vowelChar) {
  if (!subscriptText || !vowelChar) return null;

  const vowelCode = vowelChar.codePointAt(0);
  const key = `${subscriptText}+${vowelCode}`;

  return SUBSCRIPT_VOWEL_COMBINATIONS[key] || null;
}

export function getColorForCategory(category) {
  return CATEGORY_COLORS[category] || '#111111';
}

/**
 * Гласные нижнего положения, которые часто образуют лигатуру с базой
 * и требуют вертикального разделения (base сверху, vowel снизу)
 */
export const BELOW_SPLIT_VOWELS = new Set([
  0x17bb, // ុ U+17BB KHMER VOWEL SIGN UA
  0x17bc, // ូ U+17BC KHMER VOWEL SIGN UUA
  // При необходимости можно добавить другие редкие нижние гласные
]);