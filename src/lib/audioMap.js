const U = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}.mp3`;

function rangeMap(start, end, makeFile) {
  const out = {};
  for (let cp = start; cp <= end; cp += 1) {
    out[String.fromCodePoint(cp)] = makeFile(cp);
  }
  return out;
}

const KHMER_BLOCK_FALLBACK = rangeMap(0x1780, 0x17FF, (cp) => U(cp));
const KHMER_SYMBOLS_FALLBACK = rangeMap(0x19E0, 0x19FF, (cp) => U(cp));

const BASIC_PUNCT_FALLBACK = {
  ' ': 'space.mp3',
  '.': 'dot.mp3',
  ',': 'comma.mp3',
  '!': 'exclamation.mp3',
  '?': 'question.mp3',
  ':': 'colon.mp3',
  ';': 'semicolon.mp3',
  '-': 'dash.mp3',
  '–': 'ndash.mp3',
  '—': 'mdash.mp3',
  '(': 'paren_open.mp3',
  ')': 'paren_close.mp3',
  '"': 'quote.mp3',
  '“': 'quote_open.mp3',
  '”': 'quote_close.mp3',
  "'": 'apostrophe.mp3',
  '\n': 'newline.mp3',
  '\t': 'tab.mp3',
};

const HUMAN_AUDIO_MAP = {
  'ក': 'letter_ka.mp3',
  'ខ': 'letter_kha.mp3',
  'គ': 'letter_ko.mp3',
  'ឃ': 'letter_kho.mp3',
  'ង': 'letter_ngo.mp3',
  'ច': 'letter_cha.mp3',
  'ឆ': 'letter_chha.mp3',
  'ជ': 'letter_cho.mp3',
  'ឈ': 'letter_chho.mp3',
  'ញ': 'letter_nyo.mp3',
  'ដ': 'letter_da.mp3',
  'ឋ': 'letter_tha_retro.mp3',
  'ឌ': 'letter_do.mp3',
  'ឍ': 'letter_tho_retro.mp3',
  'ណ': 'letter_na.mp3',
  'ត': 'letter_ta.mp3',
  'ថ': 'letter_tha.mp3',
  'ទ': 'letter_to.mp3',
  'ធ': 'letter_tho.mp3',
  'ន': 'letter_no.mp3',
  'ប': 'letter_ba.mp3',
  'ផ': 'letter_pha.mp3',
  'ព': 'letter_po.mp3',
  'ភ': 'letter_pho.mp3',
  'ម': 'letter_mo.mp3',
  'យ': 'letter_yo.mp3',
  'រ': 'letter_ro.mp3',
  'ល': 'letter_lo.mp3',
  'វ': 'letter_vo.mp3',
  'ស': 'letter_sa.mp3',
  'ហ': 'letter_ha.mp3',
  'ឡ': 'letter_la.mp3',
  'អ': 'letter_qa.mp3',

  'ឥ': 'vowel_independent_e_indep.mp3',
  'ឦ': 'vowel_independent_ei_indep.mp3',
  'ឧ': 'vowel_independent_u_indep.mp3',
  'ឪ': 'vowel_independent_au_indep.mp3',
  'ឫ': 'vowel_independent_ry.mp3',
  'ឬ': 'vowel_independent_ryy.mp3',
  'ឭ': 'vowel_independent_ly.mp3',
  'ឮ': 'vowel_independent_lyy.mp3',
  'ឯ': 'vowel_independent_ae_indep.mp3',
  'ឱ': 'vowel_independent_ao_indep.mp3',
  'ឳ': 'vowel_independent_au_ra_indep.mp3',

  'ា': 'vowel_name_aa.mp3',
  'ាំ': 'vowel_name_aam.mp3',
  'ិ': 'vowel_name_i.mp3',
  'ី': 'vowel_name_ei.mp3',
  'ឹ': 'vowel_name_oe.mp3',
  'ឺ': 'vowel_name_oeu.mp3',
  'ុ': 'vowel_name_u.mp3',
  'ុំ': 'vowel_name_om.mp3',
  'ុះ': 'vowel_name_oh.mp3',
  'ូ': 'vowel_name_oo.mp3',
  'ួ': 'vowel_name_ua.mp3',
  'ើ': 'vowel_name_aeu.mp3',
  'ឿ': 'vowel_name_oea.mp3',
  'ៀ': 'vowel_name_ie.mp3',
  'េ': 'vowel_name_e.mp3',
  'េះ': 'vowel_name_eh.mp3',
  'ែ': 'vowel_name_ae.mp3',
  'ៃ': 'vowel_name_ai.mp3',
  'ោ': 'vowel_name_ao.mp3',
  'ោះ': 'vowel_name_oh_short.mp3',
  'ៅ': 'vowel_name_au.mp3',

  'ំ': 'sign_nikahit.mp3',
  'ះ': 'sign_reahmuk.mp3',
  'ៈ': 'sign_yuukaleapintu.mp3',
  '៉': 'sign_musakatoan.mp3',
  '៊': 'sign_treisap.mp3',
  '់': 'sign_bantoc.mp3',
  '៌': 'sign_robabat.mp3',
  '៍': 'sign_tantakheat.mp3',
  '៎': 'sign_kakabat.mp3',
  '៏': 'sign_asda.mp3',
  '័': 'sign_samyok_sann.mp3',
  '្': 'sign_coeng.mp3',

  '។': 'sign_khan.mp3',
  '៕': 'sign_bariyour.mp3',
  'ៗ': 'sign_lek_to.mp3',
  '០': 'number_zero.mp3',
  '១': 'number_one.mp3',
  '១០': 'number_ten.mp3',
  '២': 'number_two.mp3',
  '៣': 'number_three.mp3',
  '៤': 'number_four.mp3',
  '៥': 'number_five.mp3',
  '៦': 'number_six.mp3',
  '៧': 'number_seven.mp3',
  '៨': 'number_eight.mp3',
  '៩': 'number_nine.mp3',
};

export const AUDIO_MAP = {
  ...BASIC_PUNCT_FALLBACK,
  ...KHMER_BLOCK_FALLBACK,
  ...KHMER_SYMBOLS_FALLBACK,
  ...HUMAN_AUDIO_MAP,
};

const COENG = '្';

const SUBSCRIPT_OVERRIDES = {
  // '្វ': 'sub_vo.mp3',
  // '្ត': 'sub_ta.mp3',
  // '្រ': 'sub_ro.mp3',
};

export function getSoundFileForChar(input) {
  if (!input) return '';

  const full = String(input);
  if (Object.prototype.hasOwnProperty.call(AUDIO_MAP, full)) {
    const file = AUDIO_MAP[full];
    return file === null ? null : file || '';
  }

  const cps = Array.from(full);
  if (cps.length >= 2 && cps[0] === COENG) {
    if (Object.prototype.hasOwnProperty.call(SUBSCRIPT_OVERRIDES, full)) {
      return SUBSCRIPT_OVERRIDES[full];
    }

    const consonant = cps[1];
    const file = AUDIO_MAP[consonant];
    return file === null ? null : file || '';
  }

  const first = cps[0] || '';
  const file = AUDIO_MAP[first];

  if (file === null) return null;
  return file || '';
}
