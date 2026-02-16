/**
 * topologyLayout.js
 * Стратегия нарезки на основе "Правила фиксированной колонки" для ា.
 */

const hasChar = (meta, code) => meta.some(m => m.char.codePointAt(0) === code);
const hasCat = (meta, cat) => meta.some(m => m.category === cat);

export function getTopologyZones(bbox, charMeta) {
  const { x, y, width, height } = bbox;
  const zones = {};

  // --- КОНФИГУРАЦИЯ ---

  // 1. Правый фланг (AA или Reahmuk)
  const hasRightWing = hasChar(charMeta, 0x17B6) || hasChar(charMeta, 0x17C7);

  // 2. Подвал (Subscript или Lower Vowel)
  const hasBottom = hasCat(charMeta, 'subscript_consonant') ||
                    hasCat(charMeta, 'coeng') ||
                    hasChar(charMeta, 0x17BB) || hasChar(charMeta, 0x17BC);

  // 3. Чердак (Top Diacritic)
  // Сюда попадают все диакритики, если это не AA и не нижние гласные
  const hasTop = hasCat(charMeta, 'diacritic') ||
                 hasCat(charMeta, 'diacritic_sign') ||
                 (hasCat(charMeta, 'dependent_vowel') && !hasRightWing && !hasBottom);

  // --- ГЕОМЕТРИЯ ---

  // Рабочая область, от которой будем отрезать куски
  let currentX = x;
  let currentY = y;
  let currentW = width;
  let currentH = height;

  // ШАГ 1: ПРАВАЯ КОЛОНКА (Священная корова)
  // Мы режем её первой, жестко и вертикально на всю высоту.
  if (hasRightWing) {
    // ЭВРИСТИКА: Ширина ា зависит от высоты шрифта, а не от ширины буквы.
    // Обычно это ~25% от высоты bounding box (включая ascender/descender).
    // Но не больше 40% от ширины (защита для очень узких букв).
    let aaWidth = height * 0.26;

    // Защита: если глиф очень узкий, не занимать больше 45% ширины
    if (aaWidth > width * 0.45) {
        aaWidth = width * 0.45;
    }

    zones.RIGHT = {
      x: x + width - aaWidth,
      y: y, // На всю высоту!
      width: aaWidth,
      height: height
    };

    // Уменьшаем рабочую ширину для остальных
    currentW -= aaWidth;
  }

  // ШАГ 2: ПОДВАЛ (BOTTOM)
  // Отрезаем низ от оставшейся левой части.
  // Для กุ или ญ (с подстрочным) важно, чтобы BASE не налезла на SUB.
  if (hasBottom) {
    // Подписные занимают ~35-40% снизу
    const bottomH = height * 0.38;

    zones.BOTTOM = {
      x: currentX,
      y: y + height - bottomH,
      width: currentW, // Только в пределах левой колонки!
      height: bottomH
    };

    // Уменьшаем рабочую высоту снизу
    currentH -= bottomH;
  }

  // ШАГ 3: ЧЕРДАК (TOP)
  // Отрезаем верх от оставшейся левой части
  if (hasTop) {
    const topH = height * 0.28; // Чуть больше четверти

    zones.TOP = {
      x: currentX,
      y: currentY,
      width: currentW,
      height: topH
    };

    // Сдвигаем рабочее начало вниз и уменьшаем высоту
    currentY += topH;
    currentH -= topH;
  }

  // ШАГ 4: БАЗА (BASE)
  // То, что осталось в центре слева
  zones.BASE = {
    x: currentX,
    y: currentY,
    width: currentW,
    height: currentH
  };

  return zones;
}