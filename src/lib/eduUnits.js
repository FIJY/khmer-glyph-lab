import {
  getKhmerGlyphCategory,
  isKhmerConsonantChar,
  isKhmerDependentVowel,
  isKhmerDiacriticOrSign
} from './khmerClassifier.js';

function splitTokenToAtoms(token, tokenStart = 0) {
  const chars = Array.from(token);
  const units = [];
  let localOffset = 0;

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const category = getKhmerGlyphCategory(ch, chars[i - 1]);

    if (category === 'coeng' && chars[i + 1] && isKhmerConsonantChar(chars[i + 1])) {
      const combined = ch + chars[i + 1];
      const combinedStart = tokenStart + localOffset;
      const combinedLen = ch.length + chars[i + 1].length;

      units.push({
        text: combined,
        chars: Array.from(combined),
        codePoints: Array.from(combined).map((c) => c.codePointAt(0)),
        category: 'subscript_consonant',
        sourceStart: combinedStart,
        sourceEnd: combinedStart + combinedLen
      });

      localOffset += combinedLen;
      i += 1;
      continue;
    }

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

function isUnitMatchGlyph(unit, glyph) {
  const unitCodePoints = new Set(unit.codePoints);
  const glyphCodePoints = glyph.codePoints || [];
  const codePointHit = glyphCodePoints.some((cp) => unitCodePoints.has(cp));
  const clusterTextHit = (glyph.clusterText || '').includes(unit.text);
  return codePointHit || clusterTextHit;
}

export function mapEduUnitsToGlyphs(glyphs, units) {
  const links = [];
  const glyphHitCount = new Map();

  units.forEach((unit) => {
    glyphs.forEach((glyph) => {
      if (isUnitMatchGlyph(unit, glyph)) {
        const key = `${glyph.id}`;
        glyphHitCount.set(key, (glyphHitCount.get(key) || 0) + 1);
        links.push({ unitId: unit.id, glyphId: glyph.id, sharedGlyph: false, cluster: glyph.cluster });
      }
    });
  });

  return links.map((link) => ({
    ...link,
    sharedGlyph: (glyphHitCount.get(String(link.glyphId)) || 0) > 1
  }));
}
