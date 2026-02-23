// src/lib/khmerPositions.js

/**
 * Khmer dependent vowels: positional metadata (approximate for hints/debug).
 * IMPORTANT: use as hints only, not strict geometric clipping for production.
 */

export const KHMER_VOWEL_POSITIONS = {
  // right
  0x17B6: ["right"], // ា

  // top
  0x17B7: ["top"], // ិ
  0x17B8: ["top"], // ី
  0x17B9: ["top"], // ឹ
  0x17BA: ["top"], // ឺ
  0x17BD: ["top"], // ួ
  0x17BF: ["top"], // ឿ (often top/left-ish by font)

  // bottom
  0x17BB: ["bottom"], // ុ
  0x17BC: ["bottom"], // ូ

  // prefixed (left)
  0x17C1: ["left"], // េ
  0x17C2: ["left"], // ែ
  0x17C3: ["left"], // ៃ

  // complex vowels (font/shaper-dependent geometry)
  0x17BE: ["complex"], // ើ
  0x17C0: ["complex"], // ៀ
  0x17C4: ["complex"], // ោ
  0x17C5: ["complex"], // ៅ
};

export const KHMER_DIACRITIC_POSITIONS = {
  0x17C6: ["top"],    // ំ
  0x17C7: ["top"],    // ះ
  0x17C8: ["top"],    // ៈ
  0x17C9: ["top"],    // ៉
  0x17CA: ["top"],    // ៊
  0x17CB: ["top"],    // ់
  0x17CC: ["top"],    // ៌ (robat is usually rendered above in modern fonts)
  0x17CD: ["top"],    // ៍
  0x17CE: ["top"],    // ៎
  0x17CF: ["top"],    // ៏
  0x17D0: ["top"],    // ័
  0x17D1: ["top"],    // ៑
  0x17DD: ["top"],    // ៝
};


export const CATEGORY_COLORS = {
  base_consonant: "#22c55e",
  independent_vowel: "#22c55e",
  dependent_vowel: "#ef4444",
  subscript_consonant: "#3b82f6",
  diacritic_sign: "#f59e0b",
  diacritic: "#f59e0b",
  coeng: "#8b5cf6",
  other: "#111111",
};
