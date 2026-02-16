import { createClipPathParts } from './simpleGlyphSplit.js';
import { getKhmerGlyphCategory } from './khmerClassifier.js';
import {
  getColorForCategory,
  shouldSplitBaseForDependentVowel,
  getSubscriptVowelRule
} from './glyphCombinationRules.js';
import { getTopologyZones } from './topologyLayout.js';

/**
 * v2 goals:
 * 1) Keep existing behavior for most glyphs.
 * 2) Fix narrow stacked cases (e.g. ខ្ញុំ) with strict guards.
 * 3) Avoid global regressions on level 1.
 */

const ENABLE_NARROW_STACKED_MODE = false;

/**
 * Optional emergency word-level override:
 * add problematic clusters here if needed during rollout.
 * Use exact cluster text (from relevantUnits joined).
 */
const STACKED_CLUSTER_WHITELIST = new Set([
  // 'ខ្ញុំ',
]);

/**
 * If a cluster appears here, narrow stacked mode will be skipped.
 * Useful when a specific cluster regresses.
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

function getClusterText(charMeta) {
  return (charMeta || []).map((m) => m?.char || '').join('');
}

function cpOf(ch) {
  return ch ? ch.codePointAt(0) : null;
}

/**
 * Narrow stacked layout for merged Khmer cluster:
 * base + coeng + subscript + lower dependent vowel + top diacritic
 * (typical: ខ្ញុំ)
 */
function buildStackedClusterParts(glyph, charMeta) {
  const mainComp = pickLargestComponent(glyph.components || []);
  if (!mainComp?.bb) return null;

  const bb = mainComp.bb;
  const x1 = bb.x1 || 0;
  const y1 = bb.y1 || 0;
  const x2 = bb.x2 || 0;
  const y2 = bb.y2 || 0;

  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  if (w <= 0 || h <= 0) return null;

  // Vertical zones tuned to stacked Khmer shapes
  const topH = Math.max(40, h * 0.22);          // top diacritics (ំ etc.)
  const midH = Math.max(60, h * 0.38);          // base consonant
  const lowH = Math.max(60, h - topH - midH);   // subscript / lower vowel

  const yTop = y1;
  const yMid = yTop + topH;
  const yLow = yMid + midH;

  // Left slice of low zone for coeng sign
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
      // lower dependent vowel (ុ / ូ) in low center-right area
      clipRect = {
        x: x1 + Math.max(0, w * 0.35),
        y: yLow,
        width: Math.max(40, w * 0.45),
        height: lowH
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
      color: getColorForCategory(category),
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
  const baseCandidate = byAreaDesc[0] || components[0];
  const markCandidate = [...components].sort((a, b) => {
    if ((a.advance || 0) !== (b.advance || 0)) return (a.advance || 0) - (b.advance || 0);
    return getComponentArea(a) - getComponentArea(b);
  })[0] || components[components.length - 1];

  const hasDiacritic = charMeta.some((item) => item.category === 'diacritic_sign' || item.category === 'diacritic');
  const hasSubscript = charMeta.some((item) => item.category === 'subscript_consonant');

  if (category === 'base_consonant' || category === 'independent_vowel') {
    return baseCandidate;
  }

  if (category === 'dependent_vowel') {
    // v2 fix: do not force dependent vowel onto base when stacked/subscript exists
    if (hasSubscript) {
      const nonBase = components.find((c) => c !== baseCandidate);
      if (nonBase) return nonBase;
    }
    // default: keep selecting a non-dominant component when possible
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
  console.log('[MAPPER] Components have bb?', glyph.components?.map(c => ({
    id: c.hbGlyphId,
    hasBB: !!c.bb,
    bb: c.bb
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
    const hasGlyphRange = Number.isInteger(glyph?.clusterStart) && Number.isInteger(glyph?.clusterEnd);

    if (!hasUnitRange || !hasGlyphRange) return codePointHit;

    const isInCluster = u.sourceStart < glyph.clusterEnd && u.sourceEnd > glyph.clusterStart;
    return codePointHit && isInCluster;
  });

  console.log('[MAPPER] Relevant units:', relevantUnits.map(u => ({ text: u.text, category: u.category })));

  const charMeta = relevantUnits.map((unit, unitIdx) => ({
    char: unit.text,
    unitIdx,
    unit,
    category: unit.category,
  }));

  console.log('[MAPPER] Char meta from units:', charMeta);

  // --- NARROW STACKED MODE (v2) ---
  if (ENABLE_NARROW_STACKED_MODE) {
    const clusterText = getClusterText(charMeta);

    const comps = glyph.components || [];
    const componentsByArea = [...comps].sort((a, b) => getComponentArea(b) - getComponentArea(a));
    const biggest = componentsByArea[0];
    const second = componentsByArea[1];

    const biggestArea = getComponentArea(biggest);
    const secondArea = getComponentArea(second);

    // merged-shape heuristic: one dominant component
    const isMergedShape =
      comps.length <= 3 &&
      biggestArea > 0 &&
      (secondArea === 0 || biggestArea / Math.max(1, secondArea) >= 2.2);

    const depMeta = charMeta.find((m) => m.category === 'dependent_vowel');
    const depCp = cpOf(depMeta?.char);

    // lower dependent vowels where stacked conflicts are common
    const LOWER_DEP_VOWELS = new Set([
      0x17BB, // ុ
      0x17BC, // ូ
    ]);

    const hasBase =
      hasCategory(charMeta, 'base_consonant') ||
      hasCategory(charMeta, 'independent_vowel');
    const hasCoeng = hasCategory(charMeta, 'coeng');
    const hasSub = hasCategory(charMeta, 'subscript_consonant');
    const hasTopMark =
      hasCategory(charMeta, 'diacritic_sign') ||
      hasCategory(charMeta, 'diacritic');

    const inWhitelist = STACKED_CLUSTER_WHITELIST.size === 0 || STACKED_CLUSTER_WHITELIST.has(clusterText);
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
          charMeta.map(m => `${m.char}:${m.category}`).join(' | '),
          { clusterText, biggestArea, secondArea, ratio: biggestArea / Math.max(1, secondArea) }
        );
        return stackedParts;
      }
    }
  }

  // --- Subscript + vowel combo rule (existing logic) ---
  const subscriptMeta = charMeta.find(item => item.category === 'subscript_consonant');
  const vowelMeta = charMeta.find(item => item.category === 'dependent_vowel');
  const comboRule = subscriptMeta && vowelMeta
    ? getSubscriptVowelRule(subscriptMeta.char, vowelMeta.char)
    : null;

  if (comboRule) {
    console.log('[MAPPER] ✨ COMBO RULE DETECTED:', comboRule.description);

    if (comboRule.splitMode === 'three-way' && glyph.components.length >= 2) {
      const componentsByArea = [...glyph.components].sort((a, b) =>
        getComponentArea(b) - getComponentArea(a)
      );

      const baseComp = componentsByArea[0];
      const baseMeta = charMeta.find(item =>
        item.category === 'base_consonant' || item.category === 'independent_vowel'
      );

      const parts = [];

      if (baseMeta) {
        parts.push({
          partId: `${glyph.id}-base`,
          component: baseComp,
          char: baseMeta.char,
          category: baseMeta.category,
          color: getColorForCategory(baseMeta.category),
          zone: 'combo_base',
          hbGlyphId: baseComp?.hbGlyphId,
        });
      }

      const subscriptComponents = glyph.components.filter(c => c !== baseComp);
      subscriptComponents.forEach((comp, idx) => {
        parts.push({
          partId: `${glyph.id}-subscript-${idx}`,
          component: comp,
          char: subscriptMeta.char,
          category: subscriptMeta.category,
          color: getColorForCategory(subscriptMeta.category),
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
          color: getColorForCategory(vowelMeta.category),
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

  // --- Existing logic for ligatures with ា and other dependent vowels ---
  const diacriticCategories = new Set(['diacritic_sign', 'diacritic']);
  const mainCharMeta = charMeta.filter(m => !diacriticCategories.has(m.category));

  const hasBase = mainCharMeta.some(item => item.category === 'base_consonant' || item.category === 'independent_vowel');
  const hasDependent = mainCharMeta.some(item => item.category === 'dependent_vowel');

  const useAreaMapping = hasBase && hasDependent &&
    glyph.components.length >= 2 && glyph.components.length <= 6 &&
    mainCharMeta.length === 2;

  const baseMeta = mainCharMeta.find(item => item.category === 'base_consonant' || item.category === 'independent_vowel');
  const dependentMeta = mainCharMeta.find(item => item.category === 'dependent_vowel');

  let parts = [];

  if (useAreaMapping && baseMeta && dependentMeta) {
    const componentsByArea = [...glyph.components].sort((a, b) =>
      getComponentArea(b) - getComponentArea(a)
    );

    const baseComponent = componentsByArea[0];
    const dependentComponent = componentsByArea[1] || null;

    // AA ligature (U+17B6)
    const vowelCode = dependentMeta?.char?.codePointAt(0);
    const isAALigature = vowelCode === 0x17B6 &&
      (!dependentComponent || getComponentArea(dependentComponent) < getComponentArea(baseComponent) * 0.4);

    const isDependentEmpty = dependentComponent && (!dependentComponent.d || dependentComponent.d === '');

    const forceSplit = shouldSplitBaseForDependentVowel(dependentMeta?.char) ||
      isAALigature ||
      isDependentEmpty;

    const hasBaseBB = !!baseComponent?.bb;

    if (forceSplit && hasBaseBB) {
      console.log('[MAPPER] ✅ USING SPLIT LOGIC (AA ligature or other):', dependentMeta.char);

      const bb = baseComponent.bb;
      const bbWidth = Math.max(0, (bb.x2 || 0) - (bb.x1 || 0));
      const bbHeight = Math.max(0, (bb.y2 || 0) - (bb.y1 || 0));
      const tailWidth = Math.max(120, bbWidth * 0.35);
      const baseClipWidth = Math.max(0, bbWidth - tailWidth);

      // Base (left clip)
      parts.push({
        partId: `${glyph.id}-base-main`,
        component: baseComponent,
        char: baseMeta.char,
        category: baseMeta.category,
        color: getColorForCategory(baseMeta.category),
        zone: 'split_base',
        hbGlyphId: baseComponent?.hbGlyphId,
        clipRect: {
          x: bb.x1,
          y: bb.y1,
          width: baseClipWidth,
          height: bbHeight,
        },
      });

      // Trailing vowel (right clip)
      parts.push({
        partId: `${glyph.id}-vowel-trailing`,
        component: baseComponent,
        char: dependentMeta.char,
        category: dependentMeta.category,
        color: getColorForCategory(dependentMeta.category),
        zone: 'split_vowel_trailing',
        hbGlyphId: baseComponent?.hbGlyphId,
        clipRect: {
          x: bb.x1 + baseClipWidth,
          y: bb.y1,
          width: tailWidth,
          height: bbHeight,
        },
      });

      // Leading vowel parts (if not AA ligature)
      if (!isAALigature) {
        const leadingComponents = glyph.components.filter(c => c !== baseComponent);
        leadingComponents.forEach((comp, idx) => {
          parts.splice(1 + idx, 0, {
            partId: `${glyph.id}-vowel-leading-${idx}`,
            component: comp,
            char: dependentMeta.char,
            category: dependentMeta.category,
            color: getColorForCategory(dependentMeta.category),
            zone: 'split_vowel_leading',
            hbGlyphId: comp?.hbGlyphId,
          });
        });
      }

      // Diacritics separately
      const otherMeta = charMeta.filter(m => diacriticCategories.has(m.category));
      otherMeta.forEach(meta => {
        const comp = pickComponentForCategory(glyph, meta.category, meta.unitIdx, charMeta);
        parts.push({
          partId: `${glyph.id}-mark-${meta.unitIdx}`,
          component: comp,
          char: meta.char,
          category: meta.category,
          color: getColorForCategory(meta.category),
          zone: 'mark',
          hbGlyphId: comp?.hbGlyphId,
        });
      });

      console.log('[MAPPER] Created split parts:', parts.length);
      return parts;
    }
  }

  // --- Default mapping ---
  console.log('[MAPPER] → Using simple mapping (no split)');

  for (const metaItem of charMeta) {
    const { char, unitIdx, category } = metaItem;

    const isComplexVowel =
      category === 'dependent_vowel' &&
      shouldSplitBaseForDependentVowel(char);

    let component = null;
    if (useAreaMapping && (category === 'base_consonant' || category === 'independent_vowel')) {
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
      const dependentComponents = glyph.components.filter(c => {
        const componentsByArea = [...glyph.components].sort((a, b) =>
          getComponentArea(b) - getComponentArea(a)
        );
        return c !== componentsByArea[0];
      });

      console.log('[MAPPER] Complex vowel detected:', char, '- creating', dependentComponents.length, 'parts');

      dependentComponents.forEach((comp, idx) => {
        parts.push({
          partId: `${glyph.id}-${unitIdx}-dep${idx}`,
          component: comp,
          char,
          category,
          color: getColorForCategory(category),
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
        color: getColorForCategory(category),
        zone: 'component',
        hbGlyphId: component?.hbGlyphId,
      });
    }
  }

  return parts;
}

// ... внутри glyphPartMapper.js ...

function mapSingleGlyphToParts(glyph, units, enableSegmentation) {
  // 1. Если есть компоненты от сервера — используем их (это План А, самый точный)
  if (glyph.components && glyph.components.length > 0) {
     // Тут вызывается старая логика getComponentBasedParts
     // Оставь её как есть, она хороша для разборных глифов
     return getComponentBasedParts(glyph, units, enableSegmentation);
  }

  // 2. ПЛАН Б: Глиф слитный (нет компонентов).
  // Включаем нашу новую Topology Strategy.

  if (!enableSegmentation) {
    return [createFullGlyphPart(glyph)];
  }

  // Получаем метаданные (какие буквы внутри этого глифа)
  const glyphCps = new Set(glyph.codePoints || []);

  // Фильтруем юниты, которые относятся к этому глифу
  const relevantUnits = units.filter((u) => {
    // Простая проверка по вхождению codepoint
    return (u.codePoints || []).some(cp => glyphCps.has(cp));
  });

  if (relevantUnits.length === 0) {
      // Если не нашли юнитов, возвращаем весь глиф
      return [createFullGlyphPart(glyph)];
  }

  // Генерируем зоны нарезки
  const zones = getTopologyZones(glyph.bb || { x:0, y:0, width: 500, height: 500 }, relevantUnits.map(u => ({ char: u.text, category: u.category })));
  const parts = [];

  relevantUnits.forEach((unit, idx) => {
    const cat = unit.category;
    const cp = unit.codePoints[0];
    let targetZone = null;

    // Маппинг категорий на зоны Topology
    if (cp === 0x17B6 || cp === 0x17C7) { // ា или ះ
      targetZone = zones.RIGHT;
    } else if (cat === 'base_consonant' || cat === 'independent_vowel') {
      targetZone = zones.BASE;
    } else if (cat === 'subscript_consonant' || cat === 'coeng' || cp === 0x17BB || cp === 0x17BC) {
      targetZone = zones.BOTTOM;
    } else if (cat === 'diacritic_sign' || cat === 'diacritic' || cat === 'dependent_vowel') {
      targetZone = zones.TOP;
    }

    // Если зона нашлась — создаем часть
    if (targetZone) {
      parts.push({
        partId: `${glyph.id}-geo-${idx}`,
        component: null, // Это геометрическая нарезка, компонента нет
        char: unit.text,
        category: cat,
        color: getColorForCategory(cat),
        zone: 'topology_split',
        pathData: glyph.d, // Рисуем весь путь...
        clipRect: targetZone // ...но показываем только кусочек через clipRect
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
