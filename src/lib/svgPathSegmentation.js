// src/lib/svgPathSegmentation.js

/**
 * Парсит SVG path в список команд
 * Поддерживает: M, L, Q, C, Z
 */
export function parseSVGPath(pathData) {
  if (!pathData) return [];

  const commands = [];
  const regex = /([MLQCZmlqcz])\s*([^MLQCZmlqcz]*)/g;
  let match;

  while ((match = regex.exec(pathData)) !== null) {
    const type = match[1].toUpperCase();
    const argsStr = match[2].trim();

    if (!argsStr && type !== 'Z') continue;

    const args = argsStr
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);

    commands.push({ type, args, original: match[0] });
  }

  return commands;
}

/**
 * Извлекает все точки из команды SVG path
 */
function getCommandPoints(cmd) {
  const points = [];

  switch (cmd.type) {
    case 'M':
    case 'L':
      // M x y или L x y
      if (cmd.args.length >= 2) {
        points.push({ x: cmd.args[0], y: cmd.args[1] });
      }
      break;

    case 'Q':
      // Q x1 y1 x y - квадратичная кривая
      if (cmd.args.length >= 4) {
        points.push({ x: cmd.args[0], y: cmd.args[1] }); // control point
        points.push({ x: cmd.args[2], y: cmd.args[3] }); // end point
      }
      break;

    case 'C':
      // C x1 y1 x2 y2 x y - кубическая кривая
      if (cmd.args.length >= 6) {
        points.push({ x: cmd.args[0], y: cmd.args[1] }); // control 1
        points.push({ x: cmd.args[2], y: cmd.args[3] }); // control 2
        points.push({ x: cmd.args[4], y: cmd.args[5] }); // end point
      }
      break;

    case 'Z':
      // Закрытие пути - нет точек
      break;

    default:
      // Для остальных команд просто берём все пары как точки
      for (let i = 0; i < cmd.args.length - 1; i += 2) {
        points.push({ x: cmd.args[i], y: cmd.args[i + 1] });
      }
  }

  return points;
}

/**
 * Вычисляет "центр масс" команды
 */
function getCommandCenter(cmd) {
  const points = getCommandPoints(cmd);
  if (points.length === 0) return null;

  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 }
  );

  return {
    x: sum.x / points.length,
    y: sum.y / points.length
  };
}

/**
 * Определяет в какой зоне находится команда
 * @param {object} cmd - команда пути
 * @param {object} bbox - { x1, y1, x2, y2 }
 * @returns {'left'|'right'|'top'|'bottom'|'center'}
 */
function classifyCommandZone(cmd, bbox) {
  const center = getCommandCenter(cmd);
  if (!center) return 'center';

  const width = bbox.x2 - bbox.x1;
  const height = bbox.y2 - bbox.y1;

  // Нормализуем относительно bbox
  const relX = (center.x - bbox.x1) / width;
  const relY = (center.y - bbox.y1) / height;

  // ВАЖНО: В OpenType Y растёт ВВЕРХ (y1 < y2, где y1 - низ, y2 - верх)
  // Но в большинстве шрифтов bbox.y1 отрицательный (например -1500), bbox.y2 = 0
  // Поэтому relY близкое к 0 = близко к y1 (низ), relY близкое к 1 = близко к y2 (верх)

  // Упрощённые пороги
  const isLeft = relX < 0.5;
  const isRight = relX > 0.65;
  const isTop = relY > 0.6; // Верхние 40% (ближе к y2)
  const isBottom = relY < 0.4; // Нижние 40% (ближе к y1)

  // Приоритет: right > top > bottom > left
  if (isRight) {
    return 'right';
  } else if (isTop) {
    return 'top';
  } else if (isBottom) {
    return 'bottom';
  } else if (isLeft) {
    return 'left';
  } else {
    return 'center';
  }
}

/**
 * Разделяет SVG path на зоны
 */
export function segmentPathByGeometry(pathData, bbox) {
  const commands = parseSVGPath(pathData);

  console.log('[SEGMENT:GEO] Total commands:', commands.length);
  console.log('[SEGMENT:GEO] BBox:', bbox);

  const zones = {
    left: [],
    right: [],
    top: [],
    bottom: [],
    center: []
  };

  // Группируем команды по зонам
  let currentZone = null;
  let subPath = [];

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];

    if (cmd.type === 'M') {
      // Новый subpath
      if (subPath.length > 0) {
        // Сохраняем предыдущий
        if (currentZone) {
          console.log('[SEGMENT:GEO] Saving subpath to zone:', currentZone, 'length:', subPath.length);
          zones[currentZone].push([...subPath]);
        }
        subPath = [];
      }
      currentZone = classifyCommandZone(cmd, bbox);
      console.log('[SEGMENT:GEO] M command, new zone:', currentZone, 'center:', getCommandCenter(cmd));
      subPath.push(cmd);
    } else if (cmd.type === 'Z') {
      subPath.push(cmd);
      // Сохраняем закрытый subpath
      if (currentZone && subPath.length > 0) {
        console.log('[SEGMENT:GEO] Z command, saving to zone:', currentZone, 'length:', subPath.length);
        zones[currentZone].push([...subPath]);
      }
      subPath = [];
      currentZone = null;
    } else {
      // Обычная команда
      const zone = classifyCommandZone(cmd, bbox);

      if (zone !== currentZone && subPath.length > 0) {
        // Зона изменилась - разрываем subpath
        // (это упрощение, в реальности нужно аккуратнее)
        if (currentZone) {
          console.log('[SEGMENT:GEO] Zone change from', currentZone, 'to', zone, 'saving subpath length:', subPath.length);
          zones[currentZone].push([...subPath]);
        }
        // Начинаем новый subpath с M команды на последней точке
        const lastCmd = subPath[subPath.length - 1];
        const lastPoint = getCommandPoints(lastCmd).slice(-1)[0];
        if (lastPoint) {
          subPath = [{ type: 'M', args: [lastPoint.x, lastPoint.y], original: `M${lastPoint.x} ${lastPoint.y}` }];
        } else {
          subPath = [];
        }
        currentZone = zone;
      }

      subPath.push(cmd);
    }
  }

  // Сохраняем последний subpath
  if (subPath.length > 0 && currentZone) {
    console.log('[SEGMENT:GEO] Final subpath to zone:', currentZone, 'length:', subPath.length);
    zones[currentZone].push(subPath);
  }

  console.log('[SEGMENT:GEO] Final zones counts:', {
    left: zones.left.length,
    right: zones.right.length,
    top: zones.top.length,
    bottom: zones.bottom.length,
    center: zones.center.length
  });

  return zones;
}

/**
 * Конвертирует список subpaths обратно в SVG path строку
 */
export function subpathsToSVG(subpaths) {
  if (!subpaths || subpaths.length === 0) return '';

  const pathStrings = [];

  for (const subpath of subpaths) {
    const parts = subpath.map(cmd => {
      if (cmd.type === 'Z') return 'Z';
      return `${cmd.type}${cmd.args.join(' ')}`;
    });
    pathStrings.push(parts.join(''));
  }

  return pathStrings.join('');
}

/**
 * Сопоставляет зоны с Unicode символами
 * @param {object} glyph - глиф с полями chars, codePoints, bb, d
 * @param {array} units - edu units
 * @returns {array} - массив частей с pathData, category, char, color
 */
/**
 * Сопоставляет зоны с Unicode символами
 * УПРОЩЁННАЯ ВЕРСИЯ: используем center как основу согласной
 */
export function mapGlyphToVisualParts(glyph, units) {
  if (!glyph.d || !glyph.bb) return [];

  console.log('[SEGMENT] Glyph:', glyph.id, 'chars:', glyph.chars);

  const zones = segmentPathByGeometry(glyph.d, glyph.bb);

  console.log('[SEGMENT] Zones:', {
    left: zones.left.length,
    right: zones.right.length,
    top: zones.top.length,
    bottom: zones.bottom.length,
    center: zones.center.length
  });

  // Определяем какие units есть в этом глифе
  const glyphCps = new Set(glyph.codePoints || []);
  const relevantUnits = units.filter(u =>
    (u.codePoints || []).some(cp => glyphCps.has(cp))
  );

  console.log('[SEGMENT] Relevant units:', relevantUnits.map(u => u.text));

  const parts = [];

  // НОВАЯ СТРАТЕГИЯ:
  // - Согласная = center + left
  // - Гласная = right + top + bottom (всё остальное)
  // - Подписная = bottom
  // - Диакритика = top

  for (const unit of relevantUnits) {
    const category = unit.category || 'other';
    let zonesToCombine = [];
    let color = '#111';
    let zoneName = 'unknown';

    if (category === 'base_consonant' || category === 'independent_vowel') {
      // Согласная = center + left
      zonesToCombine = [
        ...zones.center,
        ...zones.left
      ];
      color = '#22c55e'; // green
      zoneName = 'consonant (center+left)';
    } else if (category === 'dependent_vowel') {
      // Гласная = right + top (но НЕ bottom!)
      zonesToCombine = [
        ...zones.right,
        ...zones.top
      ];
      color = '#ef4444'; // red
      zoneName = 'vowel (right+top)';
    } else if (category === 'subscript_consonant') {
      zonesToCombine = [...zones.bottom];
      color = '#3b82f6'; // blue
      zoneName = 'subscript (bottom)';
    } else if (category === 'diacritic_sign' || category === 'diacritic') {
      zonesToCombine = [...zones.top];
      color = '#f59e0b'; // amber
      zoneName = 'diacritic (top)';
    } else if (category === 'coeng') {
      zonesToCombine = [...zones.bottom];
      color = '#8b5cf6'; // purple
      zoneName = 'coeng (bottom)';
    }

    const pathData = subpathsToSVG(zonesToCombine);

    console.log('[SEGMENT] Unit:', unit.text, 'category:', category, 'zone:', zoneName, 'pathData length:', pathData.length);

    if (pathData) {
      parts.push({
        unitId: unit.id,
        category,
        char: unit.text || '',
        pathData,
        color,
        zone: zoneName
      });
    }
  }

  console.log('[SEGMENT] Final parts count:', parts.length);

  // Если нет частей, возвращаем весь глиф как одну часть
  if (parts.length === 0) {
    console.log('[SEGMENT] No parts found, returning full glyph');
    parts.push({
      unitId: null,
      category: 'full',
      char: glyph.chars?.join('') || '',
      pathData: glyph.d,
      color: '#111',
      zone: 'full'
    });
  }

  return parts;
}