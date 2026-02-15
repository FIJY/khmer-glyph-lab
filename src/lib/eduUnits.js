import {
  getKhmerGlyphCategory,
  isKhmerConsonantChar,
  isKhmerDependentVowel,
  isKhmerDiacriticOrSign
} from './khmerClassifier.js';

function splitTokenToAtoms(token) {
  const chars = Array.from(token);
  const units = [];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const category = getKhmerGlyphCategory(ch, chars[i - 1]);

    if (category === 'coeng' && chars[i + 1] && isKhmerConsonantChar(chars[i + 1])) {
      const combined = ch + chars[i + 1];
      units.push({
        text: combined,
        chars: Array.from(combined),
        codePoints: Array.from(combined).map((c) => c.codePointAt(0)),
        category: 'subscript_consonant'
      });
      i += 1;
      continue;
    }

    if (isKhmerDependentVowel(ch)) {
      units.push({ text: ch, chars: [ch], codePoints: [ch.codePointAt(0)], category: 'dependent_vowel' });
      continue;
    }

    if (isKhmerDiacriticOrSign(ch)) {
      units.push({ text: ch, chars: [ch], codePoints: [ch.codePointAt(0)], category: 'diacritic_sign' });
      continue;
    }

    units.push({ text: ch, chars: [ch], codePoints: [ch.codePointAt(0)], category });
  }
  return units;
}

export function buildEduUnits(text, charSplit) {
  const source = Array.isArray(charSplit) && charSplit.length ? charSplit : [text || ''];
  const atoms = source.flatMap((token) => splitTokenToAtoms(token));
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
