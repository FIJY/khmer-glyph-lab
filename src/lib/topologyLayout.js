/**
 * topologyLayout.js
 *
 * Нарезка bbox кластера на зоны.
 * bbox здесь в формате { x, y, width, height } — отличие от simpleGlyphSplit,
 * где используется { x1, y1, x2, y2 }.
 *
 * Если метрики загружены (/api/metrics) — делегируем computeZonesFromMetrics.
 * Иначе — heuristic fallback через тело базовой согласной.
 */

import {
  getConsonantBodyRectXYWH,
  computeZonesFromMetrics,
  isMetricsLoaded,
} from './khmerConsonantMetrics.js';

const hasChar = (meta, code) => meta.some((m) => m.char.codePointAt(0) === code);
const hasCat  = (meta, cat)  => meta.some((m) => m.category === cat);

function findBaseCP(charMeta) {
  const base = charMeta.find(
    (m) => m.category === 'base_consonant' || m.category === 'independent_vowel'
  );
  return base?.char?.codePointAt(0) ?? null;
}

/**
 * @param {{ x, y, width, height }} bbox
 * @param {Array<{ char, category, codePoints? }>} charMeta
 * @param {number|null} [explicitBaseCP]
 */
export function getTopologyZones(bbox, charMeta, explicitBaseCP = null) {
  // ── Если метрики загружены — конвертируем bbox и делегируем ─────────────
  if (isMetricsLoaded()) {
    const bbox12 = {
      x1: bbox.x,
      y1: bbox.y,
      x2: bbox.x + bbox.width,
      y2: bbox.y + bbox.height,
    };
    // charMeta нужно дополнить codePoints если их нет
    const unitsForMetrics = charMeta.map((m) => ({
      ...m,
      codePoints: m.codePoints ?? (m.char ? [m.char.codePointAt(0)] : []),
    }));
    return computeZonesFromMetrics(bbox12, unitsForMetrics);
  }

  // ── Heuristic fallback ───────────────────────────────────────────────────
  const { x, y, width, height } = bbox;
  const zones = {};

  const hasRightWing = hasChar(charMeta, 0x17B6) || hasChar(charMeta, 0x17C7);
  const hasBottom = hasCat(charMeta, 'subscript_consonant') || hasCat(charMeta, 'coeng') ||
    hasChar(charMeta, 0x17BB) || hasChar(charMeta, 0x17BC);
  const hasTop = hasCat(charMeta, 'diacritic') || hasCat(charMeta, 'diacritic_sign') ||
    (hasCat(charMeta, 'dependent_vowel') && !hasRightWing && !hasBottom);

  const baseCP = explicitBaseCP ?? findBaseCP(charMeta);
  const body = getConsonantBodyRectXYWH(bbox, baseCP);
  const { bodyX, bodyY, bodyW, bodyH } = body;

  const bboxRight  = x + width;
  const bboxBottom = y + height;
  const bRight  = bodyX + bodyW;
  const bBottom = bodyY + bodyH;

  if (hasRightWing) {
    const rightW = Math.max(0, bboxRight - bRight);
    if (rightW > 0) {
      zones.RIGHT = { x: bRight, y, width: rightW, height };
    } else {
      const fallbackW = Math.min(Math.max(1, bodyW * 0.30), width * 0.45);
      zones.RIGHT = { x: bboxRight - fallbackW, y, width: fallbackW, height };
    }
  }

  if (hasBottom) {
    const bottomH = Math.max(0, bboxBottom - bBottom);
    if (bottomH > 0) {
      zones.BOTTOM = { x, y: bBottom, width, height: bottomH };
    } else {
      const fallbackH = Math.min(Math.max(1, bodyH * 0.40), height * 0.45);
      zones.BOTTOM = { x, y: bboxBottom - fallbackH, width, height: fallbackH };
    }
  }

  if (hasTop) {
    const topH = Math.max(0, bodyY - y);
    if (topH > 0) {
      zones.TOP = { x, y, width, height: topH };
    } else {
      const fallbackH = Math.min(Math.max(1, bodyH * 0.28), height * 0.35);
      zones.TOP = { x, y, width, height: fallbackH };
    }
  }

  zones.BASE = { x: bodyX, y: bodyY, width: bodyW, height: bodyH };

  return zones;
}