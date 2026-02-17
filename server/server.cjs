const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const opentype = require('opentype.js');

const PORT = Number(process.env.PORT || 3001);
const FONTS_DIR = path.join(process.cwd(), 'public/fonts');
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const FONT_LABEL_OVERRIDES = {
  KhmerOSBattambang: 'Khmer OS Battambang',
  KhmerOS_siemreap: 'Khmer OS Siemreap',
  'NotoSansKhmer-Regular': 'Noto Sans Khmer'
};

// Инлайн-копия из khmerClassifier.js (избегаем проблем с ES-модулями в CJS)
const KHMER_CONSONANT_START = 0x1780;
const KHMER_CONSONANT_END   = 0x17A2;
const KHMER_DEP_VOWEL_START = 0x17B6;
const KHMER_DEP_VOWEL_END   = 0x17C5;
const KHMER_DIACRITIC_RANGES = [[0x17C6, 0x17D1], [0x17D3, 0x17D3], [0x17DD, 0x17DD]];

function isKhmerConsonantChar(char) {
  const cp = char ? char.codePointAt(0) : -1;
  return cp >= KHMER_CONSONANT_START && cp <= KHMER_CONSONANT_END;
}
function isKhmerDependentVowel(char) {
  const cp = char ? char.codePointAt(0) : -1;
  return cp >= KHMER_DEP_VOWEL_START && cp <= KHMER_DEP_VOWEL_END;
}
function isKhmerDiacriticOrSign(char) {
  const cp = char ? char.codePointAt(0) : -1;
  return KHMER_DIACRITIC_RANGES.some(([s, e]) => cp >= s && cp <= e);
}

let hb;
const shaperCache = new Map();
const fontValidationCache = new Map();

// ─── Кэш метрик: fontId → { consonants, subscripts, vowels, diacritics } ──
const metricsCache = new Map();

// Все кодпоинты кхмерских согласных
const KHMER_CONSONANTS = Array.from({ length: 0x17A3 - 0x1780 }, (_, i) => 0x1780 + i);

// Все кодпоинты зависимых гласных
const KHMER_DEP_VOWELS = Array.from({ length: 0x17C6 - 0x17B6 }, (_, i) => 0x17B6 + i);

// Диакритики и знаки
const KHMER_DIACRITICS = [
  ...Array.from({ length: 0x17D2 - 0x17C6 }, (_, i) => 0x17C6 + i),
  0x17D3, 0x17DD
];

// ─── Независимые гласные ──────────────────────────────────────────────────
const KHMER_INDEP_VOWELS = Array.from({ length: 0x17B4 - 0x17A3 }, (_, i) => 0x17A3 + i);

// Coeng (подписной знак)
const COENG = 0x17D2;

function toFontId(fileName) {
  return fileName
    .replace(path.extname(fileName), '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toLabel(fileName) {
  const base = fileName.replace(path.extname(fileName), '');
  if (FONT_LABEL_OVERRIDES[base]) return FONT_LABEL_OVERRIDES[base];
  return base
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function discoverFontCatalog() {
  if (!fs.existsSync(FONTS_DIR)) return [];
  const allEntries = fs.readdirSync(FONTS_DIR, { withFileTypes: true });
  const fontFiles = allEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => FONT_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  const usedIds = new Map();
  return fontFiles.map((fileName) => {
    const baseId = toFontId(fileName) || 'font';
    const count = (usedIds.get(baseId) || 0) + 1;
    usedIds.set(baseId, count);
    const id = count === 1 ? baseId : `${baseId}-${count}`;
    return { id, label: toLabel(fileName), path: path.join(FONTS_DIR, fileName), file: fileName };
  });
}

function canParseFontFile(fontPath) {
  const stat = fs.statSync(fontPath);
  const cacheKey = `${fontPath}:${stat.mtimeMs}:${stat.size}`;
  if (fontValidationCache.has(cacheKey)) return fontValidationCache.get(cacheKey);
  try {
    const fontData = fs.readFileSync(fontPath);
    const arrayBuffer = fontData.buffer.slice(fontData.byteOffset, fontData.byteOffset + fontData.byteLength);
    opentype.parse(arrayBuffer);
    fontValidationCache.set(cacheKey, true);
    return true;
  } catch (error) {
    console.warn('[font:warn] skipping unusable font', path.basename(fontPath), error.message);
    fontValidationCache.set(cacheKey, false);
    return false;
  }
}

function getFontStatus(font) {
  if (!fs.existsSync(font.path)) return { id: font.id, label: font.label, file: font.file, available: false, reason: 'missing_file' };
  const fileSize = fs.statSync(font.path).size;
  if (fileSize === 0) return { id: font.id, label: font.label, file: font.file, available: false, reason: 'empty_file' };
  if (!canParseFontFile(font.path)) return { id: font.id, label: font.label, file: font.file, available: false, reason: 'invalid_font' };
  return { id: font.id, label: font.label, file: font.file, available: true, reason: null };
}

function getFontOptions() { return discoverFontCatalog().map(getFontStatus); }
function getAvailableFonts() { return getFontOptions().filter((font) => font.available); }

function resolveFontEntry(fontId) {
  const catalog = discoverFontCatalog();
  const available = getAvailableFonts();
  if (available.length === 0) throw new Error('No valid font files found in public/fonts');
  if (!fontId || fontId === 'auto') {
    const first = available[0];
    return catalog.find((font) => font.id === first.id);
  }
  const found = catalog.find((font) => font.id === fontId && fs.existsSync(font.path));
  if (found) return found;
  const first = available[0];
  return catalog.find((font) => font.id === first.id);
}

async function getShaperForFont(fontId) {
  if (!hb) hb = await require('harfbuzzjs');
  const fontEntry = resolveFontEntry(fontId);
  if (shaperCache.has(fontEntry.id)) return { ...shaperCache.get(fontEntry.id), fontEntry };
  const fontData = fs.readFileSync(fontEntry.path);
  const arrayBuffer = fontData.buffer.slice(fontData.byteOffset, fontData.byteOffset + fontData.byteLength);
  const hbBlob = hb.createBlob(arrayBuffer);
  const hbFace = hb.createFace(hbBlob, 0);
  const hbFont = hb.createFont(hbFace);
  const otFont = opentype.parse(arrayBuffer);
  const shaper = { hbBlob, hbFace, hbFont, otFont };
  shaperCache.set(fontEntry.id, shaper);
  return { ...shaper, fontEntry };
}

function getGlyphPathAndBBox(otFont, glyphId) {
  try {
    const glyphObj = otFont.glyphs.get(glyphId);
    if (glyphObj) {
      const pathData = glyphObj.getPath(0, 0, otFont.unitsPerEm);
      const bb = pathData.getBoundingBox();
      return { d: pathData.toPathData(2), bb: { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 } };
    }
  } catch (e) {
    console.warn('[glyph:warn]', e.message);
  }
  return { d: '', bb: { x1: 0, y1: 0, x2: 0, y2: 0 } };
}

/**
 * Шейпим одну строку и возвращаем список компонентов с bbox.
 * Используется внутри buildFontMetrics для изоляции символов.
 */
function shapeString(hbFont, otFont, text) {
  const buf = hb.createBuffer();
  buf.setClusterLevel(2); // уровень 2 = каждый символ отдельно
  buf.addText(text);
  buf.guessSegmentProperties();
  hb.shape(hbFont, buf);
  const records = buf.json();
  buf.destroy();

  return records.map((rec) => {
    const { bb } = getGlyphPathAndBBox(otFont, rec.g);
    return { glyphId: rec.g, cp: rec.cl, bb };
  });
}

/**
 * Строим полные метрики для шрифта.
 *
 * Возвращает объект:
 * {
 *   unitsPerEm,
 *   consonants: {
 *     [codePoint]: { glyphId, bb }   // bb согласной в изоляции
 *   },
 *   subscripts: {
 *     [codePoint]: { glyphId, bb }   // bb подписной формы (coeng + согласная)
 *   },
 *   vowels: {
 *     [codePoint]: {
 *       glyphId,
 *       bb,
 *       components: [{ glyphId, bb }]  // если гласная → несколько глифов
 *     }
 *   },
 *   diacritics: {
 *     [codePoint]: { glyphId, bb }
 *   }
 * }
 *
 * Для каждой подписной шейпим пару "ក + coeng + X" и вычитаем bbox ក,
 * чтобы получить bbox только подписной части.
 */
async function buildFontMetrics(hbFont, otFont) {
  const unitsPerEm = otFont.unitsPerEm;
  const BASE_CONSONANT = 0x1780; // ក — стабильная нейтральная база

  // ── 1. БАЗОВЫЕ СОГЛАСНЫЕ в изоляции ─────────────────────────────────────
  const consonants = {};
  for (const cp of KHMER_CONSONANTS) {
    const char = String.fromCodePoint(cp);
    const [rec] = shapeString(hbFont, otFont, char);
    if (rec && (rec.bb.x2 - rec.bb.x1 > 0)) {
      consonants[cp] = { glyphId: rec.glyphId, bb: rec.bb };
    }
  }

  // ── 2. ПОДПИСНЫЕ ФОРМЫ: шейпим "ក + ្ + X" ───────────────────────────
  // Берём реальный bbox кластера, вычитаем bbox базы → получаем bbox подписной.
  const subscripts = {};
  const baseRec = consonants[BASE_CONSONANT];

  for (const cp of KHMER_CONSONANTS) {
    const subChar = String.fromCodePoint(BASE_CONSONANT, COENG, cp);
    const records = shapeString(hbFont, otFont, subChar);

    if (!records.length) continue;

    // Общий bbox кластера
    const clusterBB = {
      x1: Math.min(...records.map(r => r.bb.x1)),
      y1: Math.min(...records.map(r => r.bb.y1)),
      x2: Math.max(...records.map(r => r.bb.x2)),
      y2: Math.max(...records.map(r => r.bb.y2)),
    };

    // Если шейпер разбил на 2+ компонента — берём наименьший по Y (нижний)
    if (records.length >= 2) {
      // Компонент с наибольшим y1 — самый нижний
      const subComp = records.reduce((a, b) => a.bb.y1 > b.bb.y1 ? a : b);
      subscripts[cp] = { glyphId: subComp.glyphId, bb: subComp.bb, clusterBB };
    } else {
      // Слитный глиф — вычитаем bbox базовой согласной по Y
      // Верхняя граница подписной ≈ нижняя граница тела базы
      const baseBodyY2 = baseRec ? baseRec.bb.y2 : clusterBB.y1 + (clusterBB.y2 - clusterBB.y1) * 0.6;
      subscripts[cp] = {
        glyphId: records[0].glyphId,
        bb: {
          x1: clusterBB.x1,
          y1: baseBodyY2,
          x2: clusterBB.x2,
          y2: clusterBB.y2,
        },
        clusterBB,
        merged: true, // флаг: подписная слита с базой
      };
    }
  }

  // ── 3. ГЛАСНЫЕ: шейпим "ក + гласная" ─────────────────────────────────
  // Берём bbox кластера и вычитаем bbox ក → получаем bbox гласной.
  const vowels = {};
  const baseChar = String.fromCodePoint(BASE_CONSONANT);

  for (const cp of KHMER_DEP_VOWELS) {
    const vowelStr = String.fromCodePoint(BASE_CONSONANT, cp);
    const records = shapeString(hbFont, otFont, vowelStr);

    if (!records.length) continue;

    const clusterBB = {
      x1: Math.min(...records.map(r => r.bb.x1)),
      y1: Math.min(...records.map(r => r.bb.y1)),
      x2: Math.max(...records.map(r => r.bb.x2)),
      y2: Math.max(...records.map(r => r.bb.y2)),
    };

    if (records.length >= 2) {
      // Несколько компонентов — каждый описываем отдельно
      // Базовый компонент = тот, что совпадает с изолированной базой по glyphId
      const baseGlyphId = consonants[BASE_CONSONANT]?.glyphId;
      const vowelComponents = records.filter(r => r.glyphId !== baseGlyphId);
      const primaryVowelComp = records.find(r => r.glyphId !== baseGlyphId) || records[records.length - 1];

      vowels[cp] = {
        glyphId: primaryVowelComp.glyphId,
        bb: primaryVowelComp.bb,
        clusterBB,
        components: vowelComponents.map(r => ({ glyphId: r.glyphId, bb: r.bb })),
        multipart: vowelComponents.length > 1,
      };
    } else {
      // Слитный глиф — определяем зону гласной как разницу с bbox базы
      const baseBB = consonants[BASE_CONSONANT]?.bb;
      vowels[cp] = {
        glyphId: records[0].glyphId,
        bb: records[0].bb,
        clusterBB,
        components: [],
        multipart: false,
        merged: true,
        // Для слитных сохраняем разницу: насколько кластер шире/выше/ниже базы
        delta: baseBB ? {
          top:    baseBB.y1 - clusterBB.y1,   // сколько гласная выступает вверх
          bottom: clusterBB.y2 - baseBB.y2,   // сколько выступает вниз
          left:   baseBB.x1 - clusterBB.x1,   // сколько выступает влево
          right:  clusterBB.x2 - baseBB.x2,   // сколько выступает вправо
        } : null,
      };
    }
  }

  // ── 4. НЕЗАВИСИМЫЕ ГЛАСНЫЕ в изоляции ────────────────────────────────────
  const indepVowels = {};
  for (const cp of KHMER_INDEP_VOWELS) {
    const char = String.fromCodePoint(cp);
    const [rec] = shapeString(hbFont, otFont, char);
    if (rec && (rec.bb.x2 - rec.bb.x1 > 0)) {
      indepVowels[cp] = { glyphId: rec.glyphId, bb: rec.bb };
    }
  }

  // ── 5. ДИАКРИТИКИ: шейпим "ក + диакритик" ────────────────────────────────
  const diacritics = {};

  for (const cp of KHMER_DIACRITICS) {
    const diaStr = String.fromCodePoint(BASE_CONSONANT, cp);
    const records = shapeString(hbFont, otFont, diaStr);

    if (!records.length) continue;

    const clusterBB = {
      x1: Math.min(...records.map(r => r.bb.x1)),
      y1: Math.min(...records.map(r => r.bb.y1)),
      x2: Math.max(...records.map(r => r.bb.x2)),
      y2: Math.max(...records.map(r => r.bb.y2)),
    };

    const baseGlyphId = consonants[BASE_CONSONANT]?.glyphId;
    if (records.length >= 2) {
      const diaComp = records.find(r => r.glyphId !== baseGlyphId) || records[records.length - 1];
      diacritics[cp] = { glyphId: diaComp.glyphId, bb: diaComp.bb, clusterBB };
    } else {
      // Слитный — диакритик выступает сверху
      const baseBB = consonants[BASE_CONSONANT]?.bb;
      diacritics[cp] = {
        glyphId: records[0].glyphId,
        bb: records[0].bb,
        clusterBB,
        merged: true,
        delta: baseBB ? {
          top: baseBB.y1 - clusterBB.y1,
        } : null,
      };
    }
  }

  return { unitsPerEm, consonants, subscripts, vowels, indepVowels, diacritics };
}

function parseFeaturesFromQuery(featuresStr) {
  if (!featuresStr) return null;
  const features = [];
  const pairs = featuresStr.split(',');
  for (const pair of pairs) {
    const [tag, valueStr] = pair.trim().split(':');
    if (tag && valueStr !== undefined) {
      features.push({ tag: tag.trim(), value: parseInt(valueStr, 10) || 0 });
    }
  }
  return features.length > 0 ? features : null;
}

async function shapeText(rawText, options = {}) {
  const text = (rawText || '').normalize('NFC');
  if (!text) return [];

  const { hbFont, otFont, fontEntry } = await getShaperForFont(options.fontId);
  const buffer = hb.createBuffer();
  const clusterLevel = options.clusterLevel !== undefined ? options.clusterLevel : 0;
  buffer.setClusterLevel(clusterLevel);
  buffer.addText(text);
  buffer.guessSegmentProperties();

  const features = options.features || null;
  if (features && Array.isArray(features)) {
    console.log('[shape] Using features:', features);
    hb.shape(hbFont, buffer, { features });
  } else {
    console.log('[shape] No features, default shaping');
    hb.shape(hbFont, buffer);
  }

  const shaped = buffer.json();
  console.log('[shape] Shaped glyphs:', shaped.length, 'font:', fontEntry.id);

  const clusters = new Map();
  let globalX = 0;

  for (let i = 0; i < shaped.length; i++) {
    const glyph = shaped[i];
    const cl = glyph.cl;
    if (!clusters.has(cl)) clusters.set(cl, { glyphRecords: [], baseX: globalX });
    clusters.get(cl).glyphRecords.push(glyph);
  }

  const sortedClusters = Array.from(clusters.entries()).sort((a, b) => a[0] - b[0]);
  const result = [];

  for (const [cl, { glyphRecords }] of sortedClusters) {
    const nextCluster = sortedClusters.find(c => c[0] > cl)?.[0] ?? text.length;
    const clusterStart = cl;
    const clusterEnd = nextCluster;
    const clusterText = text.slice(clusterStart, clusterEnd);
    const chars = Array.from(clusterText);
    const codePoints = chars.map(c => c.codePointAt(0));
    const primaryChar = chars.find(c => isKhmerConsonantChar(c)) || chars[0] || '';
    const hasCoeng = codePoints.includes(0x17d2);
    const hasSubscriptConsonant = chars.some((c, i) => codePoints[i - 1] === 0x17d2 && isKhmerConsonantChar(c));
    const hasDependentVowel = chars.some(c => isKhmerDependentVowel(c));
    const hasDiacritic = chars.some(c => isKhmerDiacriticOrSign(c));

    const components = [];
    let clusterAdvance = 0;
    let clusterPenX = globalX;

    for (let i = 0; i < glyphRecords.length; i++) {
      const rec = glyphRecords[i];
      const { d, bb } = getGlyphPathAndBBox(otFont, rec.g);
      const x = clusterPenX + rec.dx;
      const y = -rec.dy;

      components.push({
        hbGlyphId: rec.g,
        d,
        bb,
        x,
        y,
        advance: rec.ax,
        clusterIndex: i,
      });

      clusterPenX += rec.ax;
      clusterAdvance += rec.ax;
    }

    const glyphObj = {
      id: result.length,
      cluster: cl,
      clusterStart,
      clusterEnd,
      clusterText,
      chars,
      codePoints,
      primaryChar,
      hasCoeng,
      hasSubscriptConsonant,
      hasDependentVowel,
      hasDiacritic,
      components,
      d: components[0]?.d || '',
      bb: components[0]?.bb || { x1: 0, y1: 0, x2: 0, y2: 0 },
      advance: clusterAdvance,
      x: components[0]?.x || globalX,
      y: components[0]?.y || 0,
      fontInfo: {
        fontId: fontEntry.id,
        fontLabel: fontEntry.label,
        fontFile: path.basename(fontEntry.path),
        fontName: otFont.names.fullName?.en || 'Unknown',
        fontVersion: otFont.names.version?.en || 'Unknown',
        unitsPerEm: otFont.unitsPerEm
      }
    };

    result.push(glyphObj);
    globalX += clusterAdvance;
  }

  buffer.destroy();
  return result;
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end('OK');
    return;
  }

  if (parsed.pathname === '/api/fonts' && req.method === 'GET') {
    json(res, 200, { fonts: getFontOptions(), defaultFontId: getAvailableFonts()[0]?.id || null });
    return;
  }

  if (parsed.pathname === '/api/shape' && req.method === 'GET') {
    try {
      const features = parseFeaturesFromQuery(parsed.query.features);
      const clusterLevel = parsed.query.clusterLevel ? parseInt(parsed.query.clusterLevel, 10) : 0;
      const fontId = typeof parsed.query.font === 'string' ? parsed.query.font : 'auto';
      const shaped = await shapeText(parsed.query.text || '', { features, clusterLevel, fontId });
      json(res, 200, shaped);
    } catch (error) {
      console.error('[shape:error]', error);
      json(res, 500, { error: error.message });
    }
    return;
  }

  // ── /api/metrics?font=auto ───────────────────────────────────────────────
  // Возвращает реальные bbox всех кхмерских символов для данного шрифта.
  // Результат кэшируется на время работы сервера (пересчитывается при смене шрифта).
  if (parsed.pathname === '/api/metrics' && req.method === 'GET') {
    try {
      const fontId = typeof parsed.query.font === 'string' ? parsed.query.font : 'auto';
      const { hbFont, otFont, fontEntry } = await getShaperForFont(fontId);
      const cacheKey = fontEntry.id;

      if (!metricsCache.has(cacheKey)) {
        console.log('[metrics] Building metrics for font:', fontEntry.id);
        const metrics = await buildFontMetrics(hbFont, otFont);
        metricsCache.set(cacheKey, metrics);
        console.log('[metrics] Done. Consonants:', Object.keys(metrics.consonants).length,
          'Subscripts:', Object.keys(metrics.subscripts).length,
          'Vowels:', Object.keys(metrics.vowels).length,
          'Diacritics:', Object.keys(metrics.diacritics).length);
      }

      json(res, 200, { fontId: fontEntry.id, ...metricsCache.get(cacheKey) });
    } catch (error) {
      console.error('[metrics:error]', error);
      json(res, 500, { error: error.message });
    }
    return;
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Khmer Glyph Lab API listening on http://localhost:${PORT}`);
  console.log('Fonts API:   /api/fonts');
  console.log('Shape API:   /api/shape?text=កៅ&font=auto');
  console.log('Metrics API: /api/metrics?font=auto');
});
