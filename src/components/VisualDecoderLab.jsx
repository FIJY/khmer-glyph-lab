import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildEduUnits } from "../lib/eduUnits.js";
import { mapGlyphsToParts } from "../lib/glyphPartMapper.js";
import { getStrokeForCategory } from "../lib/glyphCombinationRules.js";
import { loadMetrics, isMetricsLoaded, getRawMetrics } from "../lib/khmerConsonantMetrics.js";
import { getSoundFileForChar } from "../lib/audioMap.js";

const DEBUG = Boolean(globalThis.window?.__EDU_DEBUG__);

export default function VisualDecoderLab() {
  const [text, setText] = useState("កៅ");
  const [glyphs, setGlyphs] = useState([]);
  const [selectedGlyphId, setSelectedGlyphId] = useState(null);
  const [selectedChar, setSelectedChar] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [didAutoload, setDidAutoload] = useState(false);
  const [disableLigatures, setDisableLigatures] = useState(false);
  const [features, setFeatures] = useState('');
  const [clusterLevel, setClusterLevel] = useState(1);
  const [enableSegmentation, setEnableSegmentation] = useState(true);
  const [fontOptions, setFontOptions] = useState([]);
  const [selectedFont, setSelectedFont] = useState('auto');
  const [metricsReady, setMetricsReady] = useState(false);
  const [greenStrokeMode, setGreenStrokeMode] = useState('all');
  const [autoFitMode, setAutoFitMode] = useState('contain');
  const [consonantOutlineMode, setConsonantOutlineMode] = useState('default');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundStatus, setSoundStatus] = useState('');
  const [cardScale, setCardScale] = useState(1.25);
  const [autoMaxCardScale, setAutoMaxCardScale] = useState(true);
  const audioRef = useRef(null);

  const units = useMemo(() => buildEduUnits(text), [text]);

  const glyphsWithParts = useMemo(() => {
    return mapGlyphsToParts(glyphs, units, { enableSegmentation });
    // metricsReady в зависимостях — чтобы пересчитать после загрузки метрик
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glyphs, units, enableSegmentation, metricsReady]);

  // ── Загружаем метрики при смене шрифта ───────────────────────────────────
  async function fetchMetrics(fontId) {
    setMetricsReady(false);
    await loadMetrics(fontId);
    setMetricsReady(isMetricsLoaded());
  }

  async function loadFonts() {
    try {
      const response = await fetch('http://localhost:3001/api/fonts');
      if (!response.ok) return;
      const payload = await response.json();
      const fonts = Array.isArray(payload.fonts) ? payload.fonts : [];
      setFontOptions(fonts);
    } catch (fontError) {
      console.warn('[fonts] failed to load fonts', fontError);
    }
  }

  async function handleShape() {
    setLoading(true);
    setError("");
    setSelectedGlyphId(null);
    setSelectedChar(null);

    try {
      let url = `http://localhost:3001/api/shape?text=${encodeURIComponent(text)}`;
      if (clusterLevel !== 0) url += `&clusterLevel=${clusterLevel}`;
      if (selectedFont && selectedFont !== 'auto') url += `&font=${encodeURIComponent(selectedFont)}`;

      if (disableLigatures) {
        url += '&features=liga:0,ccmp:0,pres:0,abvs:0,psts:0';
      } else if (features.trim()) {
        url += `&features=${encodeURIComponent(features.trim())}`;
      }

      console.log('[API] Request URL:', url);

      const response = await fetch(url);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      if (DEBUG) console.log("[EDU_DEBUG] glyphs", data);
      console.log("[GLYPHS RAW]", data);

      const shapedGlyphs =
        (Array.isArray(data) && data) ||
        (Array.isArray(data?.glyphs) && data.glyphs) ||
        (Array.isArray(data?.run?.glyphs) && data.run.glyphs) ||
        (Array.isArray(data?.result?.glyphs) && data.result.glyphs) ||
        [];

      console.log("[GLYPHS PARSED]", {
        count: shapedGlyphs.length,
        first: shapedGlyphs[0] || null,
        keys: data && typeof data === "object" ? Object.keys(data) : null,
      });

      setGlyphs(shapedGlyphs);
    } finally {
      setLoading(false);
    }
  }

  // Обработчик смены шрифта — загружает метрики и перешейпит
  async function handleFontChange(newFontId) {
    setSelectedFont(newFontId);
    await fetchMetrics(newFontId);
  }

  useEffect(() => {
    if (didAutoload) return;
    setDidAutoload(true);
    Promise.all([
      loadFonts(),
      fetchMetrics('auto'),
      handleShape(),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didAutoload]);

  function playSelectedCharSound(char) {
    if (!soundEnabled || !char) return;

    const soundFile = getSoundFileForChar(char);
    if (!soundFile) {
      setSoundStatus(`Нет файла для символа: ${char}`);
      return;
    }

    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.src = `/sounds/${soundFile}`;
    audio.currentTime = 0;
    audio.play()
      .then(() => setSoundStatus(`▶️ ${soundFile}`))
      .catch((playError) => {
        console.warn('[audio] play failed', playError);
        setSoundStatus(`Ошибка проигрывания: ${soundFile}`);
      });
  }

  const selectedSoundFile = useMemo(() => getSoundFileForChar(selectedChar), [selectedChar]);

  const SCALE = 0.1;

  const width = Math.max(
    800,
    glyphs.reduce((acc, glyph) => Math.max(acc, (glyph.x + glyph.advance) * SCALE + 100), 800)
  );

  const verticalLayout = useMemo(() => {
    const TOP_PADDING = 50;
    const BOTTOM_PADDING = 120;
    const FALLBACK_ASCENT = 180;
    const FALLBACK_DESCENT = 120;
    const STROKE_MARGIN = 6;

    let minRelativeY = Infinity;
    let maxRelativeY = -Infinity;

    const pushBounds = (offsetY, bb) => {
      if (!bb) return;
      const top    = (offsetY + (bb.y1 || 0)) * SCALE;
      const bottom = (offsetY + (bb.y2 || 0)) * SCALE;
      minRelativeY = Math.min(minRelativeY, top, bottom);
      maxRelativeY = Math.max(maxRelativeY, top, bottom);
    };

    for (const glyph of glyphsWithParts) {
      for (const part of glyph.parts || []) {
        const source = part.component || glyph;
        pushBounds(source?.y || 0, source?.bb);
      }
      for (const component of glyph.components || []) {
        pushBounds(component?.y || 0, component?.bb);
      }
      pushBounds(glyph.y || 0, glyph.bb);
    }

    if (!Number.isFinite(minRelativeY) || !Number.isFinite(maxRelativeY)) {
      minRelativeY = -FALLBACK_ASCENT;
      maxRelativeY = FALLBACK_DESCENT;
    }

    const baselineY = TOP_PADDING + Math.max(0, -minRelativeY) + STROKE_MARGIN;
    const height = Math.max(400, Math.ceil(baselineY + maxRelativeY + BOTTOM_PADDING + STROKE_MARGIN));

    return {
      baselineY,
      height,
      ascenderLineY: Math.max(0, baselineY - FALLBACK_ASCENT),
      descenderLineY: Math.min(height, baselineY + FALLBACK_DESCENT),
      labelY: Math.min(height - 10, baselineY + 40),
    };
  }, [glyphsWithParts]);

  const heroPartsPreview = useMemo(() => {
    if (!glyphsWithParts.length) return null;

    const viewport = 260;
    const paddingX = 10;
    const paddingY = 12;
    const strokeSafetyUnits = 8;
    const autoBoost = 1.12;

    const renderedParts = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const lineBreakIndexes = [];
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '\n') lineBreakIndexes.push(i);
    }
    const getLineIndex = (pos) => {
      if (!Number.isInteger(pos)) return 0;
      let line = 0;
      for (const br of lineBreakIndexes) {
        if (br < pos) line += 1;
      }
      return line;
    };

    const glyphEntries = glyphsWithParts.map((glyph) => ({
      glyph,
      lineIndex: getLineIndex(glyph?.clusterStart),
    }));

    const lineMetrics = new Map();
    for (const entry of glyphEntries) {
      const line = entry.lineIndex;
      for (const part of entry.glyph.parts || []) {
        const source = part.component || entry.glyph;
        const bb = source?.bb;
        if (!bb) continue;

        const sourceX = source?.x || 0;
        const sourceY = source?.y || 0;
        const x1 = sourceX + (bb.x1 || 0);
        const y1 = sourceY + (bb.y1 || 0);
        const x2 = sourceX + (bb.x2 || 0);
        const y2 = sourceY + (bb.y2 || 0);

        const prev = lineMetrics.get(line) || { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        prev.minX = Math.min(prev.minX, x1, x2);
        prev.minY = Math.min(prev.minY, y1, y2);
        prev.maxX = Math.max(prev.maxX, x1, x2);
        prev.maxY = Math.max(prev.maxY, y1, y2);
        lineMetrics.set(line, prev);
      }
    }

    const lineShiftByIndex = new Map();
    const sortedLines = [...lineMetrics.keys()].sort((a, b) => a - b);
    let yCursor = 0;
    const lineGapUnits = 120;
    for (const line of sortedLines) {
      const m = lineMetrics.get(line);
      const lineHeight = Math.max(1, m.maxY - m.minY);
      lineShiftByIndex.set(line, {
        shiftX: -m.minX,
        shiftY: yCursor - m.minY,
      });
      yCursor += lineHeight + lineGapUnits;
    }

    for (const entry of glyphEntries) {
      const lineShift = lineShiftByIndex.get(entry.lineIndex) || { shiftX: 0, shiftY: 0 };
      for (const part of entry.glyph.parts || []) {
        const source = part.component || entry.glyph;
        const pathData = part.component ? part.component.d : (part.pathData || entry.glyph.d);
        const bb = source?.bb;
        if (!pathData || !bb) continue;

        const sourceX = (source?.x || 0) + lineShift.shiftX;
        const sourceY = (source?.y || 0) + lineShift.shiftY;

        const x1 = sourceX + (bb.x1 || 0);
        const y1 = sourceY + (bb.y1 || 0);
        const x2 = sourceX + (bb.x2 || 0);
        const y2 = sourceY + (bb.y2 || 0);

        minX = Math.min(minX, x1, x2);
        minY = Math.min(minY, y1, y2);
        maxX = Math.max(maxX, x1, x2);
        maxY = Math.max(maxY, y1, y2);

        renderedParts.push({
          glyphId: entry.glyph.id,
          partId: part.partId,
          char: part.char,
          color: part.color || '#7dd3fc',
          pathData,
          sourceX,
          sourceY,
          clipRect: part.clipRect,
        });
      }
    }

    if (!renderedParts.length || !Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }

    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const effectiveWidth = contentWidth + strokeSafetyUnits;
    const effectiveHeight = contentHeight + strokeSafetyUnits;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const fitScaleX = (viewport - paddingX * 2) / effectiveWidth;
    const fitScaleY = (viewport - paddingY * 2) / effectiveHeight;

    // Auto mode is height-priority: keep glyphs as large as possible while
    // preserving vertical fit. Long phrases may overflow horizontally (allowed
    // by overflow: visible) instead of being aggressively shrunk by width-fit.
    const containScale = Math.min(fitScaleX, fitScaleY);
    const fitScale = autoMaxCardScale ? (autoFitMode === 'height_priority' ? fitScaleY : containScale) : containScale;
    const scale = fitScale * (autoMaxCardScale ? autoBoost : cardScale);

    return {
      viewport,
      scale,
      offsetX: viewport / 2 - centerX * scale,
      offsetY: viewport / 2 - centerY * scale,
      parts: renderedParts,
    };
  }, [glyphsWithParts, cardScale, autoMaxCardScale, autoFitMode, text]);

  const isGreenModeMatch = (category) => {
    if (greenStrokeMode === 'all') return true;
    if (greenStrokeMode === 'consonants') return category === 'base_consonant' || category === 'independent_vowel';
    if (greenStrokeMode === 'subscripts') return category === 'subscript_consonant';
    if (greenStrokeMode === 'vowels') return category === 'dependent_vowel';
    if (greenStrokeMode === 'diacritics') return category === 'diacritic_sign' || category === 'diacritic';
    if (greenStrokeMode === 'coeng') return category === 'coeng';
    if (greenStrokeMode === 'numerals') return category === 'numeral';
    return false;
  };

  const getPartStrokeColor = (part, isSelected) => {
    if (isSelected) return '#1d4ed8';

    if (consonantOutlineMode === 'off' && (part.category === 'base_consonant' || part.category === 'subscript_consonant')) {
      return 'transparent';
    }

    if (consonantOutlineMode === 'green_red' && (part.category === 'base_consonant' || part.category === 'subscript_consonant')) {
      return isGreenModeMatch(part.category) ? '#16a34a' : '#dc2626';
    }

    const categoryStroke = getStrokeForCategory(part.category, part.char, { greenMode: greenStrokeMode });
    return categoryStroke;
  };

  return (
    <section>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            style={{ minWidth: 280, padding: "8px", fontSize: "16px", resize: 'vertical' }}
            placeholder="Введите кхмерский текст (можно в несколько строк)"
          />
          <button type="button" onClick={handleShape} disabled={loading} style={{ padding: "8px 16px" }}>
            {loading ? "Shaping..." : "Shape"}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px', background: '#f3f4f6', borderRadius: '4px' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={disableLigatures} onChange={(e) => setDisableLigatures(e.target.checked)} />
            <span style={{ fontSize: '14px' }}>🔧 Отключить лигатуры</span>
          </label>
          <span style={{ color: '#9ca3af' }}>или</span>
          <input
            value={features}
            onChange={(e) => setFeatures(e.target.value)}
            placeholder="liga:0,ccmp:0"
            style={{ padding: '6px', fontSize: '14px', flex: 1 }}
            disabled={disableLigatures}
          />
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px', background: '#eff6ff', borderRadius: '4px' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>⚙️ Cluster Level:</span>
            <select value={clusterLevel} onChange={(e) => setClusterLevel(parseInt(e.target.value, 10))} style={{ padding: '6px', fontSize: '14px' }}>
              <option value={0}>0 - Default</option>
              <option value={1}>1 - Monotone graphemes</option>
              <option value={2}>2 - Monotone characters</option>
            </select>
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>🔤 Шрифт:</span>
            <select
              value={selectedFont}
              onChange={(e) => handleFontChange(e.target.value)}
              style={{ padding: '6px', fontSize: '14px' }}
            >
              <option value="auto">Auto (первый доступный)</option>
              {fontOptions.map((font) => (
                <option key={font.id} value={font.id} disabled={!font.available}>
                  {font.label}{font.available ? '' : ' (недоступен)'}
                </option>
              ))}
            </select>
            {/* Индикатор загрузки метрик */}
            <span style={{ fontSize: '12px', color: metricsReady ? '#16a34a' : '#d97706' }}>
              {metricsReady ? '✅ метрики загружены' : '⏳ загрузка метрик…'}
            </span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px', background: '#dcfce7', borderRadius: '4px' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={enableSegmentation} onChange={(e) => setEnableSegmentation(e.target.checked)} />
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>✂️ Визуальная сегментация глифов</span>
          </label>
          <span style={{ fontSize: '12px', color: '#16a34a' }}>
            Разделяет составные глифы на части по геометрии (если нет компонент от сервера)
          </span>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px', background: '#ecfeff', borderRadius: '4px' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>🟢 Зеленые контуры для:</span>
            <select value={greenStrokeMode} onChange={(e) => setGreenStrokeMode(e.target.value)} style={{ padding: '6px', fontSize: '14px' }}>
              <option value="all">Всех категорий</option>
              <option value="consonants">Только согласных</option>
              <option value="subscripts">Только подписных</option>
              <option value="vowels">Только гласных</option>
              <option value="diacritics">Только диакритик</option>
              <option value="coeng">Только coeng</option>
              <option value="numerals">Только цифр</option>
            </select>
          </label>
          <span style={{ fontSize: '12px', color: '#0f766e' }}>
            Невыбранные категории получают альтернативный контур по типу символа
          </span>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px', background: '#fee2e2', borderRadius: '4px' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>🧩 Контур согласных:</span>
            <select value={consonantOutlineMode} onChange={(e) => setConsonantOutlineMode(e.target.value)} style={{ padding: '6px', fontSize: '14px' }}>
              <option value="default">Стандартный (по категориям)</option>
              <option value="off">Без подсветки согласных</option>
              <option value="green_red">Зелёный/красный (по выбранной категории)</option>
            </select>
          </label>
          <span style={{ fontSize: '12px', color: '#991b1b' }}>
            В режиме зелёный/красный выбранная категория зелёная, остальные согласные — красные
          </span>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px', background: '#f5f3ff', borderRadius: '4px' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={soundEnabled} onChange={(e) => setSoundEnabled(e.target.checked)} />
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>🔊 Проигрывать звук при клике по символу</span>
          </label>
          {soundStatus ? <span style={{ fontSize: '12px', color: '#5b21b6' }}>{soundStatus}</span> : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px', background: '#fff7ed', borderRadius: '4px' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={autoMaxCardScale} onChange={(e) => setAutoMaxCardScale(e.target.checked)} />
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>📏 Авто-максимум: слово всегда максимально крупно и без обрезки</span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', opacity: autoMaxCardScale ? 1 : 0.55 }}>
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>🧭 Режим авто-fit:</span>
            <select
              value={autoFitMode}
              onChange={(e) => setAutoFitMode(e.target.value)}
              disabled={!autoMaxCardScale}
              style={{ padding: '6px', fontSize: '14px', minWidth: 210 }}
            >
              <option value="contain">Contain (не выезжает по бокам)</option>
              <option value="height_priority">Height priority (макс. размер, может выйти по X)</option>
            </select>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', opacity: autoMaxCardScale ? 0.55 : 1 }}>
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>🔎 Ручной множитель:</span>
            <input
              type="range"
              min={0.8}
              max={1.8}
              step={0.05}
              value={cardScale}
              onChange={(e) => setCardScale(parseFloat(e.target.value))}
              disabled={autoMaxCardScale}
              style={{ flex: 1 }}
            />
            <strong style={{ minWidth: 52, textAlign: 'right' }}>{cardScale.toFixed(2)}x</strong>
          </label>
        </div>
      </div>

      <section
        style={{
          marginBottom: 16,
          width: '100%',
          maxWidth: 660,
          marginInline: 'auto',
          padding: 20,
          borderRadius: 24,
          border: '1px solid #243356',
          background: 'linear-gradient(180deg, #0b1530 0%, #040b1f 100%)',
          color: '#dbeafe',
        }}
      >
        <p style={{ margin: 0, letterSpacing: '0.22em', textAlign: 'center', color: '#7dd3fc' }}>TAP THE HERO.</p>
        <h2 style={{ marginTop: 12, marginBottom: 18, fontSize: 30, textAlign: 'center', color: '#f8fafc' }}>Tap the BASE of the block.</h2>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ color: '#94a3b8', letterSpacing: '0.2em', fontSize: 13 }}>FOUND: {selectedChar ? '1/1' : '0/1'}</span>
          <button
            type="button"
            onClick={() => {
              setSelectedGlyphId(null);
              setSelectedChar(null);
            }}
            style={{
              padding: '8px 18px',
              borderRadius: 18,
              border: '1px solid #334155',
              background: '#111b33',
              color: '#cbd5e1',
              cursor: 'pointer',
              letterSpacing: '0.08em',
              fontSize: 15,
            }}
          >
            ↺ RESET
          </button>
        </div>

        <div style={{ minHeight: 280, display: 'grid', placeItems: 'center', overflow: 'visible' }}>
          {heroPartsPreview ? (
            <svg
              width={heroPartsPreview.viewport}
              height={heroPartsPreview.viewport}
              viewBox={`0 0 ${heroPartsPreview.viewport} ${heroPartsPreview.viewport}`}
              role="img"
              aria-label="Centered decoded glyph"
              style={{ overflow: 'visible' }}
            >
              {heroPartsPreview.parts.map((part) => {
                const isSelectedInCard = selectedGlyphId === part.glyphId && selectedChar === part.char;
                const clipId = `hero-clip-${part.partId}`;
                const cr = part.clipRect;
                const isClipValid = cr &&
                  Number.isFinite(cr.x) && Number.isFinite(cr.y) &&
                  Number.isFinite(cr.width) && Number.isFinite(cr.height);

                const partTransform = `matrix(${heroPartsPreview.scale}, 0, 0, ${heroPartsPreview.scale}, ${heroPartsPreview.offsetX + part.sourceX * heroPartsPreview.scale}, ${heroPartsPreview.offsetY + part.sourceY * heroPartsPreview.scale})`;

                return (
                  <g key={part.partId}>
                    <defs>
                      {isClipValid && (
                        <clipPath id={clipId}>
                          <rect x={cr.x} y={cr.y} width={cr.width} height={cr.height} />
                        </clipPath>
                      )}
                    </defs>
                    <path
                      d={part.pathData}
                      transform={partTransform}
                      clipPath={isClipValid ? `url(#${clipId})` : undefined}
                      fill={isSelectedInCard ? '#3b82f6' : part.color}
                      stroke={isSelectedInCard ? '#f8fafc' : '#93c5fd'}
                      strokeWidth={isSelectedInCard ? '28' : '16'}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setSelectedGlyphId(part.glyphId);
                        setSelectedChar(part.char);
                        playSelectedCharSound(part.char);
                      }}
                    />
                  </g>
                );
              })}
            </svg>
          ) : (
            <p style={{ color: '#64748b', letterSpacing: '0.2em', margin: 0 }}>SHAPE A GLYPH TO START</p>
          )}
        </div>

        <p style={{ marginTop: 6, marginBottom: 0, textAlign: 'center', color: '#64748b', letterSpacing: '0.2em' }}>
          TAP TO ANALYZE STRUCTURE
        </p>
      </section>

      {error ? <p style={{ color: "crimson", fontWeight: "bold" }}>{error}</p> : null}

      <svg
        width={width}
        height={verticalLayout.height}
        viewBox={`0 0 ${width} ${verticalLayout.height}`}
        style={{ border: "2px solid #333", background: "#fafafa", display: "block" }}
      >
        <line x1="0" y1={verticalLayout.baselineY} x2={width} y2={verticalLayout.baselineY} stroke="#f59e0b" strokeWidth="2" strokeDasharray="5 5" />
        <line x1="0" y1={verticalLayout.ascenderLineY} x2={width} y2={verticalLayout.ascenderLineY} stroke="#e5e7eb" strokeDasharray="2 2" />
        <line x1="0" y1={verticalLayout.descenderLineY} x2={width} y2={verticalLayout.descenderLineY} stroke="#e5e7eb" strokeDasharray="2 2" />

        {glyphsWithParts.map((glyph) => (
          <g key={glyph.id}>
            {glyph.parts.map((part) => {

              let xPos, yPos, pathData;
              if (part.component) {
                xPos = 50 + part.component.x * SCALE;
                yPos = verticalLayout.baselineY + part.component.y * SCALE;
                pathData = part.component.d;
              } else {
                xPos = 50 + glyph.x * SCALE;
                yPos = verticalLayout.baselineY + glyph.y * SCALE;
                pathData = part.pathData || glyph.d;
              }

              const cr = part.clipRect;
              const isClipValid = cr &&
                Number.isFinite(cr.x) && Number.isFinite(cr.y) &&
                Number.isFinite(cr.width) && Number.isFinite(cr.height);

              const clipId = `clip-${part.partId}`;
              const isSelected = selectedGlyphId === glyph.id && selectedChar === part.char;
              const strokeColor = getPartStrokeColor(part, isSelected);
              const strokeWidth = isSelected ? '30' : '14';

              return (
                <g key={part.partId}>
                  <defs>
                    {isClipValid && (
                      <clipPath id={clipId}>
                        <rect x={cr.x} y={cr.y} width={cr.width} height={cr.height} />
                      </clipPath>
                    )}
                  </defs>
                  <g
                    onClick={() => {
                      setSelectedGlyphId(glyph.id);
                      setSelectedChar(part.char);
                      playSelectedCharSound(part.char);
                      console.log('[SELECTED CHAR]', part.char, 'in glyph', glyph.id);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <path
                      d={pathData}
                      fill={isSelected ? '#3b82f6' : part.color}
                      transform={`matrix(${SCALE}, 0, 0, ${SCALE}, ${xPos}, ${yPos})`}
                      clipPath={isClipValid ? `url(#${clipId})` : undefined}
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      opacity={0.9}
                    />
                    {isClipValid && (
                      <rect
                        x={cr.x} y={cr.y} width={cr.width} height={cr.height}
                        fill="none" stroke="red" strokeWidth="15" strokeDasharray="40,20"
                        transform={`matrix(${SCALE}, 0, 0, ${SCALE}, ${xPos}, ${yPos})`}
                        pointerEvents="none"
                      />
                    )}
                  </g>
                </g>
              );
            })}
            <text x={glyph.x * SCALE + 50} y={verticalLayout.labelY} fontSize="12" fill="#6b7280" textAnchor="middle">
              #{glyph.id} ({glyph.parts.length} part{glyph.parts.length !== 1 ? 's' : ''})
            </text>
          </g>
        ))}

        {!loading && glyphs.length === 0 && (
          <text x="50" y="200" fill="#6b7280" fontSize="16">
            Нет глифов для отображения. Введите текст и нажмите Shape.
          </text>
        )}
      </svg>

      <p style={{ marginTop: 12, color: "#4b5563", fontSize: "14px" }}>
        ✨ Кликните по части глифа чтобы увидеть информацию
      </p>

      {selectedChar && selectedGlyphId !== null && (
        <div style={{ marginTop: 16, padding: 12, background: "#eff6ff", border: "1px solid #3b82f6", borderRadius: 4 }}>
          <strong>Выбран символ: {selectedChar}</strong>
          {(() => {
            const glyph = glyphsWithParts.find(g => g.id === selectedGlyphId);
            if (!glyph) return <p>Глиф не найден</p>;
            const selectedParts = glyph.parts.filter(p => p.char === selectedChar);
            if (selectedParts.length === 0) return <p>Части не найдены</p>;
            return (
              <div style={{ marginTop: 8 }}>
                <p><strong>Количество частей:</strong> {selectedParts.length}</p>
                <p><strong>Аудио:</strong> {selectedSoundFile || 'нет соответствия'}</p>
                {selectedParts.map((part, idx) => (
                  <div key={part.partId} style={{ marginTop: 8, paddingTop: 8, borderTop: idx > 0 ? '1px solid #ddd' : 'none' }}>
                    <p><strong>Часть #{idx + 1}:</strong></p>
                    <p style={{ marginLeft: 12 }}>
                      <strong>Категория:</strong> {part.category}<br />
                      <strong>Зона:</strong> {part.zone}<br />
                      <strong>Цвет:</strong> <span style={{ color: part.color, fontWeight: 'bold' }}>■</span> {part.color}
                    </p>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: "bold", padding: 8, background: "#f3f4f6" }}>
          🐛 Debug panel
        </summary>
        <div style={{ padding: 12, background: "#fafafa" }}>
          <h4 style={{ marginTop: 0 }}>Glyphs with Parts ({glyphsWithParts.length})</h4>
          <pre style={{ fontSize: "11px", overflow: "auto", maxHeight: "300px", background: "#fff", padding: 8 }}>
            {JSON.stringify(glyphsWithParts.map(g => ({
              id: g.id,
              parts: g.parts.map(p => ({
                char: p.char, category: p.category,
                zone: p.zone, color: p.color,
                validClip: p.clipRect ? 'YES' : 'NO'
              }))
            })), null, 2)}
          </pre>

          {/* Metrics debug */}
          <h4>Font Metrics {metricsReady ? '✅' : '⏳'}</h4>
          {metricsReady && (
            <pre style={{ fontSize: "11px", overflow: "auto", maxHeight: "200px", background: "#fff", padding: 8 }}>
              {JSON.stringify({
                unitsPerEm: getRawMetrics()?.unitsPerEm,
                consonantsCount: Object.keys(getRawMetrics()?.consonants ?? {}).length,
                subscriptsCount: Object.keys(getRawMetrics()?.subscripts ?? {}).length,
                vowelsCount: Object.keys(getRawMetrics()?.vowels ?? {}).length,
                diacriticsCount: Object.keys(getRawMetrics()?.diacritics ?? {}).length,
              }, null, 2)}
            </pre>
          )}
        </div>
      </details>
    </section>
  );
}
