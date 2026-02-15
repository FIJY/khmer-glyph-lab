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

const { isKhmerConsonantChar, isKhmerDependentVowel, isKhmerDiacriticOrSign } = require('../src/lib/khmerClassifier.cjs');

let hb;
const shaperCache = new Map();

const fontValidationCache = new Map();

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
  if (!fs.existsSync(FONTS_DIR)) {
    return [];
  }

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

    return {
      id,
      label: toLabel(fileName),
      path: path.join(FONTS_DIR, fileName),
      file: fileName
    };
  });
}

function canParseFontFile(fontPath) {
  const stat = fs.statSync(fontPath);
  const cacheKey = `${fontPath}:${stat.mtimeMs}:${stat.size}`;

  if (fontValidationCache.has(cacheKey)) {
    return fontValidationCache.get(cacheKey);
  }

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
  if (!fs.existsSync(font.path)) {
    return {
      id: font.id,
      label: font.label,
      file: font.file,
      available: false,
      reason: 'missing_file'
    };
  }

  const fileSize = fs.statSync(font.path).size;
  if (fileSize === 0) {
    return {
      id: font.id,
      label: font.label,
      file: font.file,
      available: false,
      reason: 'empty_file'
    };
  }

  if (!canParseFontFile(font.path)) {
    return {
      id: font.id,
      label: font.label,
      file: font.file,
      available: false,
      reason: 'invalid_font'
    };
  }

  return {
    id: font.id,
    label: font.label,
    file: font.file,
    available: true,
    reason: null
  };
}

function getFontOptions() {
  return discoverFontCatalog().map(getFontStatus);
}

function getAvailableFonts() {
  return getFontOptions().filter((font) => font.available);
}

function resolveFontEntry(fontId) {
  const catalog = discoverFontCatalog();
  const available = getAvailableFonts();
  if (available.length === 0) {
    throw new Error('No valid font files found in public/fonts');
  }

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
  if (!hb) {
    hb = await require('harfbuzzjs');
  }

  const fontEntry = resolveFontEntry(fontId);
  if (shaperCache.has(fontEntry.id)) {
    return { ...shaperCache.get(fontEntry.id), fontEntry };
  }

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
      return {
        d: pathData.toPathData(2),
        bb: { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 }
      };
    }
  } catch (e) {
    console.warn('[glyph:warn]', e.message);
  }
  return { d: '', bb: { x1: 0, y1: 0, x2: 0, y2: 0 } };
}

function parseFeaturesFromQuery(featuresStr) {
  if (!featuresStr) return null;
  const features = [];
  const pairs = featuresStr.split(',');
  for (const pair of pairs) {
    const [tag, valueStr] = pair.trim().split(':');
    if (tag && valueStr !== undefined) {
      features.push({
        tag: tag.trim(),
        value: parseInt(valueStr, 10) || 0
      });
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
    if (!clusters.has(cl)) {
      clusters.set(cl, { glyphRecords: [], baseX: globalX });
    }
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
      // HarfBuzz возвращает dy в системе координат "ось Y вверх",
      // а SVG рендерится с "ось Y вниз" — инвертируем знак.
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
    json(res, 200, {
      fonts: getFontOptions(),
      defaultFontId: getAvailableFonts()[0]?.id || null
    });
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

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Khmer Glyph Lab API listening on http://localhost:${PORT}`);
  console.log('Fonts API: /api/fonts');
  console.log('Shape API: /api/shape?text=កៅ&features=liga:0,ccmp:0&font=auto');
});
