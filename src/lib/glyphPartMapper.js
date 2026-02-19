import { createClipPathParts, getTopologyZones } from './simpleGlyphSplit.js';
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
 *
 * v4 fixes:
 * 5) Filter ghost/UNKNOWN/empty parts.
 * 6) Normalize zones for component/direct parts to semantic zones.
 * 7) Auto-add clipRect from component.bb where possible.
 * 8) Stabilize coeng+subscript chains (e.g. ន្ត្រ) with deterministic non-base allocation.
 *
 * v5 (current):
 * 9) Right-part splitting for dependent vowels (ា, ៅ, ោ) now uses a percentage
 *    of the base glyph's height. Default 35%, but reduced to 20% when a subscript
 *    consonant is present (to keep the vowel visually attached to the subscript).
 *
 * v6 fix:
 * 10) When a base consonant and a subscript consonant belong to different glyphs
 *     (e.g. ញ + ្ញ), the base is now clipped to its body area so that it does not
 *     overlap the subscript. This uses cluster‑wide detection of subscript consonants.
 */

const ENABLE_NARROW_STACKED_MODE = true;

/**
 * Optional emergency word-level override:
 * add problematic clusters here if needed during rollout.
 */
const STACKED_CLUSTER_WHITELIST = new Set([
  // 'ខ្ញុំ',
  'ញ្ញុំ', 'តោ', 'ន្ត្រា', 'ក្សា'
]);

/**
 * If a cluster appears here, narrow stacked mode will be skipped.
 */
const STACKED_CLUSTER_BLACKLIST = new Set([
  // '...'
]);

// v5: right‑tail width is a percentage of the base glyph's height.
// Default factor (no subscript) = 0.35 (35%).
// When a subscript consonant is present, use a smaller factor = 0.20.
const DEFAULT_TAIL_HEIGHT_FACTOR = 0.35;
const SUBSCRIPT_TAIL_HEIGHT_FACTOR = 0.20;

// Still used for subscript clipping (unchanged)
const SUBSCRIPT_WIDTH_MULTIPLIER = 1.2;
const SUBSCRIPT_CLAMP_FRACTION = 0.8;

/**
 * Returns the desired width for the right tail (vowel part) based on the
 * given height of the base component and whether a subscript is present.
 */
function getDesiredTailWidthFromHeight(height, hasSubscript) {
  const factor = hasSubscript ? SUBSCRIPT_TAIL_HEIGHT_FACTOR : DEFAULT_TAIL_HEIGHT_FACTOR;
  return Math.max(24, Math.floor(height * factor));
}

/**
 * Simple splitter: given total width and desired tail width,
 * returns base width and tail width (tail cannot exceed total width).
 */
function splitByDesiredTailWidth(totalWidth, desiredTailWidth) {
  const width = Math.max(0, totalWidth);
  if (width <= 0) return { baseClipWidth: 0, tailWidth: 0 };
  const tail = Math.min(width, Math.max(0, desiredTailWidth));
  const base = width - tail;
  return { baseClipWidth: base, tailWidth: tail };
}

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

function getComponentRightEdge(comp) {
  const penX = Number.isFinite(comp?.x) ? comp.x : 0;
  if (comp?.bb && Number.isFinite(comp.bb.x2)) return penX + comp.bb.x2;
  return penX;
}

function pickBaseForCoengRightSplit(components, consonantCP) {
  const list = (components || []).filter((c) => c?.bb);
  if (!list.length) return null;
  if (list.length === 1) return list[0];

  if (consonantCP != null) {
    const metrics = getRawMetrics();
    const knownGlyphId = metrics?.consonants?.[consonantCP]?.glyphId;
    if (knownGlyphId != null) {
      const byGlyph = list.find((c) => c.hbGlyphId === knownGlyphId);
      if (byGlyph) return byGlyph;
    }
  }

  return [...list].sort((a, b) => {
    const dy = getComponentCenterY(a) - getComponentCenterY(b);
    if (dy !== 0) return dy;
    return getComponentArea(b) - getComponentArea(a);
  })[0] || list[0];
}

function hasCategory(meta, cat) {
  return meta.some((m) => m.category === cat);
}

function pickLargestComponent(components) {
  if (!components?.length) return null;
  return [...components].sort((a, b) => getComponentArea(b) - getComponentArea(a))[0] || components[0];
}

function getComponentLeftEdge(comp) {
  const penX = Number.isFinite(comp?.x) ? comp.x : 0;
  if (comp?.bb && Number.isFinite(comp.bb.x1)) return penX + comp.bb.x1;
  return penX;
}

function getComponentCenterX(comp) {
  const penX = Number.isFinite(comp?.x) ? comp.x : 0;
  if (comp?.bb && Number.isFinite(comp.bb.x1) && Number.isFinite(comp.bb.x2)) {
    return penX + (comp.bb.x1 + comp.bb.x2) / 2;
  }
  return penX;
}

// ─── Классификация зависимых гласных и диакритик по зонам ──────────────────
const VOWEL_ZONES = {
  0x17B6: ['RIGHT'],
  0x17B7: ['TOP'],
  0x17B8: ['TOP'],
  0x17B9: ['TOP'],
  0x17BA: ['TOP'],
  0x17BB: ['BOTTOM'],
  0x17BC: ['BOTTOM'],
  0x17BD: ['BOTTOM'],
  0x17BE: ['LEFT', 'TOP'],
  0x17BF: ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'],
  0x17C0: ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'],
  0x17C1: ['LEFT'],
  0x17C2: ['LEFT'],
  0x17C3: ['LEFT'],
  0x17C4: ['LEFT', 'RIGHT'],
  0x17C5: ['LEFT', 'RIGHT'],
  0x17C6: ['TOP'],
  0x17C7: ['RIGHT'],
  0x17C8: ['RIGHT'],
  0x17C9: ['TOP'],
  0x17CA: ['TOP'],
  0x17CB: ['TOP'],
  0x17CC: ['TOP'],
  0x17CD: ['TOP'],
  0x17CE: ['TOP'],
  0x17CF: ['TOP'],
  0x17D0: ['TOP'],
  0x17D1: ['TOP'],
  0x17D3: ['TOP'],
  0x17DD: ['TOP'],
};

function getVowelZones(cp) {
  return VOWEL_ZONES[cp] || ['RIGHT'];
}

const HAS_LEFT_COMPONENT = new Set(
  Object.entries(VOWEL_ZONES)
    .filter(([, zones]) => zones.includes('LEFT'))
    .map(([cp]) => Number(cp))
);

function hasPrepositive(charMeta) {
  return (charMeta || []).some(m => {
    const cp = m?.char?.codePointAt(0) ?? m?.unit?.codePoints?.[0];
    return HAS_LEFT_COMPONENT.has(cp);
  });
}

function pickBaseComponent(components, consonantCP, charMeta) {
  if (!components?.length) return null;
  if (components.length === 1) return components[0];

  if (consonantCP != null) {
    const metrics = getRawMetrics();
    const knownGlyphId = metrics?.consonants?.[consonantCP]?.glyphId;
    if (knownGlyphId != null) {
      const match = components.find(c => c.hbGlyphId === knownGlyphId);
      if (match) return match;
    }
  }

  if (!hasPrepositive(charMeta)) {
    const byLeft = [...components].sort((a, b) => getComponentLeftEdge(a) - getComponentLeftEdge(b));
    return byLeft[0] || components[0];
  }

  return [...components].sort((a, b) => getComponentArea(b) - getComponentArea(a))[0] || components[0];
}

function getClusterText(charMeta) {
  return (charMeta || []).map((m) => m?.char || '').join('');
}

function cpOf(ch) {
  return ch ? ch.codePointAt(0) : null;
}

function findBaseCP(charMeta) {
  const base = (charMeta || []).find(
    (m) => m.category === 'base_consonant' || m.category === 'independent_vowel'
  );
  return cpOf(base?.char) ?? null;
}

function componentToClipRect(component, category = null) {
  if (!component?.bb) return null;
  const { x1 = 0, y1 = 0, x2 = 0, y2 = 0 } = component.bb;
  let width = Math.max(0, x2 - x1);
  if (category === 'subscript_consonant') {
    width *= SUBSCRIPT_WIDTH_MULTIPLIER;
  }
  return {
    x: x1,
    y: y1,
    width,
    height: Math.max(0, y2 - y1),
  };
}

function semanticZoneByCategoryAndCp(category, ch) {
  const cp = cpOf(ch);

  if (category === 'base_consonant' || category === 'independent_vowel') return 'BASE';
  if (category === 'coeng' || category === 'subscript_consonant') return 'BOTTOM';
  if (category === 'diacritic_sign' || category === 'diacritic') return 'TOP';

  if (category === 'dependent_vowel') {
    if (cp === 0x17BB || cp === 0x17BC || cp === 0x17BD) return 'BOTTOM';

    const zones = getVowelZones(cp);
    if (zones.includes('LEFT')) return 'LEFT';
    if (zones.includes('RIGHT')) return 'RIGHT';
    if (zones.includes('TOP')) return 'TOP';
    if (zones.includes('BOTTOM')) return 'BOTTOM';
    return 'RIGHT';
  }

  return 'UNKNOWN';
}

function normalizePart(part) {
  if (!part) return part;
  const p = { ...part };

  if (p.zone === 'component' || p.zone === 'direct' || p.zone === 'UNKNOWN' || !p.zone) {
    p.zone = semanticZoneByCategoryAndCp(p.category, p.char);
  }

  if (!p.clipRect && p.component?.bb) {
    p.clipRect = componentToClipRect(p.component, p.category);
  }

  return p;
}

function isIgnorablePart(part) {
  const ch = (part?.char ?? '').trim();
  const emptyChar = ch.length === 0;
  const unknownish = !part?.zone || part.zone === 'UNKNOWN';
  const otherCat = part?.category === 'other' || !part?.category;
  const noGeometry = !part?.component && !part?.pathData && !part?.clipRect;
  return (emptyChar && otherCat && unknownish) || (emptyChar && noGeometry);
}

function normalizeAndFilterParts(parts) {
  return (parts || [])
    .map(normalizePart)
    .filter((p) => !isIgnorablePart(p));
}

// --- The old fixed-tail-width helpers are no longer used, kept for reference ---
/*
const FIXED_TAIL_WIDTHS = {
  0x17B6: 120,
  0x17C4: 140,
  0x17C5: 130,
};

function getPreferredRightTailWidth(vowelCp, baseWidth) { ... }
function computeRightTailSplit(totalWidth, preferredTailWidth) { ... }
function computeRightBiasedTailSplit(totalWidth, preferredTailWidth) { ... }
*/

/**
 * Adjusts the clipRect of a base consonant (or independent vowel) part
 * to the body area if a subscript consonant exists anywhere in the same cluster.
 * This prevents overlapping between the base and a subscript that lives in a separate glyph.
 */
function adjustBaseClipRect(part, clusterHasSubscript) {
  if (!clusterHasSubscript) return part;
  if (!(part.category === 'base_consonant' || part.category === 'independent_vowel')) return part;
  if (!part.component?.bb) return part;

  const baseCP = part.char?.codePointAt(0) ?? null;
  if (!baseCP) return part;

  const bodyRect = getConsonantBodyRect(part.component.bb, baseCP);
  if (!bodyRect || bodyRect.bodyY1 >= bodyRect.bodyY2) return part; // sanity

  let clip = part.clipRect;
  if (!clip) {
    clip = {
      x: part.component.bb.x1,
      y: bodyRect.bodyY1,
      width: Math.max(0, part.component.bb.x2 - part.component.bb.x1),
      height: bodyRect.bodyY2 - bodyRect.bodyY1,
    };
  } else {
    // preserve existing x and width, only adjust vertical
    clip.y = bodyRect.bodyY1;
    clip.height = bodyRect.bodyY2 - bodyRect.bodyY1;
  }
  part.clipRect = clip;
  return part;
}

function buildStackedClusterParts(glyph, charMeta) {
  const stackBaseCP = findBaseCP(charMeta);
  const mainComp =
    pickBaseComponent(glyph.components || [], stackBaseCP, charMeta) ||
    pickLargestComponent(glyph.components || []);
  if (!mainComp?.bb) return null;

  const bb = mainComp.bb;
  const x1 = bb.x1 || 0;
  const y1 = bb.y1 || 0;
  const x2 = bb.x2 || 0;
  const y2 = bb.y2 || 0;

  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  if (w <= 0 || h <= 0) return null;

  const baseCP = findBaseCP(charMeta);
  const bodyRect = getConsonantBodyRect({ x1, y1, x2, y2 }, baseCP);

  const bodyY1 = bodyRect.bodyY1;
  const bodyY2 = bodyRect.bodyY2;
  const bodyH = Math.max(1, bodyY2 - bodyY1);

  const yTop = y1;
  const topH = Math.max(1, bodyY1 - y1);
  const yMid = bodyY1;
  const midH = bodyH;
  const yLow = bodyY2;
  const lowH = Math.max(1, y2 - bodyY2);

  const coengW = Math.max(50, w * 0.28);
  const restW = Math.max(0, w - coengW) * SUBSCRIPT_WIDTH_MULTIPLIER;

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

function createNonBaseAllocator(components, baseCandidate) {
  const nonBase = (components || []).filter((c) => c !== baseCandidate);
  let i = 0;
  return {
    next() {
      if (!nonBase.length) return null;
      const idx = Math.min(i, nonBase.length - 1);
      i += 1;
      return nonBase[idx];
    },
    first() {
      return nonBase[0] || null;
    },
  };
}

function pickComponentForCategory(glyph, category, charIdx, charMeta, allocator) {
  const components = glyph.components || [];
  if (components.length === 0) return null;
  if (components.length === 1) return components[0];

  const metaBaseCP =
    (charMeta || []).find(m => m.category === 'base_consonant' || m.category === 'independent_vowel')
      ?.char?.codePointAt(0) ?? null;

  const baseCandidate = pickBaseComponent(components, metaBaseCP, charMeta);

  const markCandidate = [...components].sort((a, b) => {
    if ((a.advance || 0) !== (b.advance || 0)) return (a.advance || 0) - (b.advance || 0);
    return getComponentArea(a) - getComponentArea(b);
  })[0] || components[components.length - 1];

  const hasDiacritic = (charMeta || []).some(
    (item) => item.category === 'diacritic_sign' || item.category === 'diacritic'
  );
  const hasSubscript = (charMeta || []).some((item) => item.category === 'subscript_consonant');

  if (category === 'base_consonant' || category === 'independent_vowel') {
    return baseCandidate;
  }

  if (category === 'coeng' || category === 'subscript_consonant') {
    if (allocator) {
      const pick = allocator.next();
      if (pick) return pick;
    }
    const nonBase = components.find((comp) => comp !== baseCandidate);
    if (nonBase) return nonBase;
    return [...components].sort((a, b) => getComponentCenterY(a) - getComponentCenterY(b))[0];
  }

  if (category === 'dependent_vowel') {
    if (hasSubscript) {
      if (allocator) {
        const peek = allocator.first();
        if (peek) return peek;
      }
      const nonBase = components.find((c) => c !== baseCandidate);
      if (nonBase) return nonBase;
    }
    if (hasDiacritic) return components[components.length - 1] || baseCandidate;
    return components[components.length - 1] || baseCandidate;
  }

  if (category === 'diacritic_sign' || category === 'diacritic') {
    return markCandidate;
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

    const geoParts = createClipPathParts(glyph, units).map((part, idx) => ({
      ...part,
      partId: `${glyph.id}-${idx}`,
    }));
    return normalizeAndFilterParts(geoParts);
  }

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

  // --- NEW: determine if the whole cluster contains a subscript consonant ---
  const clusterUnits = (units || []).filter(u =>
    Number.isInteger(u?.sourceStart) && Number.isInteger(u?.sourceEnd) &&
    Number.isInteger(glyph?.clusterStart) && Number.isInteger(glyph?.clusterEnd) &&
    u.sourceStart < glyph.clusterEnd && u.sourceEnd > glyph.clusterStart
  );
  const clusterHasSubscript = clusterUnits.some(u => u.category === 'subscript_consonant');
  // -------------------------------------------------------------------------

  const clusterHasBase =
    charMeta.some((m) => m.category === 'base_consonant' || m.category === 'independent_vowel');

  if (!clusterHasBase && charMeta.length > 0) {
    const directParts = (glyph.components || []).map((comp, idx) => {
      const meta = charMeta.find((m) =>
        m.category === 'subscript_consonant' ||
        m.category === 'coeng' ||
        m.category === 'dependent_vowel' ||
        m.category === 'diacritic_sign' ||
        m.category === 'diacritic'
      ) || charMeta[idx] || charMeta[0];

      const part = {
        partId: `${glyph.id}-direct-${idx}`,
        component: comp,
        char: meta?.char || '',
        category: meta?.category || 'other',
        color: getColorForCategory(meta?.category || 'other', meta?.char || ''),
        zone: 'direct',
        hbGlyphId: comp?.hbGlyphId,
        clipRect: componentToClipRect(comp, meta?.category),
      };
      return part;
    });

    return normalizeAndFilterParts(directParts);
  }

  if (ENABLE_NARROW_STACKED_MODE) {
    const clusterText = getClusterText(charMeta);

    const comps = glyph.components || [];
    const componentsByArea = [...comps].sort((a, b) => getComponentArea(b) - getComponentArea(a));
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

    const LOWER_DEP_VOWELS = new Set([0x17BB, 0x17BC]);

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
        return normalizeAndFilterParts(stackedParts);
      }
    }
  }

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
        const basePart = {
          partId: `${glyph.id}-base`,
          component: baseComp,
          char: baseMeta.char,
          category: baseMeta.category,
          color: getColorForCategory(baseMeta.category, baseMeta.char),
          zone: 'combo_base',
          hbGlyphId: baseComp?.hbGlyphId,
          clipRect: componentToClipRect(baseComp, baseMeta.category),
        };
        // Apply body clipping if a subscript exists in the cluster
        adjustBaseClipRect(basePart, clusterHasSubscript);
        parts.push(basePart);
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
          clipRect: componentToClipRect(comp, subscriptMeta.category),
        });
      });

      if (baseComp?.bb) {
        const bb = baseComp.bb;
        const bbWidth = Math.max(0, (bb.x2 || 0) - (bb.x1 || 0));
        const bbHeight = Math.max(0, (bb.y2 || 0) - (bb.y1 || 0));

        // Check if subscript exists in this cluster (we already have clusterHasSubscript)
        const hasSubscript = clusterHasSubscript;
        const preferredTail = getDesiredTailWidthFromHeight(bbHeight, hasSubscript);
        const { baseClipWidth, tailWidth } = splitByDesiredTailWidth(bbWidth, preferredTail);

        if (parts[0]) {
          parts[0].clipRect = {
            x: bb.x1,
            y: bb.y1,
            width: baseClipWidth,
            height: bbHeight,
          };
          // Re-apply body clipping after width adjustment (the adjust function will preserve x/width)
          adjustBaseClipRect(parts[0], clusterHasSubscript);
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
            width: tailWidth,
            height: bbHeight,
          },
        });
      }

      console.log('[MAPPER] Created', parts.length, 'parts with combo rule');
      return normalizeAndFilterParts(parts);
    }
  }

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

      // Determine if there is a subscript consonant in the cluster
      const hasSubscript = clusterHasSubscript;
      const preferredTail = getDesiredTailWidthFromHeight(bbHeight, hasSubscript);
      const { baseClipWidth, tailWidth } = splitByDesiredTailWidth(bbWidth, preferredTail);

      // Always clip the base part to leave room for the vowel
      const baseClipRect = {
        x: bb.x1,
        y: bb.y1,
        width: baseClipWidth,
        height: bbHeight,
      };

      const basePart = {
        partId: `${glyph.id}-base-main`,
        component: baseComponent,
        char: baseMeta.char,
        category: baseMeta.category,
        color: getColorForCategory(baseMeta.category, baseMeta.char),
        zone: 'split_base',
        hbGlyphId: baseComponent?.hbGlyphId,
        clipRect: baseClipRect,
      };
      adjustBaseClipRect(basePart, clusterHasSubscript);
      parts.push(basePart);

      // Determine if this is a right-side vowel (ា, ៅ, ោ)
      const isRightVowel = vowelCode === 0x17B6 || vowelCode === 0x17C4 || vowelCode === 0x17C5;

      if (isRightVowel) {
        // For right vowels, handle left components (if any) using their own geometry,
        // and then add a geometric tail for the right part.

        const nonBaseComponents = glyph.components.filter((c) => c !== baseComponent);
        if (nonBaseComponents.length > 0) {
          const sortedNonBase = [...nonBaseComponents].sort(
            (a, b) => getComponentLeftEdge(a) - getComponentLeftEdge(b)
          );

          const vowelCp = dependentMeta?.char?.codePointAt(0);
          const vowelZones = getVowelZones(vowelCp);
          const vowelHasLeft = vowelZones.includes('LEFT');
          const baseCenterX = getComponentCenterX(baseComponent);

          let spliceIdx = 1; // after split_base
          sortedNonBase.forEach((comp) => {
            // Determine if this component should be placed on the left side
            let isLeftComp = false;
            if (vowelHasLeft) {
              // If vowel has left zone, components left of base center are left parts
              isLeftComp = getComponentCenterX(comp) < baseCenterX;
            } else {
              // If no left zone, all non-base components are considered right and will be ignored
              isLeftComp = false;
            }

            if (isLeftComp) {
              const compClipRect = componentToClipRect(comp, dependentMeta.category);
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
            }
            // Right components are ignored – they will be replaced by the geometric tail
          });
        }

        // Add geometric tail for the right part
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
      } else {
        // For non-right vowels (left, top, bottom), use the existing logic that distributes non-base components
        const nonBaseComponents = glyph.components.filter((c) => c !== baseComponent);

        const sortedNonBase = [...nonBaseComponents].sort(
          (a, b) => getComponentLeftEdge(a) - getComponentLeftEdge(b)
        );

        const vowelCp = dependentMeta?.char?.codePointAt(0);
        const vowelZones = getVowelZones(vowelCp);
        const vowelHasLeft = vowelZones.includes('LEFT');
        const vowelHasRight = vowelZones.includes('RIGHT');

        const baseCenterX = getComponentCenterX(baseComponent);

        let spliceIdx = 1; // after split_base
        sortedNonBase.forEach((comp) => {
          let isLeftComp;
          if (vowelHasLeft && !vowelHasRight) {
            isLeftComp = true;
          } else if (!vowelHasLeft) {
            isLeftComp = false;
          } else {
            isLeftComp = getComponentCenterX(comp) < baseCenterX;
          }

          const compClipRect = componentToClipRect(comp, dependentMeta.category);

          if (isLeftComp) {
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
          clipRect: componentToClipRect(comp, meta.category),
        });
      });

      console.log('[MAPPER] Created split parts:', parts.length);
      return normalizeAndFilterParts(parts);
    }
  }

  const baseMetaForCoeng = charMeta.find(
    (m) => m.category === 'base_consonant' || m.category === 'independent_vowel'
  );
  const dependentMetaForCoeng = charMeta.find((m) => m.category === 'dependent_vowel');
  const coengMeta = charMeta.find((m) => m.category === 'coeng');
  const subscriptMetaForCoeng = charMeta.find((m) => m.category === 'subscript_consonant');

  const dependentCpForCoeng = cpOf(dependentMetaForCoeng?.char);
  const isRightSplitVowelCase =
    baseMetaForCoeng &&
    dependentMetaForCoeng &&
    coengMeta &&
    subscriptMetaForCoeng &&
    dependentCpForCoeng != null &&
    [0x17B6, 0x17C4, 0x17C5].includes(dependentCpForCoeng);

  if (isRightSplitVowelCase) {
    const baseCP = baseMetaForCoeng.char?.codePointAt(0) ?? null;
    const baseComponent = pickBaseForCoengRightSplit(glyph.components, baseCP);

    if (baseComponent?.bb) {
      const bb = baseComponent.bb;
      const bbWidth = Math.max(0, (bb.x2 || 0) - (bb.x1 || 0));
      const bbHeight = Math.max(0, (bb.y2 || 0) - (bb.y1 || 0));

      // In this branch, subscript is definitely present (subscriptMetaForCoeng exists)
      const hasSubscript = true;
      const preferredTail = getDesiredTailWidthFromHeight(bbHeight, hasSubscript);
      const split = splitByDesiredTailWidth(bbWidth, preferredTail);

      const structuredParts = [];
      let baseClipWidth = bbWidth;
      let trailingClipRect = null;

      const basePart = {
        partId: `${glyph.id}-coeng-base`,
        component: baseComponent,
        char: baseMetaForCoeng.char,
        category: baseMetaForCoeng.category,
        color: getColorForCategory(baseMetaForCoeng.category, baseMetaForCoeng.char),
        zone: 'split_base',
        hbGlyphId: baseComponent?.hbGlyphId,
        clipRect: {
          x: bb.x1,
          y: bb.y1,
          width: bbWidth,
          height: bbHeight,
        },
      };
      adjustBaseClipRect(basePart, clusterHasSubscript);
      structuredParts.push(basePart);

      const nonBase = (glyph.components || []).filter((c) => c !== baseComponent);
      const sortedNonBase = [...nonBase].sort((a, b) => getComponentCenterX(a) - getComponentCenterX(b));
      const sortedByLower = [...nonBase].sort((a, b) => getComponentCenterY(b) - getComponentCenterY(a));
      const subscriptComponent = sortedByLower[0] || sortedNonBase[1] || sortedNonBase[0] || baseComponent;
      const coengComponent =
        sortedNonBase.find((c) => c !== subscriptComponent) ||
        sortedNonBase[0] ||
        subscriptComponent;
      const subscriptRect = componentToClipRect(subscriptComponent, 'subscript_consonant');

      const baseRightEdge = getComponentRightEdge(baseComponent);
      const vowelTrailingComponent =
        [...nonBase]
          .filter((c) => c?.bb)
          .sort((a, b) => {
            const dr = getComponentRightEdge(b) - getComponentRightEdge(a);
            if (dr !== 0) return dr;
            return getComponentCenterY(b) - getComponentCenterY(a);
          })[0] || baseComponent;

      const trailingOnNonBase =
        vowelTrailingComponent !== baseComponent &&
        getComponentRightEdge(vowelTrailingComponent) >= baseRightEdge - 8;

      if (!trailingOnNonBase) {
        baseClipWidth = split.baseClipWidth;
        trailingClipRect = {
          x: bb.x1 + split.baseClipWidth,
          y: bb.y1,
          width: split.tailWidth,
          height: bbHeight,
        };
      } else {
        const trailingRectSource = componentToClipRect(vowelTrailingComponent);
        if (trailingRectSource) {
          // Use the same factor (subscript present) for the trailing part
          const preferredTailSub = getDesiredTailWidthFromHeight(trailingRectSource.height, true);
          const splitSub = splitByDesiredTailWidth(trailingRectSource.width, preferredTailSub);
          trailingClipRect = {
            x: trailingRectSource.x + splitSub.baseClipWidth,
            y: trailingRectSource.y,
            width: splitSub.tailWidth,
            height: trailingRectSource.height,
          };

          if (subscriptRect) {
            const safeStartX = subscriptRect.x + subscriptRect.width * SUBSCRIPT_CLAMP_FRACTION;
            const clampedX = Math.max(trailingClipRect.x, safeStartX);
            const rightEdge = trailingRectSource.x + trailingRectSource.width;
            trailingClipRect.x = clampedX;
            trailingClipRect.width = Math.max(24, rightEdge - clampedX);
          }
        }
      }

      structuredParts[0].clipRect.width = baseClipWidth;

      structuredParts.push({
        partId: `${glyph.id}-coeng-mark`,
        component: coengComponent,
        char: coengMeta.char,
        category: coengMeta.category,
        color: getColorForCategory(coengMeta.category, coengMeta.char),
        zone: 'split_coeng',
        hbGlyphId: coengComponent?.hbGlyphId,
        clipRect: componentToClipRect(coengComponent, coengMeta.category),
      });

      structuredParts.push({
        partId: `${glyph.id}-subscript-mark`,
        component: subscriptComponent,
        char: subscriptMetaForCoeng.char,
        category: subscriptMetaForCoeng.category,
        color: getColorForCategory(subscriptMetaForCoeng.category, subscriptMetaForCoeng.char),
        zone: 'split_subscript',
        hbGlyphId: subscriptComponent?.hbGlyphId,
        clipRect: subscriptRect,
      });

      const depZones = getVowelZones(dependentCpForCoeng);
      if (depZones.includes('LEFT')) {
        const leftComp = sortedNonBase.find((c) => getComponentCenterX(c) < getComponentCenterX(baseComponent));
        const leftSource = leftComp || baseComponent;
        const leftRect = componentToClipRect(leftSource);
        if (leftRect) {
          structuredParts.push({
            partId: `${glyph.id}-vowel-leading`,
            component: leftSource,
            char: dependentMetaForCoeng.char,
            category: dependentMetaForCoeng.category,
            color: getColorForCategory(dependentMetaForCoeng.category, dependentMetaForCoeng.char),
            zone: 'split_vowel_leading',
            hbGlyphId: leftSource?.hbGlyphId,
            clipRect: leftComp
              ? leftRect
              : { x: leftRect.x, y: leftRect.y, width: Math.max(24, leftRect.width * 0.28), height: leftRect.height },
          });
        }
      }

      structuredParts.push({
        partId: `${glyph.id}-vowel-trailing-main`,
        component: trailingOnNonBase ? vowelTrailingComponent : baseComponent,
        char: dependentMetaForCoeng.char,
        category: dependentMetaForCoeng.category,
        color: getColorForCategory(dependentMetaForCoeng.category, dependentMetaForCoeng.char),
        zone: 'split_vowel_trailing',
        hbGlyphId: (trailingOnNonBase ? vowelTrailingComponent : baseComponent)?.hbGlyphId,
        clipRect: trailingClipRect,
      });

      const otherMeta = charMeta.filter(
        (m) => m.category === 'diacritic_sign' || m.category === 'diacritic'
      );
      otherMeta.forEach((meta) => {
        const comp = pickComponentForCategory(glyph, meta.category, meta.unitIdx, charMeta);
        structuredParts.push({
          partId: `${glyph.id}-coeng-mark-${meta.unitIdx}`,
          component: comp,
          char: meta.char,
          category: meta.category,
          color: getColorForCategory(meta.category, meta.char),
          zone: 'mark',
          hbGlyphId: comp?.hbGlyphId,
          clipRect: componentToClipRect(comp, meta.category),
        });
      });

      return normalizeAndFilterParts(structuredParts);
    }
  }

  console.log('[MAPPER] → Using simple mapping (no split)');

  const metaBaseCP =
    charMeta.find(m => m.category === 'base_consonant' || m.category === 'independent_vowel')
      ?.char?.codePointAt(0) ?? null;
  const baseCandidateForAllocator = pickBaseComponent(glyph.components || [], metaBaseCP, charMeta);
  const allocator = createNonBaseAllocator(glyph.components || [], baseCandidateForAllocator);

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
      component = pickComponentForCategory(glyph, category, unitIdx, charMeta, allocator);
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
          clipRect: componentToClipRect(comp, category),
        });
      });
    } else {
      const part = {
        partId: `${glyph.id}-${unitIdx}`,
        component,
        char,
        category,
        color: getColorForCategory(category, char),
        zone: 'component',
        hbGlyphId: component?.hbGlyphId,
        clipRect: componentToClipRect(component, category),
      };
      // Apply body clipping for base consonants if a subscript exists in the cluster
      adjustBaseClipRect(part, clusterHasSubscript);
      parts.push(part);
    }
  }

  return normalizeAndFilterParts(parts);
}

function mapSingleGlyphToParts(glyph, units, enableSegmentation) {
  if (glyph.components && glyph.components.length > 0) {
    return getComponentBasedParts(glyph, units, enableSegmentation);
  }

  if (!enableSegmentation) {
    return [createFullGlyphPart(glyph)];
  }

  const glyphCps = new Set(glyph.codePoints || []);

  const relevantUnits = (units || []).filter((u) =>
    (u.codePoints || []).some((cp) => glyphCps.has(cp))
  );

  if (relevantUnits.length === 0) {
    return [createFullGlyphPart(glyph)];
  }

  const baseUnit = relevantUnits.find(
    (u) => u.category === 'base_consonant' || u.category === 'independent_vowel'
  );
  const baseCP = baseUnit?.codePoints?.[0] ?? null;

  const rawBB = glyph.bb || { x1: 0, y1: 0, x2: 500, y2: 500 };

  const zones = getTopologyZones(
    rawBB,
    relevantUnits.map((u) => ({ char: u.text, category: u.category, codePoints: u.codePoints })),
    baseCP
  );

  const parts = [];
  const leftCodes = [0x17C1, 0x17C2, 0x17C3, 0x17BE, 0x17BF, 0x17C0, 0x17C4, 0x17C5];

  relevantUnits.forEach((unit, idx) => {
    const cat = unit.category;
    const cp = unit.codePoints?.[0];
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

  return normalizeAndFilterParts(parts);
}

export function mapGlyphsToParts(glyphs, units, { enableSegmentation = true } = {}) {
  return (glyphs || []).map((glyph) => ({
    ...glyph,
    parts: mapSingleGlyphToParts(glyph, units, enableSegmentation),
  }));
}