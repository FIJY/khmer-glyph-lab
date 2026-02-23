import { createClipPathParts, getTopologyZones } from './simpleGlyphSplit.js';
import {
  getColorForCategory,
  shouldSplitBaseForDependentVowel,
  getSubscriptVowelRule
} from './glyphCombinationRules.js';
import { getConsonantBodyRect, getRawMetrics, getVowelMetrics } from './khmerConsonantMetrics.js';


const ENABLE_NARROW_STACKED_MODE = true;

const STACKED_CLUSTER_WHITELIST = new Set([
  'ញ្ញុំ', 'តោ', 'ន្ត្រា', 'ក្សា'
]);

const STACKED_CLUSTER_BLACKLIST = new Set([]);

const DEFAULT_TAIL_HEIGHT_FACTOR = 0.35;
const SUBSCRIPT_TAIL_HEIGHT_FACTOR = 0.20;

// Per-vowel tail factor overrides — applied only for specific base consonants.
// Format: { vowelCp: { baseConsonantCp: factor } }
const VOWEL_TAIL_FACTOR_OVERRIDE = {
  0x17B6: { 0x1793: 0.38 }, // ា after ន → wider right tail
  0x17C4: { 0x1793: 0.4 }, // ោ after ន → wider right tail
  0x17C5: { 0x1793: 0.4 }, // ៅ after ន → wider right tail
};

const SUBSCRIPT_CLAMP_FRACTION = 0.8;

// Padding added to subscript clipRect on each side as a fraction of
// the component's own size. Tune if subscripts are still clipped
// or bleed too much into adjacent parts.
const SUBSCRIPT_PAD_X_FRACTION = 0.4;
const SUBSCRIPT_PAD_Y_FRACTION = 0.3;
const SUBSCRIPT_PAD_X_MIN = 20;
const SUBSCRIPT_PAD_Y_MIN = 16;

function getDesiredTailWidthFromHeight(height, hasSubscript, vowelCp = null, baseConsonantCp = null) {
  if (!hasSubscript && vowelCp != null) {
    const vowelOverrides = VOWEL_TAIL_FACTOR_OVERRIDE[vowelCp];
    if (vowelOverrides != null) {
      // Check if there's a per-base override
      const factor = baseConsonantCp != null && vowelOverrides[baseConsonantCp] != null
        ? vowelOverrides[baseConsonantCp]
        : null;
      if (factor != null) {
        return Math.max(24, Math.floor(height * factor));
      }
    }
  }
  const factor = hasSubscript ? SUBSCRIPT_TAIL_HEIGHT_FACTOR : DEFAULT_TAIL_HEIGHT_FACTOR;
  return Math.max(24, Math.floor(height * factor));
}

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

  if (category === 'subscript_consonant') {
    // Expand on all 4 sides — the bb from HarfBuzz is often too tight for
    // subscript forms which have decorative descenders and wide strokes.
    // Horizontal: +40% of width per side; vertical: +30% per side.
    const w = Math.max(0, x2 - x1);
    const h = Math.max(0, y2 - y1);
    const padX = Math.max(SUBSCRIPT_PAD_X_MIN, w * SUBSCRIPT_PAD_X_FRACTION);
    const padY = Math.max(SUBSCRIPT_PAD_Y_MIN, h * SUBSCRIPT_PAD_Y_FRACTION);
    return {
      x: x1 - padX,
      y: y1 - padY,
      width: w + padX * 2,
      height: h + padY * 2,
    };
  }

  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
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

/**
 * Adjusts the clipRect of a base consonant (or independent vowel) part
 * to the body area if a subscript consonant exists anywhere in the same cluster.
 * This prevents overlapping between the base and a subscript that lives in a separate glyph.
 *
 * v7: Skip body clipping when base and subscript share the same hbGlyphId (e.g. ញ្ញ),
 * because physically they are the same glyph shape and vertical clipping would cut off
 * the subscript form.
 */
function adjustBaseClipRect(part, clusterHasSubscript, allComponents) {
  if (!clusterHasSubscript) return part;
  if (!(part.category === 'base_consonant' || part.category === 'independent_vowel')) return part;
  if (!part.component?.bb) return part;

  // NEW v7: if subscript uses the same glyph shape as the base, skip vertical clipping
  if (allComponents?.length) {
    const sameGlyphSubscript = allComponents.some(
      (c) => c !== part.component && c.hbGlyphId === part.component.hbGlyphId
    );
    if (sameGlyphSubscript) return part;
  }

  const baseCP = part.char?.codePointAt(0) ?? null;
  if (!baseCP) return part;

  const bodyRect = getConsonantBodyRect(part.component.bb, baseCP);
  if (!bodyRect || bodyRect.bodyY1 >= bodyRect.bodyY2) return part;

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
  // expand subscript area horizontally (no longer uses deleted SUBSCRIPT_WIDTH_MULTIPLIER)
  const restW = Math.max(0, w - coengW) * 1.4;

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
      // Expand clip on all sides using the same fractions as componentToClipRect
      const subX = x1 + coengW;
      const padX = Math.max(SUBSCRIPT_PAD_X_MIN, restW * SUBSCRIPT_PAD_X_FRACTION);
      const padY = Math.max(SUBSCRIPT_PAD_Y_MIN, lowH * SUBSCRIPT_PAD_Y_FRACTION);
      clipRect = {
        x: subX - padX,
        y: yLow - padY,
        width: restW + padX * 2,
        height: lowH + padY * 2,
      };
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

/**
 * v7: Non-base components sorted DESC by centerY so that chained coeng+subscript
 * pairs (e.g. ន្ត្រ: ត then រ) are allocated in the correct top-to-bottom order.
 * Added peek() — looks at the current slot without advancing the index.
 * coeng uses peek(), subscript_consonant uses next().
 */
function createNonBaseAllocator(components, baseCandidate) {
  const nonBase = (components || [])
    .filter((c) => c !== baseCandidate)
    .sort((a, b) => getComponentCenterY(b) - getComponentCenterY(a)); // DESC: higher Y first
  let i = 0;
  return {
    next() {
      if (!nonBase.length) return null;
      const idx = Math.min(i, nonBase.length - 1);
      i += 1;
      return nonBase[idx];
    },
    peek() {
      if (!nonBase.length) return null;
      return nonBase[Math.min(i, nonBase.length - 1)];
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

  // v7: coeng peeks without consuming — it shares the component with the following subscript
  if (category === 'coeng') {
    if (allocator) {
      const peek = allocator.peek();
      if (peek) return peek;
    }
    const nonBase = components.find((comp) => comp !== baseCandidate);
    return nonBase || baseCandidate;
  }

  // v7: subscript_consonant consumes a slot from the allocator
  if (category === 'subscript_consonant') {
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

    // If this glyph starts with coeng and contains NO dependent vowel,
    // it's a pure subscript form (e.g. ្ញ in ញ្ញុំ). Skip createClipPathParts
    // which would clip it aggressively. Return full unclipped shape.
    // If it has a vowel (e.g. ្+ស+ា in ក្សា), let createClipPathParts handle it normally.
    const COENG = '\u17D2';
    const glyphChars = glyph.chars || [];
    const glyphHasCoeng = glyphChars.includes(COENG);
    const glyphHasVowel = glyphChars.some((ch) => {
      const cp = ch?.codePointAt(0);
      return cp >= 0x17B6 && cp <= 0x17C8;
    });
    if (glyphHasCoeng && !glyphHasVowel) {
      console.log('[MAPPER] → Pure subscript glyph (coeng, no vowel) → full unclipped part');
      const subUnit = (units || []).find((u) =>
        (u.codePoints || []).some((cp) => (glyph.codePoints || []).includes(cp)) &&
        u.category === 'subscript_consonant'
      ) || null;
      return [{
        partId: `${glyph.id}-subscript-full`,
        component: glyph.components?.[0] || null,
        char: subUnit?.text || glyphChars.filter(ch => ch !== COENG).join('') || '',
        category: 'subscript_consonant',
        color: getColorForCategory('subscript_consonant', subUnit?.text || ''),
        zone: 'BOTTOM',
        hbGlyphId: glyph.components?.[0]?.hbGlyphId,
        clipRect: null,
        pathData: glyph.d,
      }];
    }

    // Coeng + subscript + RIGHT vowel (e.g. ្+ស+ា in ក្សា):
    // createClipPathParts doesn't know about subscript presence and gives
    // the vowel too wide a tail. Intercept and split manually with a narrow tail.
    const RIGHT_VOWELS = new Set([0x17B6, 0x17C4, 0x17C5]);
    const glyphVowelCp = glyphChars
      .map(ch => ch?.codePointAt(0))
      .find(cp => RIGHT_VOWELS.has(cp)) ?? null;

    if (glyphHasCoeng && glyphVowelCp != null && glyph.components?.[0]?.bb) {
      console.log('[MAPPER] → Geometry fallback: coeng+subscript+vowel → manual narrow split');
      const comp = glyph.components[0];
      const bb = comp.bb;
      const bbW = Math.max(0, (bb.x2 || 0) - (bb.x1 || 0));
      const bbH = Math.max(0, (bb.y2 || 0) - (bb.y1 || 0));

      // Use subscript tail factor (narrower) since subscript is present
      const preferredTail = getDesiredTailWidthFromHeight(bbH, true);
      const { baseClipWidth, tailWidth } = splitByDesiredTailWidth(bbW, preferredTail);

      // Find subscript and vowel units for correct char/color
      const allClusterUnits = (units || []).filter((u) =>
        (u.codePoints || []).some((cp) => (glyph.codePoints || []).includes(cp))
      );
      const subUnit = allClusterUnits.find(u => u.category === 'subscript_consonant');
      const vowUnit = allClusterUnits.find(u => u.category === 'dependent_vowel');

      const fallbackParts = [];

      // subscript part — full height, left portion
      if (subUnit) {
        const subPadX = Math.max(SUBSCRIPT_PAD_X_MIN, bbW * SUBSCRIPT_PAD_X_FRACTION);
        const subPadY = Math.max(SUBSCRIPT_PAD_Y_MIN, bbH * SUBSCRIPT_PAD_Y_FRACTION);
        fallbackParts.push({
          partId: `${glyph.id}-fb-subscript`,
          component: comp,
          char: subUnit.text,
          category: 'subscript_consonant',
          color: getColorForCategory('subscript_consonant', subUnit.text),
          zone: 'BOTTOM',
          hbGlyphId: comp.hbGlyphId,
          clipRect: {
            x: bb.x1 - subPadX,
            y: bb.y1 - subPadY,
            width: baseClipWidth + subPadX * 2,
            height: bbH + subPadY * 2,
          },
        });
      }

      // vowel trailing part — right portion
      if (vowUnit) {
        fallbackParts.push({
          partId: `${glyph.id}-fb-vowel`,
          component: comp,
          char: vowUnit.text,
          category: 'dependent_vowel',
          color: getColorForCategory('dependent_vowel', vowUnit.text),
          zone: 'RIGHT',
          hbGlyphId: comp.hbGlyphId,
          clipRect: {
            x: bb.x1 + baseClipWidth,
            y: bb.y1,
            width: tailWidth,
            height: bbH,
          },
        });
      }

      if (fallbackParts.length > 0) {
        return normalizeAndFilterParts(fallbackParts);
      }
    }

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

  // Normalize: U+17D2 is the only real coeng mark. Any unit tagged 'coeng'
  // whose codepoint is NOT U+17D2 is a consonant in subscript role — fix on
  // the unit object itself so clusterHasSubscript and all downstream checks work.
  const COENG_CP = 0x17D2;
  for (const u of relevantUnits) {
    if (u.category === 'coeng' && u.codePoints?.[0] !== COENG_CP) {
      u.category = 'subscript_consonant';
    }
  }
  // Re-sync charMeta from the (now corrected) unit categories
  for (const m of charMeta) {
    m.category = m.unit.category;
  }

  // Fallback: if no units matched this glyph, render it as a single full part
  // to avoid returning 0 parts (fixes e.g. isolated vowel glyphs in ក្សោ)
  if (charMeta.length === 0) {
    return [createFullGlyphPart(glyph)];
  }

  // Determine if the whole cluster contains a subscript consonant
  const clusterUnits = (units || []).filter(u =>
    Number.isInteger(u?.sourceStart) && Number.isInteger(u?.sourceEnd) &&
    Number.isInteger(glyph?.clusterStart) && Number.isInteger(glyph?.clusterEnd) &&
    u.sourceStart < glyph.clusterEnd && u.sourceEnd > glyph.clusterStart
  );
  const clusterHasSubscript = clusterUnits.some(u => u.category === 'subscript_consonant');

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
        adjustBaseClipRect(basePart, clusterHasSubscript, glyph.components);
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

        const preferredTail = getDesiredTailWidthFromHeight(bbHeight, clusterHasSubscript);
        const { baseClipWidth, tailWidth } = splitByDesiredTailWidth(bbWidth, preferredTail);

        if (parts[0]) {
          parts[0].clipRect = {
            x: bb.x1,
            y: bb.y1,
            width: baseClipWidth,
            height: bbHeight,
          };
          adjustBaseClipRect(parts[0], clusterHasSubscript, glyph.components);
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

  // Special case: base + LEFT vowel + RIGHT vowel (e.g. កេា = ក + េ + ា)
  // The compound vowel ោ is sometimes stored as two separate units.
  // Handle it before useAreaMapping so it doesn't fall to simple mapping.
  const dependentMetas = mainCharMeta.filter((m) => m.category === 'dependent_vowel');
  const leftVowelMeta = dependentMetas.find((m) => {
    const z = getVowelZones(m.char?.codePointAt(0));
    return z.includes('LEFT') && !z.includes('RIGHT');
  });
  const rightVowelMeta = dependentMetas.find((m) => {
    const z = getVowelZones(m.char?.codePointAt(0));
    return z.includes('RIGHT') && !z.includes('LEFT');
  });
  const baseMeta = mainCharMeta.find(
    (item) => item.category === 'base_consonant' || item.category === 'independent_vowel'
  );

  if (hasBase && leftVowelMeta && rightVowelMeta && baseMeta && mainCharMeta.length === 3) {
    const ligBaseCP = baseMeta.char?.codePointAt(0) ?? null;
    const baseComponent = pickBaseComponent(glyph.components, ligBaseCP, charMeta);
    if (baseComponent?.bb) {
      const bb = baseComponent.bb;
      const bbWidth = Math.max(0, (bb.x2 || 0) - (bb.x1 || 0));
      const bbHeight = Math.max(0, (bb.y2 || 0) - (bb.y1 || 0));
      const rightVowelCp = rightVowelMeta.char?.codePointAt(0) ?? null;
      const baseConsonantCpForTail = baseMeta.char?.codePointAt(0) ?? null;
      const preferredTail = getDesiredTailWidthFromHeight(bbHeight, clusterHasSubscript, rightVowelCp, baseConsonantCpForTail);

      // base — full width (both vowels sit around it)
      const bp = {
        partId: `${glyph.id}-compound-base`,
        component: baseComponent,
        char: baseMeta.char,
        category: baseMeta.category,
        color: getColorForCategory(baseMeta.category, baseMeta.char),
        zone: 'split_base',
        hbGlyphId: baseComponent?.hbGlyphId,
        clipRect: { x: bb.x1, y: bb.y1, width: bbWidth, height: bbHeight },
      };
      adjustBaseClipRect(bp, clusterHasSubscript, glyph.components);
      compoundParts.push(bp);

      // LEFT vowel — leftmost non-base component or geometric fallback
      const nonBaseComps = glyph.components.filter(c => c !== baseComponent);
      const leftComp = [...nonBaseComps]
        .sort((a, b) => getComponentLeftEdge(a) - getComponentLeftEdge(b))[0] || null;
      const leftClip = leftComp?.bb
        ? componentToClipRect(leftComp, leftVowelMeta.category)
        : { x: bb.x1, y: bb.y1, width: Math.max(24, Math.floor(bbWidth * 0.28)), height: bbHeight };
      compoundParts.push({
        partId: `${glyph.id}-compound-vowel-left`,
        component: leftComp || baseComponent,
        char: leftVowelMeta.char,
        category: leftVowelMeta.category,
        color: getColorForCategory(leftVowelMeta.category, leftVowelMeta.char),
        zone: 'split_vowel_leading',
        hbGlyphId: (leftComp || baseComponent)?.hbGlyphId,
        clipRect: leftClip,
      });

      // RIGHT vowel — rightmost non-base component or geometric tail
      const rightComp = [...nonBaseComps]
        .sort((a, b) => getComponentRightEdge(b) - getComponentRightEdge(a))[0] || null;
      const rightIsDistinct = rightComp && rightComp !== leftComp;
      const rightClip = rightIsDistinct && rightComp?.bb
        ? componentToClipRect(rightComp, rightVowelMeta.category)
        : { x: bb.x1 + baseClipWidth, y: bb.y1, width: tailWidth, height: bbHeight };
      compoundParts.push({
        partId: `${glyph.id}-compound-vowel-right`,
        component: rightIsDistinct ? rightComp : baseComponent,
        char: rightVowelMeta.char,
        category: rightVowelMeta.category,
        color: getColorForCategory(rightVowelMeta.category, rightVowelMeta.char),
        zone: 'split_vowel_trailing',
        hbGlyphId: (rightIsDistinct ? rightComp : baseComponent)?.hbGlyphId,
        clipRect: rightClip,
      });

      // diacritics
      charMeta.filter(m => diacriticCategories.has(m.category)).forEach(meta => {
        const comp = pickComponentForCategory(glyph, meta.category, meta.unitIdx, charMeta);
        compoundParts.push({
          partId: `${glyph.id}-compound-mark-${meta.unitIdx}`,
          component: comp,
          char: meta.char,
          category: meta.category,
          color: getColorForCategory(meta.category, meta.char),
          zone: 'mark',
          hbGlyphId: comp?.hbGlyphId,
          clipRect: componentToClipRect(comp, meta.category),
        });
      });

      console.log('[MAPPER] ✅ COMPOUND LEFT+RIGHT vowel split:', compoundParts.length, 'parts');
      return normalizeAndFilterParts(compoundParts);
    }
  }

  const useAreaMapping =
    hasBase &&
    hasDependent &&
    glyph.components.length >= 2 &&
    glyph.components.length <= 6 &&
    mainCharMeta.length === 2;

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

    // v7: also trigger forceSplit for LEFT-zone vowels (e.g. ើ in ណើ)
    const forceSplit =
      shouldSplitBaseForDependentVowel(dependentMeta?.char) ||
      isAALigature ||
      isDependentEmpty ||
      (vowelCode != null && getVowelZones(vowelCode).includes('LEFT'));

    const hasBaseBB = !!baseComponent?.bb;

    if (forceSplit && hasBaseBB) {
      console.log(
        '[MAPPER] ✅ USING SPLIT LOGIC (AA ligature or other):',
        dependentMeta.char
      );

      const bb = baseComponent.bb;
      const bbWidth = Math.max(0, (bb.x2 || 0) - (bb.x1 || 0));
      const bbHeight = Math.max(0, (bb.y2 || 0) - (bb.y1 || 0));

      const vowelZonesForSplit = getVowelZones(vowelCode);
      const vowelIsLeftOnly = vowelZonesForSplit.includes('LEFT') && !vowelZonesForSplit.includes('RIGHT');
      const vowelIsLeftRight = vowelZonesForSplit.includes('LEFT') && vowelZonesForSplit.includes('RIGHT');

      const preferredTail = getDesiredTailWidthFromHeight(bbHeight, clusterHasSubscript, vowelCode, baseMeta?.char?.codePointAt(0) ?? null);
      const { baseClipWidth, tailWidth } = splitByDesiredTailWidth(bbWidth, preferredTail);

      // base consonant must render at full width, no right-side clipping.
      // LEFT+RIGHT vowels (e.g. ៀ 0x17C0, ោ 0x17C4): check if there is a
      // dedicated right component — if so, base renders at full width too.
      const nonBaseComponents = glyph.components.filter((c) => c !== baseComponent);
      const baseCenterX = getComponentCenterX(baseComponent);
      const hasRightComponent = nonBaseComponents.some(
        (c) => getComponentCenterX(c) > baseCenterX
      );
      const skipBaseClip = vowelIsLeftOnly || (vowelIsLeftRight && hasRightComponent);
      const effectiveBaseClipWidth = skipBaseClip ? bbWidth : baseClipWidth;

      const baseClipRect = {
        x: bb.x1,
        y: bb.y1,
        width: effectiveBaseClipWidth,
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
      adjustBaseClipRect(basePart, clusterHasSubscript, glyph.components);
      parts.push(basePart);

      const isRightVowel = vowelCode === 0x17B6 || vowelCode === 0x17C4 || vowelCode === 0x17C5;

      if (isRightVowel) {
        if (nonBaseComponents.length > 0) {
          const sortedNonBase = [...nonBaseComponents].sort(
            (a, b) => getComponentLeftEdge(a) - getComponentLeftEdge(b)
          );

          const vowelHasLeft = vowelZonesForSplit.includes('LEFT');

          let spliceIdx = 1;
          sortedNonBase.forEach((comp) => {
            const compCenterX = getComponentCenterX(comp);
            const isLeftComp = vowelHasLeft && compCenterX < baseCenterX;
            const isRightComp = compCenterX >= baseCenterX;

            if (isLeftComp) {
              parts.splice(spliceIdx, 0, {
                partId: `${glyph.id}-vowel-left-${spliceIdx}`,
                component: comp,
                char: dependentMeta.char,
                category: dependentMeta.category,
                color: getColorForCategory(dependentMeta.category, dependentMeta.char),
                zone: 'split_vowel_leading',
                hbGlyphId: comp?.hbGlyphId,
                clipRect: componentToClipRect(comp, dependentMeta.category),
              });
              spliceIdx++;
            } else if (isRightComp) {
              // Use the actual right component's bb for trailing clip
              parts.push({
                partId: `${glyph.id}-vowel-trailing-comp`,
                component: comp,
                char: dependentMeta.char,
                category: dependentMeta.category,
                color: getColorForCategory(dependentMeta.category, dependentMeta.char),
                zone: 'split_vowel_trailing',
                hbGlyphId: comp?.hbGlyphId,
                clipRect: componentToClipRect(comp, dependentMeta.category),
              });
            }
          });
        }

        // Only add geometric tail if there is no dedicated right component
        if (!hasRightComponent) {
          parts.push({
            partId: `${glyph.id}-vowel-trailing`,
            component: baseComponent,
            char: dependentMeta.char,
            category: dependentMeta.category,
            color: getColorForCategory(dependentMeta.category, dependentMeta.char),
            zone: 'split_vowel_trailing',
            hbGlyphId: baseComponent?.hbGlyphId,
            clipRect: {
              x: bb.x1 + effectiveBaseClipWidth,
              y: bb.y1,
              width: tailWidth,
              height: bbHeight,
            },
          });
        }
      } else {
        // LEFT / TOP / BOTTOM vowels
        const nonBaseComponents = glyph.components.filter((c) => c !== baseComponent);

        const sortedNonBase = [...nonBaseComponents].sort(
          (a, b) => getComponentLeftEdge(a) - getComponentLeftEdge(b)
        );

        const vowelCp = dependentMeta?.char?.codePointAt(0);
        const vowelZones = getVowelZones(vowelCp);
        const vowelHasLeft = vowelZones.includes('LEFT');
        const vowelHasRight = vowelZones.includes('RIGHT');

        const baseCenterX = getComponentCenterX(baseComponent);

        let spliceIdx = 1;
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

  // ── RIGHT vowel + coeng + subscript (e.g. ន្ត្រា) ───────────────────────
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

      const preferredTail = getDesiredTailWidthFromHeight(bbHeight, true);
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
      adjustBaseClipRect(basePart, clusterHasSubscript, glyph.components);
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
        // v7: when subscript present, clip trailing height to body area so it
        // doesn't overlap the subscript zone (fixes ក្សា tail extending into ស)
        let trailHeight = bbHeight;
        if (clusterHasSubscript) {
          const baseCP2 = baseMetaForCoeng.char?.codePointAt(0) ?? null;
          const bodyRect2 = baseCP2 ? getConsonantBodyRect(bb, baseCP2) : null;
          if (bodyRect2 && bodyRect2.bodyY2 > bb.y1) {
            trailHeight = bodyRect2.bodyY2 - bb.y1;
          }
        }
        trailingClipRect = {
          x: bb.x1 + split.baseClipWidth,
          y: bb.y1,
          width: split.tailWidth,
          height: trailHeight,
        };
      } else {
        const trailingRectSource = componentToClipRect(vowelTrailingComponent);
        if (trailingRectSource) {
          const preferredTailSub = getDesiredTailWidthFromHeight(trailingRectSource.height, true);
          const splitSub = splitByDesiredTailWidth(trailingRectSource.width, preferredTailSub);
          trailingClipRect = {
            x: trailingRectSource.x + splitSub.baseClipWidth,
            y: trailingRectSource.y,
            width: splitSub.tailWidth,
            height: trailingRectSource.height,
          };

          if (subscriptRect) {
            // v7: use 0.6 instead of 0.8 — 0.8 was cutting off too much of ោ right tail
            const clampFraction = 0.6;
            const safeStartX = subscriptRect.x + subscriptRect.width * clampFraction;
            const clampedX = Math.max(trailingClipRect.x, safeStartX);
            const rightEdge = trailingRectSource.x + trailingRectSource.width;
            trailingClipRect.x = clampedX;
            trailingClipRect.width = Math.max(24, rightEdge - clampedX);
          }
        }
      }

      structuredParts[0].clipRect.width = baseClipWidth;

      // Handle ALL coeng+subscript pairs (not just the first one)
      const allCoengMetas = charMeta.filter((m) => m.category === 'coeng');
      const allSubscriptMetas = charMeta.filter((m) => m.category === 'subscript_consonant');

      // Allocator for non-base components sorted by centerY DESC
      const nonBaseForSubs = (glyph.components || [])
        .filter((c) => c !== baseComponent)
        .sort((a, b) => getComponentCenterY(b) - getComponentCenterY(a));

      allCoengMetas.forEach((cm, i) => {
        const subMeta = allSubscriptMetas[i];
        const comp = nonBaseForSubs[Math.min(i, nonBaseForSubs.length - 1)] || baseComponent;

        structuredParts.push({
          partId: `${glyph.id}-coeng-mark-${i}`,
          component: comp,
          char: cm.char,
          category: cm.category,
          color: getColorForCategory(cm.category, cm.char),
          zone: 'split_coeng',
          hbGlyphId: comp?.hbGlyphId,
          clipRect: componentToClipRect(comp, cm.category),
        });

        if (subMeta) {
          structuredParts.push({
            partId: `${glyph.id}-subscript-mark-${i}`,
            component: comp,
            char: subMeta.char,
            category: subMeta.category,
            color: getColorForCategory(subMeta.category, subMeta.char),
            zone: 'split_subscript',
            hbGlyphId: comp?.hbGlyphId,
            clipRect: componentToClipRect(comp, 'subscript_consonant'),
          });
        }
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

  // ── LEFT vowel + coeng + subscript (e.g. ក្អែក) ──────────────────────────
  const isLeftSplitVowelCase =
    baseMetaForCoeng &&
    dependentMetaForCoeng &&
    coengMeta &&
    subscriptMetaForCoeng &&
    dependentCpForCoeng != null &&
    getVowelZones(dependentCpForCoeng).includes('LEFT') &&
    !getVowelZones(dependentCpForCoeng).includes('RIGHT');

  if (isLeftSplitVowelCase) {
    const baseCP = baseMetaForCoeng.char?.codePointAt(0) ?? null;
    const baseComponent = pickBaseForCoengRightSplit(glyph.components, baseCP);

    if (baseComponent?.bb) {
      const structuredParts = [];

      const basePart = {
        partId: `${glyph.id}-coeng-base`,
        component: baseComponent,
        char: baseMetaForCoeng.char,
        category: baseMetaForCoeng.category,
        color: getColorForCategory(baseMetaForCoeng.category, baseMetaForCoeng.char),
        zone: 'split_base',
        hbGlyphId: baseComponent?.hbGlyphId,
        clipRect: componentToClipRect(baseComponent, baseMetaForCoeng.category),
      };
      adjustBaseClipRect(basePart, clusterHasSubscript, glyph.components);
      structuredParts.push(basePart);

      const nonBase = (glyph.components || []).filter((c) => c !== baseComponent);
      const sortedByX = [...nonBase].sort((a, b) => getComponentLeftEdge(a) - getComponentLeftEdge(b));
      const sortedByLower = [...nonBase].sort((a, b) => getComponentCenterY(b) - getComponentCenterY(a));

      // subscript — lowest non-base component
      const subscriptComponent = sortedByLower[0] || nonBase[0] || baseComponent;
      // coeng — same component as subscript (no extra slot consumed)
      const coengComponent = subscriptComponent;
      // vowel — leftmost non-base that isn't the subscript, or geometric fallback
      const leftComponent = sortedByX[0] || null;
      const vowelComponent = leftComponent && leftComponent !== subscriptComponent
        ? leftComponent
        : null;

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
        clipRect: componentToClipRect(subscriptComponent, 'subscript_consonant'),
      });

      let vowelClipRect;
      if (vowelComponent?.bb) {
        vowelClipRect = componentToClipRect(vowelComponent, dependentMetaForCoeng.category);
      } else {
        // Geometric fallback: left ~28% of base width
        const bb = baseComponent.bb;
        const bbWidth = Math.max(0, (bb.x2 || 0) - (bb.x1 || 0));
        const bbHeight = Math.max(0, (bb.y2 || 0) - (bb.y1 || 0));
        vowelClipRect = {
          x: bb.x1,
          y: bb.y1,
          width: Math.max(24, Math.floor(bbWidth * 0.28)),
          height: bbHeight,
        };
      }

      structuredParts.push({
        partId: `${glyph.id}-vowel-left`,
        component: vowelComponent || baseComponent,
        char: dependentMetaForCoeng.char,
        category: dependentMetaForCoeng.category,
        color: getColorForCategory(dependentMetaForCoeng.category, dependentMetaForCoeng.char),
        zone: 'split_vowel_leading',
        hbGlyphId: (vowelComponent || baseComponent)?.hbGlyphId,
        clipRect: vowelClipRect,
      });

      // If vowel also has a TOP zone (e.g. ើ 0x17BE = LEFT+TOP),
      // find the topmost non-base, non-subscript component and add it separately.
      const depZonesLeft = getVowelZones(dependentCpForCoeng);
      if (depZonesLeft.includes('TOP')) {
        const usedComps = new Set([baseComponent, subscriptComponent, vowelComponent].filter(Boolean));
        const topComp = [...nonBase]
          .filter(c => !usedComps.has(c) && c?.bb)
          .sort((a, b) => getComponentCenterY(a) - getComponentCenterY(b))[0] || null;

        if (topComp?.bb) {
          structuredParts.push({
            partId: `${glyph.id}-vowel-top`,
            component: topComp,
            char: dependentMetaForCoeng.char,
            category: dependentMetaForCoeng.category,
            color: getColorForCategory(dependentMetaForCoeng.category, dependentMetaForCoeng.char),
            zone: 'split_vowel_top',
            hbGlyphId: topComp?.hbGlyphId,
            clipRect: componentToClipRect(topComp, dependentMetaForCoeng.category),
          });
        } else {
          // Geometric fallback: top strip of base component
          const bb = baseComponent.bb;
          const bbWidth = Math.max(0, (bb.x2 || 0) - (bb.x1 || 0));
          const bbHeight = Math.max(0, (bb.y2 || 0) - (bb.y1 || 0));
          const topH = Math.max(20, Math.floor(bbHeight * 0.25));
          structuredParts.push({
            partId: `${glyph.id}-vowel-top-geo`,
            component: baseComponent,
            char: dependentMetaForCoeng.char,
            category: dependentMetaForCoeng.category,
            color: getColorForCategory(dependentMetaForCoeng.category, dependentMetaForCoeng.char),
            zone: 'split_vowel_top',
            hbGlyphId: baseComponent?.hbGlyphId,
            clipRect: { x: bb.x1, y: bb.y1, width: bbWidth, height: topH },
          });
        }
      }

      charMeta
        .filter((m) => m.category === 'diacritic_sign' || m.category === 'diacritic')
        .forEach((meta) => {
          const comp = pickComponentForCategory(glyph, meta.category, meta.unitIdx, charMeta);
          structuredParts.push({
            partId: `${glyph.id}-coeng-diacritic-${meta.unitIdx}`,
            component: comp,
            char: meta.char,
            category: meta.category,
            color: getColorForCategory(meta.category, meta.char),
            zone: 'mark',
            hbGlyphId: comp?.hbGlyphId,
            clipRect: componentToClipRect(comp, meta.category),
          });
        });

      console.log('[MAPPER] isLeftSplitVowelCase → parts:', structuredParts.length);
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
      adjustBaseClipRect(part, clusterHasSubscript, glyph.components);
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