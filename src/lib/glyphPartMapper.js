import { createClipPathParts } from './simpleGlyphSplit.js';
import { getKhmerGlyphCategory } from './khmerClassifier.js';
import {
  getColorForCategory,
  shouldSplitBaseForDependentVowel
} from './glyphCombinationRules.js';

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

  if (category === 'base_consonant' || category === 'independent_vowel') {
    return baseCandidate;
  }

  if (category === 'dependent_vowel') {
    if (hasDiacritic) return baseCandidate;
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

function getComponentBasedParts(glyph, enableSegmentation) {
  const uniqueGlyphIds = new Set(glyph.components.map((c) => c.hbGlyphId));
  const shouldUseGeometryFallback =
    uniqueGlyphIds.size === 1 &&
    glyph.chars.length > 1 &&
    glyph.components.length === 1;

  if (shouldUseGeometryFallback) {
    if (!enableSegmentation) return [createFullGlyphPart(glyph)];

    return createClipPathParts(glyph, glyph.units).map((part, idx) => ({
      ...part,
      partId: `${glyph.id}-${idx}`,
    }));
  }

  const charMeta = glyph.chars.map((char, charIdx) => ({
    char,
    charIdx,
    category: getKhmerGlyphCategory(char, glyph.chars[charIdx - 1]),
  }));

  const hasBase = charMeta.some((item) => item.category === 'base_consonant' || item.category === 'independent_vowel');
  const hasDependent = charMeta.some((item) => item.category === 'dependent_vowel');

  const useAreaMapping = hasBase && hasDependent && glyph.components.length === 2 && charMeta.length === 2;

  let baseComponent = null;
  let dependentComponent = null;
  if (useAreaMapping) {
    const [first, second] = glyph.components;
    if (getComponentArea(first) >= getComponentArea(second)) {
      baseComponent = first;
      dependentComponent = second;
    } else {
      baseComponent = second;
      dependentComponent = first;
    }
  }

  const baseMeta = charMeta.find((item) => item.category === 'base_consonant' || item.category === 'independent_vowel');
  const dependentMeta = charMeta.find((item) => item.category === 'dependent_vowel');

  if (
    useAreaMapping &&
    baseMeta &&
    dependentMeta &&
    shouldSplitBaseForDependentVowel(dependentMeta.char) &&
    baseComponent?.bb
  ) {
    const bb = baseComponent.bb;
    const bbWidth = Math.max(0, (bb.x2 || 0) - (bb.x1 || 0));
    const bbHeight = Math.max(0, (bb.y2 || 0) - (bb.y1 || 0));
    const tailWidth = Math.max(120, bbWidth * 0.3);
    const baseClipWidth = Math.max(0, bbWidth - tailWidth);

    const parts = [
      {
        partId: `${glyph.id}-base-main`,
        component: baseComponent,
        char: baseMeta.char,
        category: baseMeta.category,
        color: getColorForCategory(baseMeta.category),
        zone: 'component_split_base',
        hbGlyphId: baseComponent?.hbGlyphId,
        clipRect: {
          x: bb.x1,
          y: bb.y1,
          width: baseClipWidth,
          height: bbHeight,
        },
      },
      {
        partId: `${glyph.id}-vowel-trailing`,
        component: baseComponent,
        char: dependentMeta.char,
        category: dependentMeta.category,
        color: getColorForCategory(dependentMeta.category),
        zone: 'component_split_vowel_trailing',
        hbGlyphId: baseComponent?.hbGlyphId,
        clipRect: {
          x: bb.x1 + baseClipWidth,
          y: bb.y1,
          width: Math.min(tailWidth, bbWidth),
          height: bbHeight,
        },
      }
    ];

    if (dependentComponent) {
      parts.splice(1, 0, {
        partId: `${glyph.id}-vowel-leading`,
        component: dependentComponent,
        char: dependentMeta.char,
        category: dependentMeta.category,
        color: getColorForCategory(dependentMeta.category),
        zone: 'component_split_vowel_leading',
        hbGlyphId: dependentComponent?.hbGlyphId,
      });
    }

    return parts;
  }

  return charMeta.map(({ char, charIdx, category }) => {
    let component = null;
    if (useAreaMapping && (category === 'base_consonant' || category === 'independent_vowel')) {
      component = baseComponent;
    } else if (useAreaMapping && category === 'dependent_vowel') {
      component = dependentComponent;
    } else {
      component = pickComponentForCategory(glyph, category, charIdx, charMeta);
    }

    return {
      partId: `${glyph.id}-${charIdx}`,
      component,
      char,
      category,
      color: getColorForCategory(category),
      zone: 'component',
      hbGlyphId: component?.hbGlyphId,
    };
  });
}

function mapSingleGlyphToParts(glyph, units, enableSegmentation) {
  if (!glyph.components || glyph.components.length === 0) {
    if (!enableSegmentation) return [createFullGlyphPart(glyph)];
    return createClipPathParts(glyph, units).map((part, idx) => ({
      ...part,
      partId: `${glyph.id}-${idx}`,
    }));
  }

  return getComponentBasedParts({ ...glyph, units }, enableSegmentation);
}

export function mapGlyphsToParts(glyphs, units, { enableSegmentation = true } = {}) {
  return (glyphs || []).map((glyph) => ({
    ...glyph,
    parts: mapSingleGlyphToParts(glyph, units, enableSegmentation),
  }));
}
