const KHMER = {
  CONSONANT_START: 0x1780,
  CONSONANT_END: 0x17a2,
  INDEPENDENT_VOWEL_START: 0x17a3,
  INDEPENDENT_VOWEL_END: 0x17b3,
  DEPENDENT_VOWEL_START: 0x17b6,
  DEPENDENT_VOWEL_END: 0x17c5,
  COENG: 0x17d2,
  DIACRITIC_RANGES: [
    [0x17c6, 0x17d3],
    [0x17dd, 0x17dd]
  ],
  NUMERAL_START: 0x17e0,
  NUMERAL_END: 0x17e9
};

const SERIES_O = new Set([0x1782, 0x1784, 0x1786, 0x1788, 0x178a, 0x178c, 0x178e, 0x1790, 0x1792, 0x1794, 0x1796, 0x1798, 0x179a, 0x179c, 0x179e, 0x17a0, 0x17a2]);

const cp = (char) => (char ? char.codePointAt(0) : -1);

export function isKhmerConsonantChar(char) {
  const codePoint = cp(char);
  return codePoint >= KHMER.CONSONANT_START && codePoint <= KHMER.CONSONANT_END;
}

export function isKhmerIndependentVowel(char) {
  const codePoint = cp(char);
  return codePoint >= KHMER.INDEPENDENT_VOWEL_START && codePoint <= KHMER.INDEPENDENT_VOWEL_END;
}

export function isKhmerDependentVowel(char) {
  const codePoint = cp(char);
  return codePoint >= KHMER.DEPENDENT_VOWEL_START && codePoint <= KHMER.DEPENDENT_VOWEL_END;
}

export function isKhmerDiacriticOrSign(char) {
  const codePoint = cp(char);
  return KHMER.DIACRITIC_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

export function getKhmerConsonantSeries(char) {
  if (!isKhmerConsonantChar(char)) {
    return null;
  }
  return SERIES_O.has(cp(char)) ? 'o_series' : 'a_series';
}

export function getKhmerGlyphCategory(char, prevChar = '') {
  const codePoint = cp(char);
  if (isKhmerConsonantChar(char)) {
    return prevChar && cp(prevChar) === KHMER.COENG ? 'subscript_consonant' : 'base_consonant';
  }
  if (isKhmerIndependentVowel(char)) {
    return 'independent_vowel';
  }
  if (isKhmerDependentVowel(char)) {
    return 'dependent_vowel';
  }
  if (codePoint === KHMER.COENG) {
    return 'coeng';
  }
  if (isKhmerDiacriticOrSign(char)) {
    return 'diacritic_sign';
  }
  if (codePoint >= KHMER.NUMERAL_START && codePoint <= KHMER.NUMERAL_END) {
    return 'numeral';
  }
  return 'other';
}
