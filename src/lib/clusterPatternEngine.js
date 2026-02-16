/**
 * clusterPatternEngine.js
 * Pattern-based zoning for Khmer cluster mapping.
 *
 * Input: charMeta = [{ char, category, ... }]
 * Output:
 *  - detectClusterPattern(charMeta) -> patternId
 *  - buildZonePlan(charMeta, patternId) -> [{ unitIndex, zone, priority }]
 *  - createZoneRects(bb, patternId) -> rects by zone
 */

function hasCat(charMeta, cat) {
  return charMeta.some((m) => m.category === cat);
}

function countCat(charMeta, cat) {
  return charMeta.filter((m) => m.category === cat).length;
}

function isPreVowelChar(ch) {
  // Leading/preposed dependent vowels commonly rendered before base
  // េ U+17C1, ែ U+17C2, ៃ U+17C3, ោ /ៅ are combinations but includes pre-sign parts
  const cp = ch?.codePointAt(0);
  return cp === 0x17C1 || cp === 0x17C2 || cp === 0x17C3 || cp === 0x17C4;
}

function unitZoneForCategory(unit) {
  const { category, char } = unit;
  if (category === 'diacritic_sign' || category === 'diacritic') return 'TOP';
  if (category === 'base_consonant' || category === 'independent_vowel') return 'MAIN';
  if (category === 'coeng' || category === 'subscript_consonant') return 'SUB';
  if (category === 'dependent_vowel') {
    if (isPreVowelChar(char)) return 'LEFT';
    return 'RIGHT';
  }
  return 'MAIN';
}

export function detectClusterPattern(charMeta) {
  const hasBase =
    hasCat(charMeta, 'base_consonant') || hasCat(charMeta, 'independent_vowel');
  const hasCoeng = hasCat(charMeta, 'coeng');
  const hasSub = hasCat(charMeta, 'subscript_consonant');
  const hasDep = hasCat(charMeta, 'dependent_vowel');
  const hasDia =
    hasCat(charMeta, 'diacritic_sign') || hasCat(charMeta, 'diacritic');
  const hasLeftDep = charMeta.some(
    (m) => m.category === 'dependent_vowel' && isPreVowelChar(m.char)
  );

  if (!hasBase) return 'UNKNOWN';

  if (hasLeftDep && hasCoeng && hasSub && hasDep && hasDia) return 'PRE+BASE+SUB+V+D';
  if (hasLeftDep && hasCoeng && hasSub && hasDep) return 'PRE+BASE+SUB+V';
  if (hasLeftDep && hasBase && hasDep && hasDia) return 'PRE+BASE+V+D';
  if (hasLeftDep && hasBase && hasDep) return 'PRE+BASE+V';
  if (hasLeftDep && hasBase) return 'PRE+BASE';

  if (hasCoeng && hasSub && hasDep && hasDia) return 'BASE+SUB+V+D';
  if (hasCoeng && hasSub && hasDep) return 'BASE+SUB+V';
  if (hasCoeng && hasSub && hasDia) return 'BASE+SUB+D';
  if (hasCoeng && hasSub) return 'BASE+SUB';

  if (hasBase && hasDep && hasDia) return 'BASE+V+D';
  if (hasBase && hasDep) return 'BASE+V';
  if (hasBase && hasDia) return 'BASE+D';
  if (hasBase) return 'BASE';

  return 'UNKNOWN';
}

export function buildZonePlan(charMeta, patternId) {
  // Keep order from source charMeta; assign zone per unit category.
  // priority can be used for click/hit decisions later if needed.
  return charMeta.map((unit, idx) => {
    const zone = unitZoneForCategory(unit);

    let priority = 1;
    if (zone === 'TOP') priority = 5;
    else if (zone === 'LEFT') priority = 4;
    else if (zone === 'RIGHT') priority = 3;
    else if (zone === 'SUB') priority = 2;
    else if (zone === 'MAIN') priority = 1;

    return {
      unitIndex: idx,
      zone,
      priority,
      patternId,
    };
  });
}

export function createZoneRects(bb, patternId) {
  const x = bb?.x1 || 0;
  const y = bb?.y1 || 0;
  const w = Math.max(0, (bb?.x2 || 0) - (bb?.x1 || 0));
  const h = Math.max(0, (bb?.y2 || 0) - (bb?.y1 || 0));

  if (w <= 0 || h <= 0) {
    return {
      TOP: null,
      LEFT: null,
      MAIN: null,
      SUB: null,
      RIGHT: null,
      FULL: null,
    };
  }

  // Stable default proportions (safe)
  // Works much better than per-word hacks.
  const topH = Math.max(20, h * 0.20);
  const subH = Math.max(24, h * 0.30);
  const midH = Math.max(20, h - topH - subH);

  const leftW = Math.max(18, w * 0.28);
  const rightW = Math.max(18, w * 0.30);
  const mainW = Math.max(20, w - leftW - rightW);

  const yTop = y;
  const yMid = y + topH;
  const ySub = y + topH + midH;

  const xLeft = x;
  const xMain = x + leftW;
  const xRight = x + leftW + mainW;

  // For patterns without LEFT/RIGHT/SUB, unused zones are still defined;
  // mapper may ignore as needed.
  const rects = {
    TOP: { x, y: yTop, width: w, height: topH },
    LEFT: { x: xLeft, y: yMid, width: leftW, height: midH },
    MAIN: { x: xMain, y: yMid, width: mainW, height: midH },
    SUB: { x, y: ySub, width: w, height: subH },
    RIGHT: { x: xRight, y: yMid, width: rightW, height: midH },
    FULL: { x, y, width: w, height: h },
  };

  // Pattern-specific small tweaks (conservative)
  if (patternId === 'BASE' || patternId === 'BASE+D') {
    rects.MAIN = { ...rects.FULL };
  }
  if (patternId === 'BASE+SUB' || patternId === 'BASE+SUB+D') {
    rects.RIGHT = null;
  }

  return rects;
}
