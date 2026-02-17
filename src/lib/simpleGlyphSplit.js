import { getColorForCategory } from './glyphCombinationRules.js';
import {
  getConsonantBodyRect,
  computeZonesFromMetrics,
  isMetricsLoaded,
} from './khmerConsonantMetrics.js';

function clampRectToBbox(rect, bbox) {
  const x1 = Math.max(bbox.x1, rect.x);
  const y1 = Math.max(bbox.y1, rect.y);
  const x2 = Math.min(bbox.x2, rect.x + rect.width);
  const y2 = Math.min(bbox.y2, rect.y + rect.height);
  return {
    x: x1, y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  };
}

function findBaseCP(units) {
  const base = units.find(
    (u) => u.category === 'base_consonant' || u.category === 'independent_vowel'
  );
  return base?.codePoints?.[0] ?? null;
}

/**
 * Нарезать bbox кластера на топологические зоны.
 *
 * Если метрики загружены — используем реальные bbox из /api/metrics.
 * Иначе — heuristic fallback через пропорции от тела базовой согласной.
 *
 * bbox здесь в формате { x1, y1, x2, y2 }.
 *
 * @param {{ x1, y1, x2, y2 }} bbox
 * @param {Array} units — edu-units (с полями category, codePoints, text)
 * @param {number|null} [baseCodePoint]
 */
export function getTopologyZones(bbox, units, baseCodePoint = null) {
  // ── Если метрики загружены — делегируем им ───────────────────────────────
  if (isMetricsLoaded()) {
    const zones = computeZonesFromMetrics(bbox, units);
    // computeZonesFromMetrics возвращает { x, y, width, height }
    // конвертируем обратно в { x, y, width, height } — формат уже правильный
    return zones;
  }

  // ── Heuristic fallback (метрики ещё не загружены) ────────────────────────
  const zones = { RIGHT: null, BOTTOM: null, TOP: null, LEFT: null, BASE: null };

  const fullX1 = bbox.x1 ?? 0;
  const fullY1 = bbox.y1 ?? 0;
  const fullX2 = bbox.x2 ?? 0;
  const fullY2 = bbox.y2 ?? 0;

  const cps = new Set(units.flatMap((u) => u.codePoints || []));
  const cats = new Set(units.map((u) => u.category));

  const hasBottom = cats.has('subscript_consonant') || cats.has('coeng') || cps.has(0x17BB) || cps.has(0x17BC);
  const hasRight = cps.has(0x17B6) || cps.has(0x17C7);
  const leftCodes = [0x17C1, 0x17C2, 0x17C3, 0x17BE, 0x17BF, 0x17C0, 0x17C4, 0x17C5];
  const hasLeft = leftCodes.some((code) => cps.has(code));
  const hasTop = cats.has('diacritic') || cats.has('diacritic_sign') ||
    (cats.has('dependent_vowel') && !hasRight && !hasLeft && !cps.has(0x17BB) && !cps.has(0x17BC));

  const cp = baseCodePoint ?? findBaseCP(units);
  const body = getConsonantBodyRect(bbox, cp);
  const bX1 = body.bodyX1;
  const bY1 = body.bodyY1;
  const bX2 = body.bodyX2;
  const bY2 = body.bodyY2;

  if (hasRight) {
    const rightW = Math.max(0, fullX2 - bX2);
    if (rightW > 0) {
      zones.RIGHT = { x: bX2, y: fullY1, width: rightW, height: fullY2 - fullY1 };
    } else {
      const fallbackW = Math.max(1, (bX2 - bX1) * 0.30);
      zones.RIGHT = { x: bX2 - fallbackW, y: fullY1, width: fallbackW, height: fullY2 - fullY1 };
    }
  }

  if (hasLeft) {
    const leftW = Math.max(0, bX1 - fullX1);
    if (leftW > 0) {
      zones.LEFT = { x: fullX1, y: bY1, width: leftW, height: bY2 - bY1 };
    } else {
      const fallbackW = Math.max(1, (bX2 - bX1) * 0.28);
      zones.LEFT = { x: fullX1, y: bY1, width: fallbackW, height: bY2 - bY1 };
    }
  }

  if (hasBottom) {
    const bottomH = Math.max(0, fullY2 - bY2);
    if (bottomH > 0) {
      zones.BOTTOM = { x: fullX1, y: bY2, width: fullX2 - fullX1, height: bottomH };
    } else {
      const fallbackH = Math.max(1, (bY2 - bY1) * 0.40);
      zones.BOTTOM = { x: fullX1, y: bY2 - fallbackH, width: fullX2 - fullX1, height: fallbackH };
    }
  }

  if (hasTop) {
    const topH = Math.max(0, bY1 - fullY1);
    if (topH > 0) {
      zones.TOP = { x: fullX1, y: fullY1, width: fullX2 - fullX1, height: topH };
    } else {
      const fallbackH = Math.max(1, (bY2 - bY1) * 0.25);
      zones.TOP = { x: fullX1, y: fullY1, width: fullX2 - fullX1, height: fallbackH };
    }
  }

  zones.BASE = {
    x: bX1, y: bY1,
    width: Math.max(0, bX2 - bX1),
    height: Math.max(0, bY2 - bY1),
  };

  return zones;
}

export function createClipPathParts(glyph, units) {
  if (!glyph?.d || !glyph?.bb) return [];

  const glyphCps = new Set(glyph.codePoints || []);
  const relevantUnits = (units || []).filter((u) => {
    const hit = (u.codePoints || []).some((cp) => glyphCps.has(cp));
    const hasRange = Number.isInteger(u.sourceStart) && Number.isInteger(glyph.clusterStart);
    if (hasRange) return u.sourceStart < glyph.clusterEnd && u.sourceEnd > glyph.clusterStart;
    return hit;
  });

  if (relevantUnits.length === 0) return [];

  const baseCP = relevantUnits.find(
    (u) => u.category === 'base_consonant' || u.category === 'independent_vowel'
  )?.codePoints?.[0] ?? null;

  const zones = getTopologyZones(glyph.bb, relevantUnits, baseCP);
  const parts = [];
  const leftCodes = [0x17C1, 0x17C2, 0x17C3, 0x17BE, 0x17BF, 0x17C0, 0x17C4, 0x17C5];

  for (const unit of relevantUnits) {
    const cat = unit.category;
    const cp = unit.codePoints[0];
    let targetZone = null;
    let zoneName = 'unknown';

    if (cp === 0x17B6 || cp === 0x17C7) {
      targetZone = zones.RIGHT; zoneName = 'RIGHT';
    } else if (leftCodes.includes(cp)) {
      targetZone = zones.LEFT; zoneName = 'LEFT';
    } else if (cat === 'subscript_consonant' || cat === 'coeng' || cp === 0x17BB || cp === 0x17BC) {
      targetZone = zones.BOTTOM; zoneName = 'BOTTOM';
    } else if (cat === 'diacritic_sign' || cat === 'diacritic') {
      targetZone = zones.TOP; zoneName = 'TOP';
    } else if (cat === 'base_consonant' || cat === 'independent_vowel') {
      targetZone = zones.BASE; zoneName = 'BASE';
    } else {
      targetZone = zones.TOP; zoneName = 'TOP (fallback)';
    }

    if (targetZone && targetZone.width > 0) {
      // Зоны из computeZonesFromMetrics уже в формате {x,y,w,h} без x1/y1
      // clampRectToBbox ожидает rect с x/y/width/height и bbox с x1/y1/x2/y2
      const clipped = clampRectToBbox(targetZone, glyph.bb);
      parts.push({
        unitId: unit.id,
        category: cat,
        char: unit.text,
        pathData: glyph.d,
        color: getColorForCategory(cat, unit.text),
        clipRect: clipped,
        zone: zoneName,
        priority: cat === 'base_consonant' ? 1 : 10,
      });
    }
  }

  return parts.sort((a, b) => a.priority - b.priority);
}