import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEduUnits } from '../src/lib/eduUnits.js';
import { mapGlyphsToParts } from '../src/lib/glyphPartMapper.js';

function mkRectPath(x1, y1, x2, y2) {
  return `M${x1} ${y1} L${x2} ${y1} L${x2} ${y2} L${x1} ${y2} Z`;
}

function mkComp(hbGlyphId, x, bb) {
  return {
    hbGlyphId,
    x,
    y: 0,
    advance: 0,
    d: mkRectPath(bb.x1, bb.y1, bb.x2, bb.y2),
    bb,
  };
}

test('keeps trailing right split for ក្វា (coeng+subscript+ា)', () => {
  const text = 'ក្វា';
  const units = buildEduUnits(text);

  const glyph = {
    id: 0,
    chars: ['ក', '្', 'វ', 'ា'],
    codePoints: [0x1780, 0x17D2, 0x179C, 0x17B6],
    clusterStart: 0,
    clusterEnd: text.length,
    x: 0,
    y: 0,
    advance: 2100,
    d: mkRectPath(0, -1600, 2200, 700),
    bb: { x1: 0, y1: -1600, x2: 2200, y2: 700 },
    components: [
      mkComp(435, 0, { x1: 150, y1: -1500, x2: 1850, y2: 0 }),
      mkComp(411, 1400, { x1: -1100, y1: 50, x2: -300, y2: 650 }),
    ],
  };

  const mapped = mapGlyphsToParts([glyph], units, { enableSegmentation: true })[0].parts;

  assert.equal(mapped.some((p) => p.zone === 'split_base' && p.category === 'base_consonant'), true);
  assert.equal(mapped.some((p) => p.zone === 'split_vowel_trailing' && p.char === 'ា'), true);
  assert.equal(mapped.some((p) => p.zone === 'split_coeng' && p.category === 'coeng'), true);
  assert.equal(mapped.some((p) => p.zone === 'split_subscript' && p.category === 'subscript_consonant'), true);
});

test('keeps both leading and trailing vowel slices for ក្វោ', () => {
  const text = 'ក្វោ';
  const units = buildEduUnits(text);

  const glyph = {
    id: 0,
    chars: ['ក', '្', 'វ', 'ោ'],
    codePoints: [0x1780, 0x17D2, 0x179C, 0x17C4],
    clusterStart: 0,
    clusterEnd: text.length,
    x: 0,
    y: 0,
    advance: 2800,
    d: mkRectPath(0, -1600, 2800, 700),
    bb: { x1: 0, y1: -1600, x2: 2800, y2: 700 },
    components: [
      mkComp(627, 0, { x1: 50, y1: -1500, x2: 600, y2: 0 }),
      mkComp(435, 700, { x1: 150, y1: -1500, x2: 1850, y2: 0 }),
      mkComp(411, 2100, { x1: -1100, y1: 50, x2: -300, y2: 650 }),
    ],
  };

  const mapped = mapGlyphsToParts([glyph], units, { enableSegmentation: true })[0].parts;

  assert.equal(mapped.some((p) => p.zone === 'split_vowel_leading' && p.char === 'ោ'), true);
  assert.equal(mapped.some((p) => p.zone === 'split_vowel_trailing' && p.char === 'ោ'), true);
});


test('does not crop subscript component when separate lower component exists (ក្រា/ក្រែ/ក្រៅ/ក្សោ)', () => {
  const cases = [
    { text: 'ក្រា', vowel: 'ា', cp: 0x17B6, subCp: 0x179A },
    { text: 'ក្រែ', vowel: 'ែ', cp: 0x17C2, subCp: 0x179A },
    { text: 'ក្រៅ', vowel: 'ៅ', cp: 0x17C5, subCp: 0x179A },
    { text: 'ក្សោ', vowel: 'ោ', cp: 0x17C4, subCp: 0x179F },
  ];

  for (const item of cases) {
    const units = buildEduUnits(item.text);

    const glyph = {
      id: 0,
      chars: [...item.text],
      codePoints: [0x1780, 0x17D2, item.subCp, item.cp],
      clusterStart: 0,
      clusterEnd: item.text.length,
      x: 0,
      y: 0,
      advance: 2800,
      d: mkRectPath(0, -1600, 2800, 700),
      bb: { x1: 0, y1: -1600, x2: 2800, y2: 700 },
      components: [
        mkComp(627, 0, { x1: 50, y1: -1500, x2: 600, y2: 0 }),
        mkComp(435, 700, { x1: 150, y1: -1500, x2: 1850, y2: 0 }),
        mkComp(411, 2100, { x1: -1100, y1: 50, x2: -300, y2: 650 }),
      ],
    };

    const mapped = mapGlyphsToParts([glyph], units, { enableSegmentation: true })[0].parts;
    const sub = mapped.find((p) => p.category === 'subscript_consonant');
    assert.ok(sub, `${item.text}: missing subscript part`);

    const fullSubRect = componentToRect(glyph.components[2]);
    assert.deepEqual(
      sub.clipRect,
      fullSubRect,
      `${item.text}: subscript clip should keep full component bbox when separate component exists`
    );
  }
});

test('uses base-consonant component for split_base instead of largest non-base component (ក្រា regression)', () => {
  const text = 'ក្រា';
  const units = buildEduUnits(text);

  // Simulate a cluster where a non-base component has larger area than base.
  // split_base must still be anchored to the true base component.
  const baseComp = mkComp(435, 0, { x1: 120, y1: -1400, x2: 920, y2: -100 });
  const oversizedNonBaseComp = mkComp(901, 0, { x1: 60, y1: -1500, x2: 1900, y2: 650 });

  const glyph = {
    id: 0,
    chars: ['ក', '្', 'រ', 'ា'],
    codePoints: [0x1780, 0x17D2, 0x179A, 0x17B6],
    clusterStart: 0,
    clusterEnd: text.length,
    x: 0,
    y: 0,
    advance: 2200,
    d: mkRectPath(0, -1600, 2200, 700),
    bb: { x1: 0, y1: -1600, x2: 2200, y2: 700 },
    components: [baseComp, oversizedNonBaseComp],
  };

  const mapped = mapGlyphsToParts([glyph], units, { enableSegmentation: true })[0].parts;
  const basePart = mapped.find((p) => p.zone === 'split_base' && p.category === 'base_consonant');

  assert.ok(basePart, 'missing split_base base_consonant part');
  assert.equal(basePart.hbGlyphId, baseComp.hbGlyphId, 'split_base should be mapped to the true base component');
});

test('maps trailing vowel part to non-base component when right tail is fused there (no duplicate on base)', () => {
  const text = 'ក្រា';
  const units = buildEduUnits(text);

  const baseComp = mkComp(435, 0, { x1: 140, y1: -1400, x2: 980, y2: -120 });
  // Simulate fused subscript+vowel-right tail: much lower and extends farther right than base.
  const fusedLowerComp = mkComp(777, 0, { x1: -120, y1: -380, x2: 1880, y2: 680 });

  const glyph = {
    id: 0,
    chars: ['ក', '្', 'រ', 'ា'],
    codePoints: [0x1780, 0x17D2, 0x179A, 0x17B6],
    clusterStart: 0,
    clusterEnd: text.length,
    x: 0,
    y: 0,
    advance: 2300,
    d: mkRectPath(0, -1600, 2300, 700),
    bb: { x1: 0, y1: -1600, x2: 2300, y2: 700 },
    components: [baseComp, fusedLowerComp],
  };

  const mapped = mapGlyphsToParts([glyph], units, { enableSegmentation: true })[0].parts;
  const basePart = mapped.find((p) => p.zone === 'split_base' && p.category === 'base_consonant');
  const vowelTail = mapped.find((p) => p.zone === 'split_vowel_trailing' && p.category === 'dependent_vowel');

  assert.ok(basePart, 'missing split_base part');
  assert.ok(vowelTail, 'missing split_vowel_trailing part');

  assert.equal(basePart.hbGlyphId, baseComp.hbGlyphId, 'base should stay on base component');
  assert.equal(vowelTail.hbGlyphId, fusedLowerComp.hbGlyphId, 'trailing vowel should be attached to fused non-base component');
  assert.equal(basePart.clipRect.width, baseComp.bb.x2 - baseComp.bb.x1, 'base clip should remain full when tail is on non-base');
});

function componentToRect(comp) {
  return {
    x: comp.bb.x1,
    y: comp.bb.y1,
    width: comp.bb.x2 - comp.bb.x1,
    height: comp.bb.y2 - comp.bb.y1,
  };
}
