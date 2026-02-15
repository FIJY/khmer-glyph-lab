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

function computeClusters(text, glyphRecords) {
  const starts = [...new Set(glyphRecords.map((g) => g.cl))].sort((a, b) => a - b);
  const boundaries = starts.map((start, i) => ({
    cluster: start,
    clusterStart: start,
    clusterEnd: starts[i + 1] ?? text.length
  }));
  const byCluster = new Map(boundaries.map((entry) => [entry.cluster, entry]));
  return byCluster;
}

function toGlyphMeta(text, shaped) {
  const clusters = computeClusters(text, shaped);
  let xCursor = 0;

  return shaped.map((glyph, index) => {
    const clusterMeta = clusters.get(glyph.cl) || { clusterStart: glyph.cl, clusterEnd: glyph.cl + 1 };
    const clusterText = text.slice(clusterMeta.clusterStart, clusterMeta.clusterEnd);
    const chars = Array.from(clusterText);
    const codePoints = chars.map((char) => char.codePointAt(0));

    const primaryChar = chars.find((char) => isKhmerConsonantChar(char)) || chars[0] || '';
    const hasCoeng = codePoints.includes(0x17d2);
    const hasSubscriptConsonant = chars.some((char, i) => codePoints[i - 1] === 0x17d2 && isKhmerConsonantChar(char));
    const hasDependentVowel = chars.some((char) => isKhmerDependentVowel(char));
    const hasDiacritic = chars.some((char) => isKhmerDiacriticOrSign(char));

    let glyphPath = null;
    let bb = { x1: 0, y1: 0, x2: 0, y2: 0 };
    try {
      const glyphObj = otFont.glyphs.get(glyph.g);
      if (glyphObj) {
        glyphPath = glyphObj.getPath(0, 0, otFont.unitsPerEm);
        bb = glyphPath.getBoundingBox();
      }
    } catch (glyphError) {
      console.warn('[glyph:warn]', glyphError.message);
    }

    const x = xCursor + glyph.dx;
    const y = glyph.dy;
    xCursor += glyph.ax;

    return {
      id: index,
      glyphIdx: index,
      hbGlyphId: glyph.g,
      cluster: glyph.cl,
      clusterStart: clusterMeta.clusterStart,
      clusterEnd: clusterMeta.clusterEnd,
      clusterText,
      chars,
      codePoints,
      primaryChar,
      hasCoeng,
      hasSubscriptConsonant,
      hasDependentVowel,
      hasDiacritic,
      d: glyphPath ? glyphPath.toPathData(2) : '',
      bb,
      advance: glyph.ax,
      x,
      y,
      fontInfo: {
        fontName: otFont.names.fullName?.en || 'Unknown',
        fontVersion: otFont.names.version?.en || 'Unknown',
        unitsPerEm: otFont.unitsPerEm
      }
    };
  });
}

async function shapeText(rawText) {
  const text = (rawText || '').normalize('NFC');
  if (!text) return [];

  await initShaper();

  const buffer = hb.createBuffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(hbFont, buffer);
  const shaped = buffer.json();
  const result = toGlyphMeta(text, shaped);
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
      const shaped = await shapeText(parsed.query.text || '');
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
});
