import { createClipPathParts, getTopologyZones } from './simpleGlyphSplit.js';
import { getKhmerGlyphCategory } from './khmerClassifier.js';
import {
  getColorForCategory,
  shouldSplitBaseForDependentVowel,
  getSubscriptVowelRule
} from './glyphCombinationRules.js';
import { getConsonantBodyRect, getRawMetrics, getVowelMetrics } from './khmerConsonantMetrics.js';

/**
 * v2 goals:
 * 1) Keep existing behavior for most glyphs.
 * 2) Fix narrow stacked cases (e.g. ខ្ញុំ) with strict guards.
 * 3) Avoid global regressions on level 1.
 * v3 change:
 * 4) All geometry splitting now anchors to the base consonant body,
 *    using metrics from khmerConsonantMetrics.js.
 */

const ENABLE_NARROW_STACKED_MODE = true;

/**
 * Optional emergency word-level override:
 * add problematic clusters here if needed during rollout.
 */
const STACKED_CLUSTER_WHITELIST = new Set([
  // 'ខ្ញុំ',
]);

/**
 * If a cluster appears here, narrow stacked mode will be skipped.
 */
const STACKED_CLUSTER_BLACKLIST = new Set([
  // '...'
]);

function getComponentArea(component) {
  if (!component?.bb) return 0;
  const width = Math.max(0, (component.bb.x2 || 0) - (component.bb.x1 || 0));
  const height = Math.max(0, (component.bb.y2 || 0) - (component.bb.y1 || 0));
  return width * height;
}

function getComponentCenterY(component) {
  if (!component?.bb) return 0;
  return ((component.bb.y1 || 0) + (component.bb.y2 || 0)) / 2;
}

function hasCategory(meta, cat) {
  return meta.some((m) => m.category === cat);
}

function pickLargestComponent(components) {
  if (!components?.length) return null;
  return [...components].sort((a, b) => getComponentArea(b) - getComponentArea(a))[0] || components[0];
}

/**
 * Найти компонент, соответствующий базовой согласной.
 *
 * Стратегия (по приоритету):
 * 1. Сопоставить hbGlyphId компонента с известным glyphId из метрик шрифта.
 *    Это единственный надёжный способ — не зависит от площади/позиции.
 * 2. Fallback: наибольшая площадь (старое поведение).
 *
 * @param {Array} components — компоненты глифа от сервера
 * @param {number|null} consonantCP — codepoint базовой согласной
 * @returns {object} компонент
 */
function getComponentLeftEdge(comp) {
  // Реальная левая граница компонента: bb.x1 (абсолютные координаты пути)
  // или comp.x (позиция пера от HarfBuzz)
  if (comp.bb && Number.isFinite(comp.bb.x1)) return comp.bb.x1;
  if (Number.isFinite(comp.x)) return comp.x;
  return 0;
}

// Препозитивные гласные — рендерятся ЛЕВЕЕ базовой согласной.
// Для кластеров с ними нельзя использовать "самый левый = база".
const PREPOSITIVE_VOWEL_CPS = new Set([0x17C1, 0x17C2, 0x17C3, 0x17BE, 0x17BF, 0x17C0, 0x17C4, 0x17C5]);

function hasPrepositive(charMeta) {
  return (charMeta || []).some(m => {
    const cp = m.char?.codePointAt(0) ?? m.unit?.codePoints?.[0];
    return PREPOSITIVE_VOWEL_CPS.has(cp);
  });
}

function pickBaseComponent(components, consonantCP, charMeta) {
  if (!components?.length) return null;
  if (components.length === 1) return components[0];

  // Стратегия 1: по glyphId из метрик (надёжно если шейпер не заменил глиф через GSUB)
  if (consonantCP != null) {
    const metrics = getRawMetrics();
    const knownGlyphId = metrics?.consonants?.[consonantCP]?.glyphId;
    if (knownGlyphId != null) {
      const match = components.find(c => c.hbGlyphId === knownGlyphId);
      if (match) return match;
    }
  }

  // Стратегия 2: самый левый компонент = базовая согласная.
  // Исключение: препозитивные гласные (ែ, ើ, ឿ) стоят левее базы —
  // для таких кластеров падаем в стратегию 3.
  if (!hasPrepositive(charMeta)) {
    const byLeft = [...components].sort((a, b) => getComponentLeftEdge(a) - getComponentLeftEdge(b));
    return byLeft[0] || components[0];
  }

  // Стратегия 3 (препозитивные): площадь — база обычно крупнее гласной
  return [...components].sort((a, b) => getComponentArea(b) - getComponentArea(a))[0] || components[0];
}

function getClusterText(charMeta) {
  return (charMeta || []).map((m) => m?.char || '').join('');
}

function cpOf(ch) {
  return ch ? ch.codePointAt(0) : null;
}

/**
 * Найти codepoint базовой согласной из charMeta.
 */
function findBaseCP(charMeta) {
  const base = charMeta.find(
    (m) => m.category === 'base_consonant' || m.category === 'independent_vowel'
  );
  return cpOf(base?.char) ?? null;
}

/**
 * Narrow stacked layout для слитного кхмерского кластера:
 * base + coeng + subscript + lower dependent vowel + top diacritic.
 * Типичный пример: ខ្ញុំ
 *
 * v3: высоты зон теперь вычисляются от тела базовой согласной,
 *     а не от bbox с фиксированными коэффициентами.
 */
function buildStackedClusterParts(glyph, charMeta) {
  const stackBaseCP = findBaseCP(charMeta);
  const mainComp = pickBaseComponent(glyph.components || [], stackBaseCP, charMeta) || pickLargestComponent(glyph.components || []);
  if (!mainComp?.bb) return null;

  const bb = mainComp.bb;
  const x1 = bb.x1 || 0;
  const y1 = bb.y1 || 0;
  const x2 = bb.x2 || 0;
  const y2 = bb.y2 || 0;

  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  if (w <= 0 || h <= 0) return null;

  // ── v3: якорь на реальный bbox базовой согласной ─────────────────────────
  const baseCP = findBaseCP(charMeta);
  const bodyRect = getConsonantBodyRect({ x1, y1, x2, y2 }, baseCP);

  const bodyY1 = bodyRect.bodyY1;
  const bodyY2 = bodyRect.bodyY2;
  const bodyH = Math.max(1, bodyY2 - bodyY1);

  // Зоны
  const yTop = y1;
  const topH = Math.max(1, bodyY1 - y1);    // выше тела
  const yMid = bodyY1;                        // начало тела согласной
  const midH = bodyH;                         // само тело
  const yLow = bodyY2;                        // ниже тела
  const lowH = Math.max(1, y2 - bodyY2);     // подписные / нижние гласные

  // Горизонтальный сплит в нижней зоне: coeng слева, subscript справа
  const coengW = Math.max(50, w * 0.28);
  const restW = Math.max(0, w - coengW);

  const parts = [];

  for (const meta of charMeta) {
    const { char, category, unitIdx } = meta;

    let clipRect = null;
    let zone = 'stack_generic';

    if (category === 'base_consonant' || category === 'independent_vowel') {
      clipRect = { x: x1, y: yMid, width: w, height: midH };
      zone = 'stack_base';
    } else if (category === 'diacritic_sign' || category === 'diacritic') {
      clipRect = { x: x1, y: yTop, width: w, height: topH };
      zone = 'stack_diacritic_top';
    } else if (category === 'coeng') {
      clipRect = { x: x1, y: yLow, width: coengW, height: lowH };
      zone = 'stack_coeng_low_left';
    } else if (category === 'subscript_consonant') {
      clipRect = { x: x1 + coengW, y: yLow, width: restW, height: lowH };
      zone = 'stack_subscript_low';
    } else if (category === 'dependent_vowel') {
      // Нижняя зависимая гласная (ុ / ូ) — центрально-правая часть нижней зоны
      clipRect = {
        x: x1 + Math.max(0, w * 0.35),
        y: yLow,
        width: Math.max(40, w * 0.45),
        height: lowH,
      };
      zone = 'stack_dep_vowel_low';
    } else {
      clipRect = { x: x1, y: y1, width: w, height: h };
      zone = 'stack_full';
    }

    parts.push({
      partId: `${glyph.id}-stack-${unitIdx}`,
      component: mainComp,
      char,
      category,
      color: getColorForCategory(category, char),
      zone,
      hbGlyphId: mainComp?.hbGlyphId,
      clipRect,
    });
  }

  return parts;
}

function pickComponentForCategory(glyph, category, charIdx, charMeta) {
  const components = glyph.components || [];
  if (components.length === 0) return null;
  if (components.length === 1) return components[0];

  const byAreaDesc = [...components].sort((a, b) => getComponentArea(b) - getComponentArea(a));
  // Ищем базовый компонент по glyphId из метрик, а не по площади
  const metaBaseCP = charMeta?.find(m => m.category === 'base_consonant' || m.category === 'independent_vowel')?.char?.codePointAt(0) ?? null;
  const baseCandidate = pickBaseComponent(components, metaBaseCP, charMeta);
  const markCandidate = [...components].sort((a, b) => {
    if ((a.advance || 0) !== (b.advance || 0)) return (a.advance || 0) - (b.advance || 0);
    return getComponentArea(a) - getComponentArea(b);
  })[0] || components[components.length - 1];

  const hasDiacritic = charMeta.some(
    (item) => item.category === 'diacritic_sign' || item.category === 'diacritic'
  );
  const hasSubscript = charMeta.some((item) => item.category === 'subscript_consonant');

  if (category === 'base_consonant' || category === 'independent_vowel') {
    return baseCandidate;
  }

  if (category === 'dependent_vowel') {
    if (hasSubscript) {
      const nonBase = components.find((c) => c !== baseCandidate);
      if (nonBase) return nonBase;
    }
    if (hasDiacritic) return components[components.length - 1] || baseCandidate;
    return components[components.length - 1] || baseCandidate;
  }

  if (category === 'diacritic_sign' || category === 'diacritic') {
    return markCandidate;
  }

  if (category === 'subscript_consonant') {
    const nonBase = components.find((comp) => comp !== baseCandidate);
    if (nonBase) return nonBase;
    return [...components].sort((a, b) => getComponentCenterY(a) - getComponentCenterY(b))[0];
  }

  if (category === 'coeng') {
    const subscriptPart = charMeta.some((item) => item.category === 'subscript_consonant');
    if (subscriptPart) {
      const nonBase = components.find((comp) => comp !== baseCandidate);
      if (nonBase) return nonBase;
    }
  }

  return components[Math.min(charIdx, components.length - 1)] || components[0];
}

function createFullGlyphPart(glyph) {
  return {
    partId: `${glyph.id}-full`,
    component: null,
    char: glyph.chars?.join('') || '',
    category: 'full',
    color: '#111',
    zone: 'full',
    pathData: glyph.d,
  };
}

function getComponentBasedParts(glyph, units, enableSegmentation) {
  console.log('[MAPPER] Processing glyph:', glyph.id, 'chars:', glyph.chars);
  console.log('[MAPPER] Components count:', glyph.components?.length);
  console.log('[MAPPER] Components have bb?', glyph.components?.map((c) => ({
    id: c.hbGlyphId,
    hasBB: !!c.bb,
    bb: c.bb,
  })));

  const uniqueGlyphIds = new Set((glyph.components || []).map((c) => c.hbGlyphId));

  console.log(
    '[MAPPER] Unique IDs:',
    uniqueGlyphIds.size,
    'Should fallback?',
    uniqueGlyphIds.size === 1 && glyph.chars.length > 1 && glyph.components.length === 1
  );

  const shouldUseGeometryFallback =
    uniqueGlyphIds.size === 1 &&
    glyph.chars.length > 1 &&
    glyph.components.length === 1;

  if (shouldUseGeometryFallback) {
    console.log('[MAPPER] → Using geometry fallback');
    if (!enableSegmentation) return [createFullGlyphPart(glyph)];

    return createClipPathParts(glyph, units).map((part, idx) => ({
      ...part,
      partId: `${glyph.id}-${idx}`,
    }));
  }

  // Use eduUnits instead of glyph.chars
  const glyphCps = new Set(glyph.codePoints || []);
  const relevantUnits = (units || []).filter((u) => {
    const codePointHit = (u.codePoints || []).some((cp) => glyphCps.has(cp));
    const hasUnitRange = Number.isInteger(u?.sourceStart) && Number.isInteger(u?.sourceEnd);
    const hasGlyphRange =
      Number.isInteger(glyph?.clusterStart) && Number.isInteger(glyph?.clusterEnd);

    if (!hasUnitRange || !hasGlyphRange) return codePointHit;

    const isInCluster = u.sourceStart < glyph.clusterEnd && u.sourceEnd > glyph.clusterStart;
    return codePointHit && isInCluster;
  });

  console.log('[MAPPER] Relevant units:', relevantUnits.map((u) => ({ text: u.text, category: u.category })));

  const charMeta = relevantUnits.map((unit, unitIdx) => ({
    char: unit.text,
    unitIdx,
    unit,
    category: unit.category,
  }));

  console.log('[MAPPER] Char meta from units:', charMeta);

  // ── FIX A: Кластер без базовой согласной (coeng + subscript [+ vowel]) ────
  // При cluster level 1 HarfBuzz может выделить подписную форму в отдельный
  // кластер. Её компоненты уже позиционированы сервером — просто рендерим
  // их без zone-клиппинга.
  const clusterHasBase =
    charMeta.some((m) => m.category === 'base_consonant' || m.category === 'independent_vowel');

  if (!clusterHasBase && charMeta.length > 0) {
    // Кластер без базовой согласной — glyph уже позиционирован HarfBuzz-ом.
    // Рендерим компоненты напрямую без клиппинга.
    return (glyph.components || []).map((comp, idx) => {
      const meta = charMeta.find((m) =>
        m.category === 'subscript_consonant' || m.category === 'coeng' ||
        m.category === 'dependent_vowel' || m.category === 'diacritic_sign'
      ) || charMeta[idx] || charMeta[0];
      return {
        partId: `${glyph.id}-direct-${idx}`,
        component: comp,
        char: meta?.char || '',
        category: meta?.category || 'other',
        color: getColorForCategory(meta?.category || 'other', meta?.char || ''),
        zone: 'direct',   // позиционировано шейпером, clip не нужен
        hbGlyphId: comp?.hbGlyphId,
      };
    });
  }

  // ── NARROW STACKED MODE (v2 / v3) ─────────────────────────────────────────
  if (ENABLE_NARROW_STACKED_MODE) {
    const clusterText = getClusterText(charMeta);

    const comps = glyph.components || [];
    const componentsByArea = [...comps].sort((a, b) => getComponentArea(b) - getComponentArea(a));
    // Для isMergedShape достаточно сравнить два наибольших компонента
    const biggest = componentsByArea[0];
    const second = componentsByArea[1];

    const biggestArea = getComponentArea(biggest);
    const secondArea = getComponentArea(second);

    const isMergedShape =
      comps.length <= 3 &&
      biggestArea > 0 &&
      (secondArea === 0 || biggestArea / Math.max(1, secondArea) >= 2.2);

    const depMeta = charMeta.find((m) => m.category === 'dependent_vowel');
    const depCp = cpOf(depMeta?.char);

    const LOWER_DEP_VOWELS = new Set([0x17BB, 0x17BC]); // ុ ូ

    const hasBase =
      hasCategory(charMeta, 'base_consonant') ||
      hasCategory(charMeta, 'independent_vowel');
    const hasCoeng = hasCategory(charMeta, 'coeng');
    const hasSub = hasCategory(charMeta, 'subscript_consonant');
    const hasTopMark =
      hasCategory(charMeta, 'diacritic_sign') ||
      hasCategory(charMeta, 'diacritic');

    const inWhitelist =
      STACKED_CLUSTER_WHITELIST.size === 0 || STACKED_CLUSTER_WHITELIST.has(clusterText);
    const inBlacklist = STACKED_CLUSTER_BLACKLIST.has(clusterText);

    const isNarrowStackedCase =
      !inBlacklist &&
      inWhitelist &&
      hasBase &&
      hasCoeng &&
      hasSub &&
      hasTopMark &&
      depCp != null &&
      LOWER_DEP_VOWELS.has(depCp) &&
      isMergedShape;

    if (isNarrowStackedCase) {
      const stackedParts = buildStackedClusterParts(glyph, charMeta);
      if (stackedParts?.length) {
        console.log(
          '[MAPPER] ✅ USING NARROW STACKED MODE:',
          charMeta.map((m) => `${m.char}:${m.category}`).join(' | '),
          { clusterText, biggestArea, secondArea, ratio: biggestArea / Math.max(1, secondArea) }
        );
        return stackedParts;
      }
    }
  }

  // ── Subscript + vowel combo rule ──────────────────────────────────────────
  const subscriptMeta = charMeta.find((item) => item.category === 'subscript_consonant');
  const vowelMeta = charMeta.find((item) => item.category === 'dependent_vowel');
  const comboRule =
    subscriptMeta && vowelMeta
      ? getSubscriptVowelRule(subscriptMeta.char, vowelMeta.char)
      : null;

  if (comboRule) {
    console.log('[MAPPER] ✨ COMBO RULE DETECTED:', comboRule.description);

    if (comboRule.splitMode === 'three-way' && glyph.components.length >= 2) {
      const comboBaseCP = charMeta.find(
        (item) => item.category === 'base_consonant' || item.category === 'independent_vowel'
      )?.char?.codePointAt(0) ?? null;
      const baseComp = pickBaseComponent(glyph.components, comboBaseCP, charMeta);
      const baseMeta = charMeta.find(
        (item) =>
          item.category === 'base_consonant' || item.category === 'independent_vowel'
      );

      const parts = [];

      if (baseMeta) {
        parts.push({
          partId: `${glyph.id}-base`,
          component: baseComp,
          char: baseMeta.char,
          category: baseMeta.category,
          color: getColorForCategory(baseMeta.category, baseMeta.char),
          zone: 'combo_base',
          hbGlyphId: baseComp?.hbGlyphId,
        });
      }

      const subscriptComponents = glyph.components.filter((c) => c !== baseComp);
      subscriptComponents.forEach((comp, idx) => {
        parts.push({
          partId: `${glyph.id}-subscript-${idx}`,
          component: comp,
          char: subscriptMeta.char,
          category: subscriptMeta.category,
          color: getColorForCategory(subscriptMeta.category, subscriptMeta.char),
          zone: 'combo_subscript',
          hbGlyphId: comp?.hbGlyphId,
        });
      });

      if (baseComp?.bb) {
        const bb = baseComp.bb;
        const bbWidth = Math.max(0, (bb.x2 || 0) - (bb.x1 || 0));
        const bbHeight = Math.max(0, (bb.y2 || 0) - (bb.y1 || 0));
        const vowelWidth = Math.max(120, bbWidth * 0.3);
        const baseClipWidth = Math.max(0, bbWidth - vowelWidth);

        if (parts[0]) {
          parts[0].clipRect = {
            x: bb.x1,
            y: bb.y1,
            width: baseClipWidth,
            height: bbHeight,
          };
        }

        parts.push({
          partId: `${glyph.id}-vowel`,
          component: baseComp,
          char: vowelMeta.char,
          category: vowelMeta.category,
          color: getColorForCategory(vowelMeta.category, vowelMeta.char),
          zone: 'combo_vowel',
          hbGlyphId: baseComp?.hbGlyphId,
          clipRect: {
            x: bb.x1 + baseClipWidth,
            y: bb.y1,
            width: vowelWidth,
            height: bbHeight,
          },
        });
      }

      console.log('[MAPPER] Created', parts.length, 'parts with combo rule');
      return parts;
    }
  }

  // ── Лигатуры с ា и другими зависимыми гласными ──────────────────────────
  const diacriticCategories = new Set(['diacritic_sign', 'diacritic']);
  const mainCharMeta = charMeta.filter((m) => !diacriticCategories.has(m.category));

  const hasBase = mainCharMeta.some(
    (item) => item.category === 'base_consonant' || item.category === 'independent_vowel'
  );
  const hasDependent = mainCharMeta.some((item) => item.category === 'dependent_vowel');

  const useAreaMapping =
    hasBase &&
    hasDependent &&
    glyph.components.length >= 2 &&
    glyph.components.length <= 6 &&
    mainCharMeta.length === 2;

  const baseMeta = mainCharMeta.find(
    (item) => item.category === 'base_consonant' || item.category === 'independent_vowel'
  );
  const dependentMeta = mainCharMeta.find((item) => item.category === 'dependent_vowel');

  let parts = [];

  if (useAreaMapping && baseMeta && dependentMeta) {
    // Определяем базовый компонент по glyphId из метрик (надёжнее, чем по площади)
    const ligBaseCP = baseMeta?.char?.codePointAt(0) ?? null;
    const baseComponent = pickBaseComponent(glyph.components, ligBaseCP, charMeta);
    const dependentComponent = glyph.components.find(c => c !== baseComponent) || null;

    const vowelCode = dependentMeta?.char?.codePointAt(0);
    const isAALigature =
      vowelCode === 0x17B6 &&
      (!dependentComponent ||
        getComponentArea(dependentComponent) < getComponentArea(baseComponent) * 0.4);

    const isDependentEmpty =
      dependentComponent && (!dependentComponent.d || dependentComponent.d === '');

    const forceSplit =
      shouldSplitBaseForDependentVowel(dependentMeta?.char) ||
      isAALigature ||
      isDependentEmpty;

    const hasBaseBB = !!baseComponent?.bb;

    if (forceSplit && hasBaseBB) {
      console.log(
        '[MAPPER] ✅ USING SPLIT LOGIC (AA ligature or other):',
        dependentMeta.char
      );

      const bb = baseComponent.bb;
      const bbWidth = Math.max(0, (bb.x2 || 0) - (bb.x1 || 0));
      const bbHeight = Math.max(0, (bb.y2 || 0) - (bb.y1 || 0));

      // Ширина хвоста ា — берём из реальных метрик шрифта (delta.right).
      // delta.right измеряется как: bbox(ក+ា).x2 - bbox(ក).x2, т.е. сколько
      // правее базовой согласной выступает гласная. Это точно и не зависит от шрифта.
      // Если метрик нет — fallback 35% ширины базы.
      const vowelMetricsForSplit = getVowelMetrics(vowelCode);
      const metricsTailWidth = vowelMetricsForSplit?.delta?.right;
      const tailWidth = (metricsTailWidth != null && metricsTailWidth > 10)
        ? Math.max(50, metricsTailWidth)
        : Math.max(120, bbWidth * 0.35);
      const baseClipWidth = Math.max(0, bbWidth - tailWidth);

      // Для AA-лигатуры база обрезается геометрически (хвост ា вправо).
      // Для многокомпонентных гласных (ឿ, ើ) у базы отдельный компонент
      // со своим bb — используем его полностью.
      const baseIsAlone = glyph.components.filter(c => c !== baseComponent).length === 0;
      const baseClipRect = (isAALigature || baseIsAlone)
        ? { x: bb.x1, y: bb.y1, width: baseClipWidth, height: bbHeight }
        : { x: bb.x1, y: bb.y1, width: bbWidth, height: bbHeight };

      parts.push({
        partId: `${glyph.id}-base-main`,
        component: baseComponent,
        char: baseMeta.char,
        category: baseMeta.category,
        color: getColorForCategory(baseMeta.category, baseMeta.char),
        zone: 'split_base',
        hbGlyphId: baseComponent?.hbGlyphId,
        clipRect: baseClipRect,
      });

      // Геометрический trailing нужен только для AA-лигатур (ា слитная с базой).
      // Для многокомпонентных гласных (ឿ, ើ, ៀ) правый компонент придёт
      // из sortedNonBase ниже и получит реальный clipRect из своего bb.
      const nonBaseCount = glyph.components.filter((c) => c !== baseComponent).length;
      const needsGeometricTrailing = isAALigature || nonBaseCount === 0;

      if (needsGeometricTrailing) {
        parts.push({
          partId: `${glyph.id}-vowel-trailing`,
          component: baseComponent,
          char: dependentMeta.char,
          category: dependentMeta.category,
          color: getColorForCategory(dependentMeta.category, dependentMeta.char),
          zone: 'split_vowel_trailing',
          hbGlyphId: baseComponent?.hbGlyphId,
          clipRect: {
            x: bb.x1 + baseClipWidth,
            y: bb.y1,
            width: tailWidth,
            height: bbHeight,
          },
        });
      }

      if (!isAALigature) {
        // FIX C: Различаем LEFT-компоненты (ឿ левая, ើ левая, ៀ левая)
        // и RIGHT-компоненты (ឿ правая и т.п.) по X-позиции относительно базы.
        // baseComponent.x — позиция базы в пространстве глифа.
        const baseX = baseComponent?.x ?? (baseComponent?.bb?.x1 ?? 0);
        const nonBaseComponents = glyph.components.filter((c) => c !== baseComponent);

        // Сортируем по X чтобы left-компоненты шли первыми
        const sortedNonBase = [...nonBaseComponents].sort((a, b) => {
          const ax = a.x ?? a.bb?.x1 ?? 0;
          const bx = b.x ?? b.bb?.x1 ?? 0;
          return ax - bx;
        });

        let spliceIdx = 1; // вставляем после split_base
        sortedNonBase.forEach((comp) => {
          const compX = comp.x ?? comp.bb?.x1 ?? 0;
          const compBBCenterX = comp.bb ? (comp.bb.x1 + comp.bb.x2) / 2 : compX;
          const baseBBCenterX = baseComponent.bb
            ? (baseComponent.bb.x1 + baseComponent.bb.x2) / 2
            : baseX;

          // Компонент слева от центра базы → LEFT (leading), справа → RIGHT (trailing)
          const isLeftComp = compBBCenterX < baseBBCenterX;
          const compClipRect = comp?.bb
            ? { x: comp.bb.x1, y: comp.bb.y1,
                width: Math.max(0, comp.bb.x2 - comp.bb.x1),
                height: Math.max(0, comp.bb.y2 - comp.bb.y1) }
            : null;

          if (isLeftComp) {
            // Левая часть гласной — вставляем перед базой
            parts.splice(spliceIdx, 0, {
              partId: `${glyph.id}-vowel-left-${spliceIdx}`,
              component: comp,
              char: dependentMeta.char,
              category: dependentMeta.category,
              color: getColorForCategory(dependentMeta.category, dependentMeta.char),
              zone: 'split_vowel_leading',
              hbGlyphId: comp?.hbGlyphId,
              clipRect: compClipRect,
            });
            spliceIdx++;
          } else {
            // Правая часть гласной — добавляем в конец (после trailing)
            parts.push({
              partId: `${glyph.id}-vowel-right-${spliceIdx}`,
              component: comp,
              char: dependentMeta.char,
              category: dependentMeta.category,
              color: getColorForCategory(dependentMeta.category, dependentMeta.char),
              zone: 'split_vowel_trailing',
              hbGlyphId: comp?.hbGlyphId,
              clipRect: compClipRect,
            });
          }
        });
      }

      const otherMeta = charMeta.filter((m) => diacriticCategories.has(m.category));
      otherMeta.forEach((meta) => {
        const comp = pickComponentForCategory(glyph, meta.category, meta.unitIdx, charMeta);
        parts.push({
          partId: `${glyph.id}-mark-${meta.unitIdx}`,
          component: comp,
          char: meta.char,
          category: meta.category,
          color: getColorForCategory(meta.category, meta.char),
          zone: 'mark',
          hbGlyphId: comp?.hbGlyphId,
        });
      });

      console.log('[MAPPER] Created split parts:', parts.length);
      return parts;
    }
  }

  // ── Default mapping ───────────────────────────────────────────────────────
  console.log('[MAPPER] → Using simple mapping (no split)');

  for (const metaItem of charMeta) {
    const { char, unitIdx, category } = metaItem;

    const isComplexVowel =
      category === 'dependent_vowel' && shouldSplitBaseForDependentVowel(char);

    let component = null;
    if (
      useAreaMapping &&
      (category === 'base_consonant' || category === 'independent_vowel')
    ) {
      const componentsByArea = [...glyph.components].sort((a, b) =>
        getComponentArea(b) - getComponentArea(a)
      );
      component = componentsByArea[0];
    } else if (useAreaMapping && category === 'dependent_vowel') {
      const componentsByArea = [...glyph.components].sort((a, b) =>
        getComponentArea(b) - getComponentArea(a)
      );
      component = componentsByArea[1] || null;
    } else {
      component = pickComponentForCategory(glyph, category, unitIdx, charMeta);
    }

    if (useAreaMapping && isComplexVowel) {
      const dependentComponents = glyph.components.filter((c) => {
        const componentsByArea = [...glyph.components].sort((a, b) =>
          getComponentArea(b) - getComponentArea(a)
        );
        return c !== componentsByArea[0];
      });

      console.log(
        '[MAPPER] Complex vowel detected:',
        char,
        '- creating',
        dependentComponents.length,
        'parts'
      );

      dependentComponents.forEach((comp, idx) => {
        parts.push({
          partId: `${glyph.id}-${unitIdx}-dep${idx}`,
          component: comp,
          char,
          category,
          color: getColorForCategory(category, char),
          zone: 'component_multi',
          hbGlyphId: comp?.hbGlyphId,
        });
      });
    } else {
      parts.push({
        partId: `${glyph.id}-${unitIdx}`,
        component,
        char,
        category,
        color: getColorForCategory(category, char),
        zone: 'component',
        hbGlyphId: component?.hbGlyphId,
      });
    }
  }

  return parts;
}

function mapSingleGlyphToParts(glyph, units, enableSegmentation) {
  // 1. Если есть компоненты от сервера — используем их (самый точный вариант)
  if (glyph.components && glyph.components.length > 0) {
    return getComponentBasedParts(glyph, units, enableSegmentation);
  }

  // 2. Глиф слитный (нет компонентов) — Topology Strategy
  if (!enableSegmentation) {
    return [createFullGlyphPart(glyph)];
  }

  const glyphCps = new Set(glyph.codePoints || []);

  const relevantUnits = units.filter((u) =>
    (u.codePoints || []).some((cp) => glyphCps.has(cp))
  );

  if (relevantUnits.length === 0) {
    return [createFullGlyphPart(glyph)];
  }

  // ── v3: явно передаём codepoint базовой согласной ────────────────────────
  const baseUnit = relevantUnits.find(
    (u) => u.category === 'base_consonant' || u.category === 'independent_vowel'
  );
  const baseCP = baseUnit?.codePoints?.[0] ?? null;

  // bbox глифа приходит в формате { x1, y1, x2, y2 } — конвертируем для getTopologyZones
  const rawBB = glyph.bb || { x1: 0, y1: 0, x2: 500, y2: 500 };

  const zones = getTopologyZones(
    rawBB,
    relevantUnits.map((u) => ({ char: u.text, category: u.category, codePoints: u.codePoints })),
    baseCP  // ← якорь на базовую согласную
  );

  const parts = [];
  const leftCodes = [0x17C1, 0x17C2, 0x17C3, 0x17BE, 0x17BF, 0x17C0, 0x17C4, 0x17C5];

  relevantUnits.forEach((unit, idx) => {
    const cat = unit.category;
    const cp = unit.codePoints[0];
    let targetZone = null;

    if (cp === 0x17B6 || cp === 0x17C7) {
      targetZone = zones.RIGHT;
    } else if (leftCodes.includes(cp)) {
      targetZone = zones.LEFT;
    } else if (
      cat === 'subscript_consonant' ||
      cat === 'coeng' ||
      cp === 0x17BB ||
      cp === 0x17BC
    ) {
      targetZone = zones.BOTTOM;
    } else if (
      cat === 'diacritic_sign' ||
      cat === 'diacritic' ||
      cat === 'dependent_vowel'
    ) {
      targetZone = zones.TOP;
    } else if (cat === 'base_consonant' || cat === 'independent_vowel') {
      targetZone = zones.BASE;
    }

    if (targetZone) {
      parts.push({
        partId: `${glyph.id}-geo-${idx}`,
        component: null,
        char: unit.text,
        category: cat,
        color: getColorForCategory(cat, unit.text),
        zone: 'topology_split',
        pathData: glyph.d,
        clipRect: targetZone,
      });
    }
  });

  return parts;
}

export function mapGlyphsToParts(glyphs, units, { enableSegmentation = true } = {}) {
  return (glyphs || []).map((glyph) => ({
    ...glyph,
    parts: mapSingleGlyphToParts(glyph, units, enableSegmentation),
  }));
}