import test from 'node:test';
import assert from 'node:assert/strict';

import { getSoundFileForChar } from '../src/lib/audioMap.js';

test('returns mapped human audio file for a single consonant', () => {
  assert.equal(getSoundFileForChar('ក'), 'letter_ka.mp3');
});

test('returns mapped file for multi-character vowel cluster', () => {
  assert.equal(getSoundFileForChar('ុះ'), 'vowel_name_oh.mp3');
});

test('resolves coeng+consonant to consonant sound by default', () => {
  assert.equal(getSoundFileForChar('្វ'), 'letter_vo.mp3');
});

test('falls back to unicode filename for Khmer codepoint without explicit mapping', () => {
  assert.equal(getSoundFileForChar('ឲ'), 'U+17B2.mp3');
});

test('returns empty string for empty input', () => {
  assert.equal(getSoundFileForChar(''), '');
  assert.equal(getSoundFileForChar(null), '');
});
