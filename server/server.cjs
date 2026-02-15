const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const opentype = require('opentype.js');

const PORT = Number(process.env.PORT || 3001);
const FONT_PATHS = [
  path.join(process.cwd(), 'public/fonts/KhmerOSBattambang.ttf'),
  path.join(process.cwd(), 'public/fonts/KhmerOS_siemreap.ttf'),
  path.join(process.cwd(), 'public/fonts/NotoSansKhmer-Regular.ttf')
];

const { isKhmerConsonantChar, isKhmerDependentVowel, isKhmerDiacriticOrSign } = require('../src/lib/khmerClassifier.cjs');

let hb;
let hbFont;
let hbFace;
let hbBlob;
let otFont;

function loadFontBuffer() {
  for (const candidate of FONT_PATHS) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate);
    }
  }
  throw new Error('Font file not found. Place KhmerOSBattambang.ttf in public/fonts/');
}

async function initShaper() {
  if (hbFont && otFont) return;
  hb = await require('harfbuzzjs');
  const fontData = loadFontBuffer();
  const arrayBuffer = fontData.buffer.slice(fontData.byteOffset, fontData.byteOffset + fontData.byteLength);

  hbBlob = hb.createBlob(arrayBuffer);
  hbFace = hb.createFace(hbBlob, 0);
  hbFont = hb.createFont(hbFace);
  otFont = opentype.parse(arrayBuffer);
}

function getGlyphPathAndBBox(glyphId) {
  try {
    const glyphObj = otFont.glyphs.get(glyphId);
    if (glyphObj) {
      const path = glyphObj.getPath(0, 0, otFont.unitsPerEm);
      const bb = path.getBoundingBox();
      return {
        d: path.toPathData(2),
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

  await initShaper();

  const buffer = hb.createBuffer();
  const clusterLevel = options.clusterLevel !== undefined ? options.clusterLevel : 0;
  buffer.setClusterLevel(clusterLevel);  // важно до addText
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
  console.log('[shape] Shaped glyphs:', shaped.length);

  // Группировка по кластеру
  const clusters = new Map();
  let globalX = 0;

  for (let i = 0; i < shaped.length; i++) {
    const glyph = shaped[i];
    const cl = glyph.cl;
    if (!clusters.has(cl)) {
      clusters.set(cl, { glyphRecords: [], baseX: globalX });
    }
    clusters.get(cl).glyphRecords.push(glyph);
    // Не увеличиваем globalX здесь – сделаем после обработки кластера
  }

  const sortedClusters = Array.from(clusters.entries()).sort((a, b) => a[0] - b[0]);
  const result = [];

  for (const [cl, { glyphRecords }] of sortedClusters) {
    // Определяем текстовый диапазон кластера
    const nextCluster = sortedClusters.find(c => c[0] > cl)?.[0] ?? text.length;
    const clusterStart = cl;
    const clusterEnd = nextCluster;
    const clusterText = text.slice(clusterStart, clusterEnd);
    const chars = Array.from(clusterText);
    const codePoints = chars.map(c => c.codePointAt(0));
    const primaryChar = chars.find(c => isKhmerConsonantChar(c)) || chars[0] || '';
    const hasCoeng = codePoints.includes(0x17d2);
    const hasSubscriptConsonant = chars.some((c, i) => codePoints[i-1] === 0x17d2 && isKhmerConsonantChar(c));
    const hasDependentVowel = chars.some(c => isKhmerDependentVowel(c));
    const hasDiacritic = chars.some(c => isKhmerDiacriticOrSign(c));

    const components = [];
    let clusterAdvance = 0;
    let clusterPenX = globalX;

    for (let i = 0; i < glyphRecords.length; i++) {
      const rec = glyphRecords[i];
      const { d, bb } = getGlyphPathAndBBox(rec.g);
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
        clusterIndex: i,  // порядковый номер в кластере
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
      // для обратной совместимости
      d: components[0]?.d || '',
      bb: components[0]?.bb || { x1:0, y1:0, x2:0, y2:0 },
      advance: clusterAdvance,
      x: components[0]?.x || globalX,
      y: components[0]?.y || 0,
      fontInfo: {
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

  if (parsed.pathname === '/api/shape' && req.method === 'GET') {
    try {
      const features = parseFeaturesFromQuery(parsed.query.features);
      const clusterLevel = parsed.query.clusterLevel ? parseInt(parsed.query.clusterLevel, 10) : 0;
      const shaped = await shapeText(parsed.query.text || '', { features, clusterLevel });
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
  console.log(`Features API: /api/shape?text=កៅ&features=liga:0,ccmp:0`);
});
