import {
  getKhmerGlyphCategory,
  isKhmerConsonantChar,
  isKhmerDependentVowel,
  isKhmerDiacriticOrSign
} from './khmerClassifier.js';

function splitTokenToAtoms(token, tokenStart = 0) {
  const chars = Array.from(token);
  const units = [];
  const COENG_CP = 0x17D2;
  let localOffset = 0;

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const chCp = ch.codePointAt(0);
    const prev = i > 0 ? chars[i - 1] : null;
    const prevCp = prev ? prev.codePointAt(0) : null;

    let category = getKhmerGlyphCategory(ch, prev);

    const isCoengMark = chCp === COENG_CP;

    // Special case: coeng mark + consonant => coeng + subscript_consonant
    if ((isCoengMark || category === 'coeng') && chars[i + 1] && isKhmerConsonantChar(chars[i + 1])) {
      const nextCh = chars[i + 1];
      units.push({
        text: ch,
        category: 'coeng',
        codePoints: [COENG_CP],
        sourceStart: tokenStart + localOffset,
        sourceEnd: tokenStart + localOffset + ch.length,
      });
      units.push({
        text: nextCh,
        category: 'subscript_consonant',
        codePoints: [nextCh.codePointAt(0)],
        sourceStart: tokenStart + localOffset + ch.length,
        sourceEnd: tokenStart + localOffset + ch.length + nextCh.length,
      });
      localOffset += ch.length + nextCh.length;
      i += 1;
      continue;
    }

    // Coeng mark without a following consonant (rare, but happens in dirty input):
    // keep it as a standalone "coeng" unit so it doesn't get misclassified as a diacritic.
    if (isCoengMark) {
      units.push({
        text: ch,
        category: 'coeng',
        codePoints: [COENG_CP],
        sourceStart: tokenStart + localOffset,
        sourceEnd: tokenStart + localOffset + ch.length,
      });
      localOffset += ch.length;
      continue;
    }

    // Normalize: U+17D2 is the only real "coeng" mark.
    // If something non-U+17D2 is tagged as "coeng", it's actually a consonant in subscript role.
    if (category === 'coeng' && isKhmerConsonantChar(ch)) category = 'subscript_consonant';
    if (prevCp === COENG_CP && isKhmerConsonantChar(ch)) category = 'subscript_consonant';

    const chStart = tokenStart + localOffset;
    const baseUnit = {
      text: ch,
      chars: [ch],
      codePoints: [ch.codePointAt(0)],
      sourceStart: chStart,
      sourceEnd: chStart + ch.length
    };

    if (isKhmerDependentVowel(ch)) {
      units.push({ ...baseUnit, category: 'dependent_vowel' });
      localOffset += ch.length;
      continue;
    }

    if (isKhmerDiacriticOrSign(ch)) {
      units.push({ ...baseUnit, category: 'diacritic_sign' });
      localOffset += ch.length;
      continue;
    }

    units.push({ ...baseUnit, category });
    localOffset += ch.length;
  }

  return units;
}

export function buildEduUnits(text, charSplit) {
  const sourceText = text || '';
  const source = Array.isArray(charSplit) && charSplit.length ? charSplit : [sourceText];

  let cursor = 0;
  const atoms = source.flatMap((token) => {
    const strToken = token || '';
    const foundAt = sourceText.indexOf(strToken, cursor);
    const tokenStart = foundAt >= 0 ? foundAt : cursor;
    const tokenUnits = splitTokenToAtoms(strToken, tokenStart);
    cursor = tokenStart + strToken.length;
    return tokenUnits;
  });

  return atoms.map((unit, index) => ({ ...unit, id: `edu-${index}` }));
}

