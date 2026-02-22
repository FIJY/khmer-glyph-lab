import { CATEGORY_COLORS } from './khmerPositions.js';
import { getKhmerConsonantSeries } from './khmerClassifier.js';

// Правила для разделения базы и гласной
export const SPLIT_BASE_FOR_DEPENDENT_VOWELS = new Set([
  0x17be, // ើ
  0x17bf, // ឿ
  0x17c0, // ៀ
  0x17c4, // ោ
  0x17c5  // ៅ
]);

// Специальные правила для комбинаций
export const SUBSCRIPT_VOWEL_COMBINATIONS = {
  '្ប+6070': {
    splitMode: 'three-way',
    description: 'ក្បា pattern - base + subscript + vowel',
  },
};

export function shouldSplitBaseForDependentVowel(char) {
  if (!char) return false;
  return SPLIT_BASE_FOR_DEPENDENT_VOWELS.has(char.codePointAt(0));
}

export function getSubscriptVowelRule(subscriptText, vowelChar) {
  if (!subscriptText || !vowelChar) return null;
  const vowelCode = vowelChar.codePointAt(0);
  const key = `${subscriptText}+${vowelCode}`;
  return SUBSCRIPT_VOWEL_COMBINATIONS[key] || null;
}

/**
 * НОВАЯ ЛОГИКА ЦВЕТОВ
 * Согласные 1-го типа (A-series): Оранжевый (Base), Желтый (Sub)
 * Согласные 2-го типа (O-series): Фиолетовый (Base), Синий (Sub)
 */
export function getColorForCategory(category, char) {
  // 1. Согласные (Базовые и Подписные)
  if (category === 'base_consonant' || category === 'subscript_consonant') {
    const series = getKhmerConsonantSeries(char);

    if (series === 'a_series') {
      // ПЕРВЫЙ ТИП (A-series)
      return category === 'subscript_consonant'
        ? '#facc15'  // Желтый (подписная)
        : '#f97316'; // Оранжевый (база)
    } else {
      // ВТОРОЙ ТИП (O-series)
      return category === 'subscript_consonant'
        ? '#3b82f6'  // Синий (подписная)
        : '#a855f7'; // Фиолетовый (база)
    }
  }

  // 2. Гласные
  if (category === 'dependent_vowel' || category === 'independent_vowel') {
    return '#ef4444'; // Красный
  }

  // 3. Диакритики
  if (category === 'diacritic_sign' || category === 'diacritic') {
    return '#facc15'; // Желтый (совпадает с A-sub)
  }

  // 4. Цифры
  if (category === 'numeral') {
    return '#22c55e'; // Зеленый
  }

  // 5. Остальное (дефолтный цвет)
  return '#9ca3af'; // Серый
}

export function getStrokeForCategory(category, char) {
  if (category === 'base_consonant' || category === 'subscript_consonant') {
    const series = getKhmerConsonantSeries(char);
    return series === 'a_series' ? '#16a34a' : '#dc2626';
  }

  if (category === 'dependent_vowel' || category === 'independent_vowel') {
    return '#dc2626';
  }

  if (category === 'diacritic_sign' || category === 'diacritic' || category === 'coeng' || category === 'numeral') {
    return '#16a34a';
  }

  return '#6b7280';
}

export const BELOW_SPLIT_VOWELS = new Set([
  0x17bb, // ុ
  0x17bc, // ូ
]);
