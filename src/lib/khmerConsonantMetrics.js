/**
 * khmerConsonantMetrics.js
 *
 * Загружает реальные bbox кхмерских символов с сервера (/api/metrics)
 * и предоставляет функции для вычисления зон нарезки.
 *
 * Вместо hardcoded таблиц — живые данные конкретного шрифта.
 *
 * Структура ответа /api/metrics:
 * {
 *   unitsPerEm: number,
 *   consonants:  { [cp]: { glyphId, bb } },
 *   subscripts:  { [cp]: { glyphId, bb, clusterBB, merged? } },
 *   vowels:      { [cp]: { glyphId, bb, clusterBB, components, multipart, merged?, delta? } },
 *   indepVowels: { [cp]: { glyphId, bb } },
 *   diacritics:  { [cp]: { glyphId, bb, clusterBB, merged?, delta? } }
 * }
 *
 * Все bb в единицах unitsPerEm шрифта (те же координаты, что в SVG path от сервера).
 */

// ─── Состояние модуля ─────────────────────────────────────────────────────

let metricsData = null;      // полный ответ /api/metrics
let loadingPromise = null;   // дедупликация параллельных загрузок
let currentFontId = null;

// ─── Дефолтные пропорции — используются до загрузки или при ошибке ────────
const FALLBACK_FRACS = {
  topFrac:    0.20,
  bottomFrac: 0.36,
  leftFrac:   0.00,
  rightFrac:  0.00,
};

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Загрузить метрики для шрифта.
 * Безопасно вызывать несколько раз — повторный вызов с тем же fontId ничего не делает.
 *
 * @param {string} [fontId='auto']
 * @param {string} [apiBase='http://localhost:3001']
 */
export async function loadMetrics(fontId = 'auto', apiBase = 'http://localhost:3001') {
  if (metricsData && currentFontId === fontId) return metricsData;
  if (loadingPromise) return loadingPromise;

  loadingPromise = fetch(`${apiBase}/api/metrics?font=${encodeURIComponent(fontId)}`)
    .then((res) => {
      if (!res.ok) throw new Error(`/api/metrics returned ${res.status}`);
      return res.json();
    })
    .then((data) => {
      metricsData = data;
      currentFontId = fontId;
      loadingPromise = null;
      console.log('[metrics] Loaded for font:', data.fontId, 'unitsPerEm:', data.unitsPerEm);
      return data;
    })
    .catch((err) => {
      console.warn('[metrics] Failed to load, using fallback proportions:', err.message);
      loadingPromise = null;
      return null;
    });

  return loadingPromise;
}

/**
 * Синхронно проверить, загружены ли метрики.
 */
export function isMetricsLoaded() {
  return metricsData != null;
}

// ─── Внутренние хелперы ──────────────────────────────────────────────────

function getConsonantBB(codePoint) {
  if (!metricsData || !codePoint) return null;
  return metricsData.consonants?.[codePoint]?.bb ?? null;
}

function getSubscriptData(codePoint) {
  if (!metricsData || !codePoint) return null;
  return metricsData.subscripts?.[codePoint] ?? null;
}

function getVowelData(codePoint) {
  if (!metricsData || !codePoint) return null;
  return metricsData.vowels?.[codePoint] ?? null;
}

function getDiacriticData(codePoint) {
  if (!metricsData || !codePoint) return null;
  return metricsData.diacritics?.[codePoint] ?? null;
}

// ─── Основные функции для нарезки зон ───────────────────────────────────

/**
 * Получить rect тела базовой согласной внутри bbox кластера.
 *
 * Логика: bbox согласной в изоляции совпадает с её телом в кластере по оси Y
 * (диакритики и гласные выходят ЗА пределы bbox тела, а не внутрь него).
 *
 * @param {{ x1, y1, x2, y2 }} clusterBB  — bbox всего кластера от сервера
 * @param {number|null} consonantCP        — codepoint базовой согласной
 * @returns {{ bodyX1, bodyY1, bodyX2, bodyY2 }}
 */
export function getConsonantBodyRect(clusterBB, consonantCP) {
  const bb = getConsonantBB(consonantCP);

  if (!bb) {
    // Fallback через пропорции
    const w = clusterBB.x2 - clusterBB.x1;
    const h = clusterBB.y2 - clusterBB.y1;
    return {
      bodyX1: clusterBB.x1 + w * FALLBACK_FRACS.leftFrac,
      bodyY1: clusterBB.y1 + h * FALLBACK_FRACS.topFrac,
      bodyX2: clusterBB.x2 - w * FALLBACK_FRACS.rightFrac,
      bodyY2: clusterBB.y2 - h * FALLBACK_FRACS.bottomFrac,
    };
  }

  // Реальные координаты тела: Y берём из изолированного bbox напрямую,
  // X: тело начинается от левого края кластера, ширина — реальная ширина согласной.
  const bodyW = bb.x2 - bb.x1;

  return {
    bodyX1: clusterBB.x1,
    bodyY1: bb.y1,
    bodyX2: clusterBB.x1 + bodyW,
    bodyY2: bb.y2,
  };
}

/**
 * Версия для topologyLayout (bbox в формате {x, y, width, height}).
 */
export function getConsonantBodyRectXYWH(bbox, consonantCP) {
  const bb12 = { x1: bbox.x, y1: bbox.y, x2: bbox.x + bbox.width, y2: bbox.y + bbox.height };
  const r = getConsonantBodyRect(bb12, consonantCP);
  return {
    bodyX: r.bodyX1,
    bodyY: r.bodyY1,
    bodyW: Math.max(0, r.bodyX2 - r.bodyX1),
    bodyH: Math.max(0, r.bodyY2 - r.bodyY1),
  };
}


/**
 * Получить данные о гласной: позицию, количество частей, delta.
 *
 * @param {number} vowelCP
 */
export function getVowelMetrics(vowelCP) {
  return getVowelData(vowelCP);
}

/**
 * Вычислить зоны нарезки для слитного глифа по реальным данным метрик.
 *
 * Возвращает объект зон в формате { x, y, width, height }.
 * Используется как замена heuristic-логики в simpleGlyphSplit и topologyLayout.
 *
 * @param {{ x1, y1, x2, y2 }} clusterBB  — bbox кластера от сервера
 * @param {Array} units                    — edu-units кластера
 * @returns {{ BASE, TOP, BOTTOM, LEFT, RIGHT }}
 */
export function computeZonesFromMetrics(clusterBB, units) {
  const zones = { BASE: null, TOP: null, BOTTOM: null, LEFT: null, RIGHT: null };

  const cx1 = clusterBB.x1;
  const cy1 = clusterBB.y1;
  const cx2 = clusterBB.x2;
  const cy2 = clusterBB.y2;

  // ── Базовая согласная ────────────────────────────────────────────────────
  const baseUnit = units.find(
    (u) => u.category === 'base_consonant' || u.category === 'independent_vowel'
  );
  const baseCP = baseUnit?.codePoints?.[0] ?? null;
  const body = getConsonantBodyRect(clusterBB, baseCP);

  zones.BASE = {
    x:      body.bodyX1,
    y:      body.bodyY1,
    width:  Math.max(0, body.bodyX2 - body.bodyX1),
    height: Math.max(0, body.bodyY2 - body.bodyY1),
  };

  // ── Остальные units ──────────────────────────────────────────────────────
  for (const unit of units) {
    const cat = unit.category;
    const cp = unit.codePoints?.[0];
    if (!cp) continue;
    if (cat === 'base_consonant' || cat === 'independent_vowel') continue;

    // ── Подписные согласные ─────────────────────────────────────────────
    if (cat === 'subscript_consonant' || cat === 'coeng') {
      const subData = getSubscriptData(cp);
      const subBB = subData?.bb;

      if (subBB && !subData.merged) {
        // Реальный отдельный компонент
        zones.BOTTOM = {
          x: cx1, y: subBB.y1,
          width: cx2 - cx1,
          height: Math.max(0, subBB.y2 - subBB.y1),
        };
      } else {
        // Слитный — всё ниже тела базы
        zones.BOTTOM = {
          x: cx1, y: body.bodyY2,
          width: cx2 - cx1,
          height: Math.max(0, cy2 - body.bodyY2),
        };
      }
      continue;
    }

    // ── Зависимые гласные ───────────────────────────────────────────────
    if (cat === 'dependent_vowel') {
      const vowelData = getVowelData(cp);
      if (!vowelData) continue;

      const vBB = vowelData.bb;
      const delta = vowelData.delta;

      if (vBB && !vowelData.merged) {
        // Отдельный компонент — определяем зону по его реальному положению
        const bodyMidX = (body.bodyX1 + body.bodyX2) / 2;
        const bodyMidY = (body.bodyY1 + body.bodyY2) / 2;
        const vCenterX = (vBB.x1 + vBB.x2) / 2;
        const vCenterY = (vBB.y1 + vBB.y2) / 2;

        const isLeft  = vCenterX < bodyMidX && vBB.x2 < body.bodyX2;
        const isRight = vCenterX > bodyMidX && vBB.x1 > body.bodyX1;
        const isAbove = vCenterY < body.bodyY1;
        const isBelow = vCenterY > body.bodyY2;

        if (isLeft && !isAbove && !isBelow) {
          zones.LEFT = {
            x: cx1, y: vBB.y1,
            width: Math.max(0, vBB.x2 - cx1),
            height: Math.max(0, vBB.y2 - vBB.y1),
          };
        } else if (isRight && !isAbove && !isBelow) {
          zones.RIGHT = {
            x: vBB.x1, y: cy1,
            width: Math.max(0, cx2 - vBB.x1),
            height: cy2 - cy1,
          };
        } else if (isAbove) {
          zones.TOP = {
            x: cx1, y: cy1,
            width: cx2 - cx1,
            height: Math.max(0, vBB.y2 - cy1),
          };
        } else if (isBelow) {
          // Нижняя гласная — объединяем с подписной зоной если она уже есть
          zones.BOTTOM = zones.BOTTOM ?? {
            x: cx1, y: vBB.y1,
            width: cx2 - cx1,
            height: Math.max(0, cy2 - vBB.y1),
          };
        }

        // Мультипартовые гласные (ោ, ើ, ៀ): если есть несколько компонентов,
        // дополнительно создаём LEFT
        if (vowelData.multipart && vowelData.components?.length > 1) {
          const leftComp = vowelData.components.find(c => c.bb.x1 < bodyMidX);
          const rightComp = vowelData.components.find(c => c.bb.x1 >= bodyMidX);
          if (leftComp) {
            zones.LEFT = {
              x: cx1, y: leftComp.bb.y1,
              width: Math.max(0, leftComp.bb.x2 - cx1),
              height: Math.max(0, leftComp.bb.y2 - leftComp.bb.y1),
            };
          }
          if (rightComp) {
            zones.RIGHT = {
              x: rightComp.bb.x1, y: cy1,
              width: Math.max(0, cx2 - rightComp.bb.x1),
              height: cy2 - cy1,
            };
          }
        }

      } else if (delta) {
        // Слитный — используем дельты
        if (delta.left  > 2) zones.LEFT   = { x: cx1, y: body.bodyY1, width: delta.left, height: body.bodyY2 - body.bodyY1 };
        if (delta.right > 2) zones.RIGHT  = { x: cx2 - delta.right, y: cy1, width: delta.right, height: cy2 - cy1 };
        if (delta.top   > 2) zones.TOP    = { x: cx1, y: cy1, width: cx2 - cx1, height: delta.top };
        if (delta.bottom > 2) zones.BOTTOM = zones.BOTTOM ?? { x: cx1, y: cy2 - delta.bottom, width: cx2 - cx1, height: delta.bottom };
      }
      continue;
    }

    // ── Диакритики ──────────────────────────────────────────────────────
    if (cat === 'diacritic_sign' || cat === 'diacritic') {
      const diaData = getDiacriticData(cp);

      if (diaData?.bb && !diaData.merged) {
        zones.TOP = {
          x: cx1, y: cy1,
          width: cx2 - cx1,
          height: Math.max(0, diaData.bb.y2 - cy1),
        };
      } else if (diaData?.delta?.top > 2) {
        zones.TOP = {
          x: cx1, y: cy1,
          width: cx2 - cx1,
          height: diaData.delta.top,
        };
      } else {
        // Fallback: верхние ~22% кластера
        zones.TOP = {
          x: cx1, y: cy1,
          width: cx2 - cx1,
          height: Math.max(1, (cy2 - cy1) * 0.22),
        };
      }
    }
  }

  return zones;
}


/**
 * Получить полные сырые метрики (для debug panel).
 */
export function getRawMetrics() {
  return metricsData;
}