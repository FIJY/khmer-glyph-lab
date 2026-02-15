import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEduUnits } from '../src/lib/eduUnits.js';

const labels = (units) => units.map((unit) => `${unit.text}:${unit.category}`);

test('keeps U+17BB (ុ) as dependent vowel in a simple cluster', () => {
  const units = buildEduUnits('កុ');
  assert.deepEqual(labels(units), ['ក:base_consonant', 'ុ:dependent_vowel']);
});

test('treats U+17BB + U+17C6 (ុំ) as two separate edu units', () => {
  const units = buildEduUnits('កុំ');
  assert.deepEqual(labels(units), ['ក:base_consonant', 'ុ:dependent_vowel', 'ំ:diacritic_sign']);
});

test('keeps coeng sequence separate from dependent vowel and nikahit', () => {
  const units = buildEduUnits('ក្ខុំ');
  assert.deepEqual(labels(units), [
    'ក:base_consonant',
    '្ខ:subscript_consonant',
    'ុ:dependent_vowel',
    'ំ:diacritic_sign'
  ]);
});
