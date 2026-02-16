import React, { useEffect, useMemo, useState } from "react";
import { buildEduUnits } from "../lib/eduUnits.js";
import { mapGlyphsToParts } from "../lib/glyphPartMapper.js";

const DEBUG = Boolean(globalThis.window?.__EDU_DEBUG__);

export default function VisualDecoderLab() {
  const [text, setText] = useState("កៅ");
  const [glyphs, setGlyphs] = useState([]);
  // ИЗМЕНЕНО: храним glyphId и char для группового выделения частей
  const [selectedGlyphId, setSelectedGlyphId] = useState(null);
  const [selectedChar, setSelectedChar] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [didAutoload, setDidAutoload] = useState(false);
  const [disableLigatures, setDisableLigatures] = useState(false);
  const [features, setFeatures] = useState('');
  const [clusterLevel, setClusterLevel] = useState(0);
  const [enableSegmentation, setEnableSegmentation] = useState(true);
  const [fontOptions, setFontOptions] = useState([]);
  const [selectedFont, setSelectedFont] = useState('auto');

  const units = useMemo(() => buildEduUnits(text), [text]);

  // Вычисляем parts для каждого глифа на основе централизованного маппера
  const glyphsWithParts = useMemo(() => {
    return mapGlyphsToParts(glyphs, units, { enableSegmentation });
  }, [glyphs, units, enableSegmentation]);

  async function loadFonts() {
    try {
      const response = await fetch('http://localhost:3001/api/fonts');
      if (!response.ok) return;
      const payload = await response.json();
      const fonts = Array.isArray(payload.fonts) ? payload.fonts : [];
      setFontOptions(fonts);
      if (payload.defaultFontId && selectedFont === 'auto') {
        // 'auto' оставляем как явный режим, не переопределяем выбор пользователя
      }
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

      if (clusterLevel !== 0) {
        url += `&clusterLevel=${clusterLevel}`;
      }

      if (selectedFont && selectedFont !== 'auto') {
        url += `&font=${encodeURIComponent(selectedFont)}`;
      }

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
      console.log("[GLYPHS]", data);
      setGlyphs(Array.isArray(data) ? data : []);
    } catch (shapeError) {
      setError(`Shape API error: ${shapeError.message}. Проверьте сервер.`);
      setGlyphs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (didAutoload) return;
    setDidAutoload(true);
    loadFonts();
    handleShape();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didAutoload]);

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
      const top = (offsetY + (bb.y1 || 0)) * SCALE;
      const bottom = (offsetY + (bb.y2 || 0)) * SCALE;

      minRelativeY = Math.min(minRelativeY, top, bottom);
      maxRelativeY = Math.max(maxRelativeY, top, bottom);
    };

    for (const glyph of glyphsWithParts) {
      // 1) Границы реально отрисовываемых частей
      for (const part of glyph.parts || []) {
        const source = part.component || glyph;
        pushBounds(source?.y || 0, source?.bb);
      }

      // 2) Границы всех серверных компонентов (на случай, если часть не замапилась)
      for (const component of glyph.components || []) {
        pushBounds(component?.y || 0, component?.bb);
      }

      // 3) Фолбэк на bbox самого глифа
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

  return (
    <section>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ minWidth: 280, padding: "8px", fontSize: "16px" }}
            placeholder="Введите кхмерский текст"
          />
          <button type="button" onClick={handleShape} disabled={loading} style={{ padding: "8px 16px" }}>
            {loading ? "Shaping..." : "Shape"}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px', background: '#f3f4f6', borderRadius: '4px' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={disableLigatures}
              onChange={(e) => setDisableLigatures(e.target.checked)}
            />
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
            <select
              value={clusterLevel}
              onChange={(e) => setClusterLevel(parseInt(e.target.value, 10))}
              style={{ padding: '6px', fontSize: '14px' }}
            >
              <option value={0}>0 - Default</option>
              <option value={1}>1 - Monotone graphemes</option>
              <option value={2}>2 - Monotone characters</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px', background: '#fef9c3', borderRadius: '4px' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>🔤 Шрифт:</span>
            <select
              value={selectedFont}
              onChange={(e) => setSelectedFont(e.target.value)}
              style={{ padding: '6px', fontSize: '14px' }}
            >
              <option value="auto">Auto (первый доступный)</option>
              {fontOptions.map((font) => (
                <option key={font.id} value={font.id} disabled={!font.available}>
                  {font.label}{font.available ? '' : ' (недоступен)'}
                </option>
              ))}
            </select>
          </label>
          <span style={{ fontSize: '12px', color: '#92400e' }}>
            Доступные шрифты можно выбрать сразу, недоступные помечены в списке
          </span>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px', background: '#dcfce7', borderRadius: '4px' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={enableSegmentation}
              onChange={(e) => setEnableSegmentation(e.target.checked)}
            />
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>✂️ Визуальная сегментация глифов</span>
          </label>
          <span style={{ fontSize: '12px', color: '#16a34a' }}>
            Разделяет составные глифы на части по геометрии (если нет компонент от сервера)!
          </span>
        </div>
      </div>

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

        {glyphsWithParts.map((glyph) => {
          // Рендерим части (parts) этого глифа
          return (
            <g key={glyph.id}>
              {glyph.parts.map((part) => {
                // ИЗМЕНЕНО: выделяем ВСЕ части с тем же char в этом глифе
                const isSelected = glyph.id === selectedGlyphId && part.char === selectedChar;
                // Для частей из компонентов используем их x, y; для геометрических - позицию глифа
                let xPos, yPos, pathData;
                if (part.component) {
                  // Часть из компонента сервера
                  xPos = part.component.x * SCALE + 50;
                  yPos = verticalLayout.baselineY;
                  const compX = 50 + part.component.x * SCALE;
                  const compY = verticalLayout.baselineY + part.component.y * SCALE;
                  pathData = part.component.d;

                  if (part.clipRect) {
                    const clipId = `clip-${part.partId}`;
                    const cr = part.clipRect;

                    return (
                      <g key={part.partId}>
                        <defs>
                          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
                            <rect x={cr.x} y={cr.y} width={cr.width} height={cr.height} />
                          </clipPath>
                        </defs>
                        <g
                          onClick={() => {
                            setSelectedGlyphId(glyph.id);
                            setSelectedChar(part.char);
                            console.log('[SELECTED CHAR]', part.char, 'in glyph', glyph.id);
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <path
                            d={pathData}
                            fill={isSelected ? '#3b82f6' : part.color}
                            transform={`matrix(${SCALE}, 0, 0, ${SCALE}, ${compX}, ${compY})`}
                            clipPath={`url(#${clipId})`}
                            stroke={isSelected ? '#1d4ed8' : 'none'}
                            strokeWidth={isSelected ? '30' : '0'}
                            opacity={0.9}
                          />
                        </g>
                      </g>
                    );
                  }

                  return (
                    <g
                      key={part.partId}
                      onClick={() => {
                        setSelectedGlyphId(glyph.id);
                        setSelectedChar(part.char);
                        console.log('[SELECTED CHAR]', part.char, 'in glyph', glyph.id);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <path
                        d={pathData}
                        fill={isSelected ? '#3b82f6' : part.color}
                        transform={`matrix(${SCALE}, 0, 0, ${SCALE}, ${compX}, ${compY})`}
                        stroke={isSelected ? '#1d4ed8' : 'none'}
                        strokeWidth={isSelected ? '30' : '0'}
                        opacity={0.9}
                      />
                    </g>
                  );
                } else {
                  // Часть из геометрической сегментации или целый глиф
                  xPos = glyph.x * SCALE + 50;
                  yPos = verticalLayout.baselineY + glyph.y * SCALE;
                  pathData = part.pathData || glyph.d;

                  // Если есть clipRect - используем его для маскирования
                  if (part.clipRect) {
                    const clipId = `clip-${part.partId}`;
                    const cr = part.clipRect;

                    return (
                      <g key={part.partId}>
                        <defs>
                          <clipPath id={clipId}>
                            <rect
                              x={cr.x}
                              y={cr.y}
                              width={cr.width}
                              height={cr.height}
                            />
                          </clipPath>
                        </defs>
                        <g
                          onClick={() => {
                            setSelectedGlyphId(glyph.id);
                            setSelectedChar(part.char);
                            console.log('[SELECTED CHAR]', part.char, 'in glyph', glyph.id);
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <path
                            d={pathData}
                            fill={isSelected ? '#3b82f6' : part.color}
                            transform={`matrix(${SCALE}, 0, 0, ${SCALE}, ${xPos}, ${yPos})`}
                            clipPath={`url(#${clipId})`}
                            stroke={isSelected ? '#1d4ed8' : 'none'}
                            strokeWidth={isSelected ? '30' : '0'}
                            opacity={0.9}
                          />
                        </g>
                      </g>
                    );
                  } else {
                    // Обычный рендеринг без clip
                    return (
                      <g
                        key={part.partId}
                        onClick={() => {
                          setSelectedGlyphId(glyph.id);
                          setSelectedChar(part.char);
                          console.log('[SELECTED CHAR]', part.char, 'in glyph', glyph.id);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <path
                          d={pathData}
                          fill={isSelected ? '#3b82f6' : part.color}
                          transform={`matrix(${SCALE}, 0, 0, ${SCALE}, ${xPos}, ${yPos})`}
                          stroke={isSelected ? '#1d4ed8' : 'none'}
                          strokeWidth={isSelected ? '30' : '0'}
                          opacity={0.9}
                        />
                      </g>
                    );
                  }
                }
              })}

              {/* Подпись под глифом */}
              <text x={glyph.x * SCALE + 50} y={verticalLayout.labelY} fontSize="12" fill="#6b7280" textAnchor="middle">
                #{glyph.id} ({glyph.parts.length} part{glyph.parts.length !== 1 ? 's' : ''})
              </text>
            </g>
          );
        })}

        {!loading && glyphs.length === 0 ? (
          <text x="50" y="200" fill="#6b7280" fontSize="16">
            Нет глифов для отображения. Введите текст и нажмите Shape.
          </text>
        ) : null}
      </svg>

      <p style={{ marginTop: 12, color: "#4b5563", fontSize: "14px" }}>
        ✨ Кликните по части глифа чтобы увидеть информацию (для составных гласных выделяются все части)
      </p>

      {selectedChar && selectedGlyphId !== null && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "#eff6ff",
            border: "1px solid #3b82f6",
            borderRadius: 4,
          }}
        >
          <strong>Выбран символ: {selectedChar}</strong>
          {(() => {
            const glyph = glyphsWithParts.find(g => g.id === selectedGlyphId);
            if (!glyph) return <p>Глиф не найден</p>;

            // Находим ВСЕ части с выбранным символом
            const selectedParts = glyph.parts.filter(p => p.char === selectedChar);
            if (selectedParts.length === 0) return <p>Части не найдены</p>;

            return (
              <div style={{ marginTop: 8 }}>
                <p><strong>Количество частей:</strong> {selectedParts.length}</p>
                {selectedParts.map((part, idx) => (
                  <div key={part.partId} style={{
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: idx > 0 ? '1px solid #ddd' : 'none'
                  }}>
                    <p><strong>Часть #{idx + 1}:</strong></p>
                    <p style={{ marginLeft: 12 }}>
                      <strong>Категория:</strong> {part.category}<br/>
                      <strong>Зона:</strong> {part.zone}<br/>
                      <strong>Цвет:</strong> <span style={{ color: part.color, fontWeight: 'bold' }}>■</span> {part.color}
                    </p>
                    {part.component && (
                      <p style={{ marginLeft: 12, fontSize: '12px', color: '#666' }}>
                        Компонент ID: {part.component.hbGlyphId}
                      </p>
                    )}
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
              chars: g.chars,
              parts: g.parts.map(p => ({
                char: p.char,
                category: p.category,
                zone: p.zone,
                color: p.color,
                hbGlyphId: p.component?.hbGlyphId,
              }))
            })), null, 2)}
          </pre>

          <h4>EduUnits ({units.length})</h4>
          <pre style={{ fontSize: "11px", overflow: "auto", maxHeight: "200px", background: "#fff", padding: 8 }}>
            {JSON.stringify(units, null, 2)}
          </pre>
        </div>
      </details>
    </section>
  );
}