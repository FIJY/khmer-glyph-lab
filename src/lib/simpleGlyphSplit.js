// src/lib/simpleGlyphSplit.js

/**
 * УПРОЩЁННАЯ версия: вместо парсинга SVG paths используем clip-path
 * Разделяем глиф на части геометрически через прямоугольные маски
 */

export function createClipPathParts(glyph, units) {
  if (!glyph.d || !glyph.bb) return [];

  const glyphCps = new Set(glyph.codePoints || []);
  const relevantUnits = units.filter(u =>
    (u.codePoints || []).some(cp => glyphCps.has(cp))
  );

  if (relevantUnits.length === 0) return [];

  // Определяем split line (вертикальная линия разделения)
  const bbox = glyph.bb;
  const centerX = (bbox.x1 + bbox.x2) / 2;
  const splitX = centerX + (bbox.x2 - bbox.x1) * 0.1; // Чуть правее центра

  const parts = [];

  for (const unit of relevantUnits) {
    const category = unit.category || 'other';
    let clipRect = null;
    let color = '#111';

    if (category === 'base_consonant' || category === 'independent_vowel') {
      // Левая часть (от x1 до splitX)
      clipRect = {
        x: bbox.x1,
        y: bbox.y1,
        width: splitX - bbox.x1,
        height: bbox.y2 - bbox.y1
      };
      color = '#22c55e'; // green
    } else if (category === 'dependent_vowel') {
      // Правая часть (от splitX до x2)
      clipRect = {
        x: splitX,
        y: bbox.y1,
        width: bbox.x2 - splitX,
        height: bbox.y2 - bbox.y1
      };
      color = '#ef4444'; // red
    } else if (category === 'subscript_consonant') {
      // Нижняя часть
      const centerY = (bbox.y1 + bbox.y2) / 2;
      clipRect = {
        x: bbox.x1,
        y: bbox.y1,
        width: bbox.x2 - bbox.x1,
        height: centerY - bbox.y1
      };
      color = '#3b82f6'; // blue
    } else if (category === 'diacritic_sign' || category === 'diacritic') {
      // Верхняя часть
      const centerY = (bbox.y1 + bbox.y2) / 2;
      clipRect = {
        x: bbox.x1,
        y: centerY,
        width: bbox.x2 - bbox.x1,
        height: bbox.y2 - centerY
      };
      color = '#f59e0b'; // amber
    }

    if (clipRect) {
      parts.push({
        unitId: unit.id,
        category,
        char: unit.text || '',
        pathData: glyph.d, // Используем ПОЛНЫЙ путь!
        color,
        clipRect, // Вместо разделения path
        zone: 'clipped'
      });
    }
  }

  return parts;
}