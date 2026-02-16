// src/lib/simpleGlyphSplit.js

import { getSymbolPositions, CATEGORY_COLORS } from "./khmerPositions.js";

/**
 * bbox в координатах шрифта:
 * x1 = left, x2 = right
 * y1 = bottom, y2 = top
 */

function clampRectToBbox(rect, bbox) {
  const x1 = Math.max(bbox.x1, rect.x);
  const y1 = Math.max(bbox.y1, rect.y);
  const x2 = Math.min(bbox.x2, rect.x + rect.width);
  const y2 = Math.min(bbox.y2, rect.y + rect.height);

  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  };
}

/**
 * Создаёт clipRect для конкретной позиции
 * position: 'left' | 'right' | 'top' | 'bottom' | 'center'
 */
function createClipRectForPosition(bbox, position) {
  const w = bbox.x2 - bbox.x1;
  const h = bbox.y2 - bbox.y1;

  const centerX = (bbox.x1 + bbox.x2) / 2;
  const centerY = (bbox.y1 + bbox.y2) / 2;

  // Перекрытие зон, чтобы не было щелей
  const overlapX = w * 0.06;
  const overlapY = h * 0.06;

  // Доли зон
  const leftW = w * 0.45;
  const rightW = w * 0.45;
  const topH = h * 0.45;
  const bottomH = h * 0.45;

  let rect;

  switch (position) {
    case "left":
      rect = {
        x: bbox.x1,
        y: bbox.y1,
        width: leftW + overlapX,
        height: h,
      };
      break;

    case "right":
      rect = {
        x: bbox.x2 - rightW - overlapX,
        y: bbox.y1,
        width: rightW + overlapX,
        height: h,
      };
      break;

    case "top":
      rect = {
        x: bbox.x1,
        y: centerY - overlapY,
        width: w,
        height: bbox.y2 - (centerY - overlapY),
      };
      break;

    case "bottom":
      rect = {
        x: bbox.x1,
        y: bbox.y1,
        width: w,
        height: (centerY - bbox.y1) + overlapY,
      };
      break;

    case "center":
      rect = {
        x: bbox.x1 + w * 0.20,
        y: bbox.y1 + h * 0.18,
        width: w * 0.60,
        height: h * 0.64,
      };
      break;

    default:
      rect = {
        x: bbox.x1,
        y: bbox.y1,
        width: w,
        height: h,
      };
      break;
  }

  return clampRectToBbox(rect, bbox);
}

/**
 * Объединяет несколько clipRect в один
 */
function mergeClipRects(rects) {
  const valid = (rects || []).filter((r) => r && r.width > 0 && r.height > 0);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  const x1 = Math.min(...valid.map((r) => r.x));
  const y1 = Math.min(...valid.map((r) => r.y));
  const x2 = Math.max(...valid.map((r) => r.x + r.width));
  const y2 = Math.max(...valid.map((r) => r.y + r.height));

  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  };
}

function unique(arr) {
  return Array.from(new Set(arr));
}

function getPositionsForUnit(unit) {
  const cps = Array.isArray(unit?.codePoints) ? unit.codePoints : [];
  const pos = cps.flatMap((cp) => getSymbolPositions(cp) || []);
  return unique(pos);
}

function isUnitInsideGlyphCluster(unit, glyph) {
  const hasUnitRange = Number.isInteger(unit?.sourceStart) && Number.isInteger(unit?.sourceEnd);
  const hasGlyphRange = Number.isInteger(glyph?.clusterStart) && Number.isInteger(glyph?.clusterEnd);

  if (!hasUnitRange || !hasGlyphRange) return true;

  // overlap check: [start, end)
  return unit.sourceStart < glyph.clusterEnd && unit.sourceEnd > glyph.clusterStart;
}

function getCategoryPriority(category) {
  // больше = выше приоритет в наложении
  switch (category) {
    case "base_consonant":
      return 100;
    case "independent_vowel":
      return 95;
    case "subscript_consonant":
      return 90;
    case "coeng":
      return 85;
    case "dependent_vowel":
      return 80;
    case "diacritic_sign":
    case "diacritic":
      return 70;
    default:
      return 10;
  }
}

/**
 * Создаёт parts используя известные позиции символов
 */
export function createClipPathParts(glyph, units) {
  if (!glyph?.d || !glyph?.bb) return [];

  const glyphCps = new Set(glyph.codePoints || []);
  const relevantUnits = (units || []).filter((u) => {
    const codePointHit = (u.codePoints || []).some((cp) => glyphCps.has(cp));
    return codePointHit && isUnitInsideGlyphCluster(u, glyph);
  });

  if (relevantUnits.length === 0) return [];

  const bbox = glyph.bb;
  const parts = [];

  for (const unit of relevantUnits) {
    const category = unit.category || "other";
    const color = CATEGORY_COLORS[category] || "#111";

    let clipRect = null;
    let zoneName = "unknown";

    if (category === "base_consonant" || category === "independent_vowel") {
      // Центральная зона для базы, чтобы не "съедать" крайние маркеры
      clipRect = createClipRectForPosition(bbox, "center");
      zoneName = "center";
    } else if (category === "subscript_consonant") {
      // Подписная — внизу, но чуть уже по ширине
      const bottom = createClipRectForPosition(bbox, "bottom");
      const wPad = (bbox.x2 - bbox.x1) * 0.10;
      clipRect = clampRectToBbox(
        {
          x: bottom.x + wPad,
          y: bottom.y,
          width: Math.max(0, bottom.width - 2 * wPad),
          height: bottom.height,
        },
        bbox
      );
      zoneName = "bottom";
    } else if (category === "dependent_vowel") {
      const positions = getPositionsForUnit(unit);

      if (positions.length > 0) {
        const rects = positions.map((p) => createClipRectForPosition(bbox, p));
        clipRect = mergeClipRects(rects);
        zoneName = positions.join("+");
      } else {
        // fallback: чаще справа/сверху, но лучше right как нейтральный
        clipRect = createClipRectForPosition(bbox, "right");
        zoneName = "right (fallback)";
      }
    } else if (category === "diacritic_sign" || category === "diacritic") {
      const positions = getPositionsForUnit(unit);

      if (positions.length > 0) {
        const rects = positions.map((p) => createClipRectForPosition(bbox, p));
        clipRect = mergeClipRects(rects);
        zoneName = positions.join("+");
      } else {
        clipRect = createClipRectForPosition(bbox, "top");
        zoneName = "top (fallback)";
      }
    } else if (category === "coeng") {
      clipRect = createClipRectForPosition(bbox, "bottom");
      zoneName = "bottom";
    } else {
      // other — не режем
      clipRect = createClipRectForPosition(bbox, "center");
      zoneName = "center (fallback)";
    }

    if (clipRect && clipRect.width > 0 && clipRect.height > 0) {
      parts.push({
        unitId: unit.id,
        category,
        char: unit.text || "",
        pathData: glyph.d,
        color,
        clipRect,
        zone: zoneName,
        priority: getCategoryPriority(category),
      });
    }
  }

  return parts;
}
