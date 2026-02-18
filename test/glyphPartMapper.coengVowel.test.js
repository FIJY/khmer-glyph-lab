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

function componentToRect(comp) {
  return {
    x: comp.bb.x1,
    y: comp.bb.y1,
    width: comp.bb.x2 - comp.bb.x1,
    height: comp.bb.y2 - comp.bb.y1,
  };
}
