import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEduUnits } from '../src/lib/eduUnits.js';
import { createClipPathParts } from '../src/lib/simpleGlyphSplit.js';

test('buildEduUnits includes source ranges for every unit', () => {
  const units = buildEduUnits('ក្បា ្រ');
  assert.equal(units.length > 0, true);
  for (const unit of units) {
    assert.equal(Number.isInteger(unit.sourceStart), true);
    assert.equal(Number.isInteger(unit.sourceEnd), true);
    assert.equal(unit.sourceEnd > unit.sourceStart, true);
  }
});

test('createClipPathParts keeps only units from current cluster range', () => {
  const text = 'ក្បា ្រ';
  const units = buildEduUnits(text);

  const glyph = {
    d: 'M0 0L10 0L10 10L0 10Z',
    bb: { x1: 0, y1: 0, x2: 100, y2: 100 },
    codePoints: [0x17D2, 0x1794, 0x17B6], // ្ ប ា
    clusterStart: 1,
    clusterEnd: 4,
  };

  const parts = createClipPathParts(glyph, units);
  const labels = parts.map((p) => `${p.char}:${p.category}`);

  assert.deepEqual(labels, [
    '្ប:subscript_consonant',
    'ា:dependent_vowel',
  ]);
});
