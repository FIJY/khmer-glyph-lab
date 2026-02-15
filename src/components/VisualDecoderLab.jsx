import React, { useEffect, useMemo, useState } from "react";
import { buildEduUnits } from "../lib/eduUnits.js";
import { createClipPathParts } from "../lib/simpleGlyphSplit.js";
import { getKhmerGlyphCategory } from "../lib/khmerClassifier.js";

const DEBUG = Boolean(globalThis.window?.__EDU_DEBUG__);

export default function VisualDecoderLab() {
  const [text, setText] = useState("កៅ");
  const [glyphs, setGlyphs] = useState([]);
  const [selectedPartKey, setSelectedPartKey] = useState(null); // glyphId-partIdx (или glyphId-componentIdx)
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [didAutoload, setDidAutoload] = useState(false);
  const [disableLigatures, setDisableLigatures] = useState(false);
  const [features, setFeatures] = useState('');
  const [clusterLevel, setClusterLevel] = useState(0); // по умолчанию 0 для корректного рендеринга слова
  const [enableSegmentation, setEnableSegmentation] = useState(true);
  const [fontOptions, setFontOptions] = useState([]);
  const [selectedFont, setSelectedFont] = useState('auto');

  const units = useMemo(() => buildEduUnits(text), [text]);

  // Функция для определения цвета по категории (как в mapGlyphToVisualParts, но можно унифицировать)
  function getColorForCategory(category) {
    switch (category) {
      case 'base_consonant':
      case 'independent_vowel':
        return '#22c55e'; // green
      case 'dependent_vowel':
        return '#ef4444'; // red
      case 'subscript_consonant':
        return '#3b82f6'; // blue
      case 'diacritic_sign':
      case 'diacritic':
        return '#f59e0b'; // amber
      case 'coeng':
        return '#8b5cf6'; // purple
      default:
        return '#111';
    }
  }

  function getComponentArea(component) {
    if (!component?.bb) return 0;
    const width = Math.max(0, (component.bb.x2 || 0) - (component.bb.x1 || 0));
    const height = Math.max(0, (component.bb.y2 || 0) - (component.bb.y1 || 0));
    return width * height;
  }


  function isSplitDependentVowelChar(char) {
    if (!char) return false;
    const cp = char.codePointAt(0);
    return cp === 0x17be || cp === 0x17bf || cp === 0x17c0 || cp === 0x17c4 || cp === 0x17c5;
  }

  // Вычисляем parts для каждого глифа на основе components или геометрии
  const glyphsWithParts = useMemo(() => {
    return glyphs.map(glyph => {
      // Если у глифа есть компоненты от сервера, проверяем их
      if (glyph.components && glyph.components.length > 0) {
        // ПРОВЕРКА: Если все компоненты имеют одинаковый hbGlyphId - это составной глиф!
        // В этом случае нужна геометрическая сегментация
        const uniqueGlyphIds = new Set(glyph.components.map(c => c.hbGlyphId));

        if (uniqueGlyphIds.size === 1 && glyph.chars.length > 1) {
          // Все компоненты одинаковые и есть несколько символов
          // → Используем геометрическую сегментацию!
          console.log('[PARTS] Glyph', glyph.id, '- composite glyph detected, using SIMPLE clip-path segmentation');

          if (enableSegmentation) {
            const parts = createClipPathParts(glyph, units).map((p, idx) => ({
              ...p,
              partId: `${glyph.id}-${idx}`,
            }));
            return { ...glyph, parts };
          } else {
            // Если сегментация отключена - возвращаем весь глиф
            return {
              ...glyph,
              parts: [{
                partId: `${glyph.id}-full`,
                component: glyph.components[0],
                char: glyph.chars.join(''),
                category: 'full',
                color: '#111',
                zone: 'full',
              }]
            };
          }
        }

        // Иначе - разные компоненты, создаём parts по символам
        const charMeta = glyph.chars.map((char, charIdx) => ({
          char,
          charIdx,
          category: getKhmerGlyphCategory(char, glyph.chars[charIdx - 1]),
        }));

        const hasBase = charMeta.some((item) => item.category === 'base_consonant' || item.category === 'independent_vowel');
        const hasDependent = charMeta.some((item) => item.category === 'dependent_vowel');

        const useAreaMapping =
          hasBase &&
          hasDependent &&
          glyph.components.length === 2 &&
          charMeta.length === 2;

        let baseComponent = null;
        let dependentComponent = null;
        if (useAreaMapping) {
          const [first, second] = glyph.components;
          if (getComponentArea(first) >= getComponentArea(second)) {
            baseComponent = first;
            dependentComponent = second;
          } else {
            baseComponent = second;
            dependentComponent = first;
          }
        }

        const baseMeta = charMeta.find((item) => item.category === 'base_consonant' || item.category === 'independent_vowel');
        const dependentMeta = charMeta.find((item) => item.category === 'dependent_vowel');

        if (useAreaMapping && baseMeta && dependentMeta && isSplitDependentVowelChar(dependentMeta.char) && baseComponent?.bb) {
          const bb = baseComponent.bb;
          const bbWidth = Math.max(0, (bb.x2 || 0) - (bb.x1 || 0));
          const bbHeight = Math.max(0, (bb.y2 || 0) - (bb.y1 || 0));
          const tailWidth = Math.max(120, bbWidth * 0.3);

          const baseClipWidth = Math.max(0, bbWidth - tailWidth);
          const parts = [];

          parts.push({
            partId: `${glyph.id}-base-main`,
            component: baseComponent,
            char: baseMeta.char,
            category: baseMeta.category,
            color: getColorForCategory(baseMeta.category),
            zone: 'component_split_base',
            hbGlyphId: baseComponent?.hbGlyphId,
            clipRect: {
              x: bb.x1,
              y: bb.y1,
              width: baseClipWidth,
              height: bbHeight,
            },
          });

          if (dependentComponent) {
            parts.push({
              partId: `${glyph.id}-vowel-leading`,
              component: dependentComponent,
              char: dependentMeta.char,
              category: dependentMeta.category,
              color: getColorForCategory(dependentMeta.category),
              zone: 'component_split_vowel_leading',
              hbGlyphId: dependentComponent?.hbGlyphId,
            });
          }

          parts.push({
            partId: `${glyph.id}-vowel-trailing`,
            component: baseComponent,
            char: dependentMeta.char,
            category: dependentMeta.category,
            color: getColorForCategory(dependentMeta.category),
            zone: 'component_split_vowel_trailing',
            hbGlyphId: baseComponent?.hbGlyphId,
            clipRect: {
              x: bb.x1 + baseClipWidth,
              y: bb.y1,
              width: Math.min(tailWidth, bbWidth),
              height: bbHeight,
            },
          });

          return { ...glyph, parts };
        }

        const parts = charMeta.map(({ char, charIdx, category }) => {
          const color = getColorForCategory(category);

          // Ищем компонент который соответствует этому символу
          // Эвристика: согласные обычно первый компонент, гласные - последний
          let component = null;

          if (useAreaMapping && (category === 'base_consonant' || category === 'independent_vowel')) {
            component = baseComponent;
          } else if (useAreaMapping && category === 'dependent_vowel') {
            component = dependentComponent;
          } else if (category === 'base_consonant' || category === 'independent_vowel') {
            // Берём первый компонент (согласная обычно в начале)
            component = glyph.components[0];
          } else if (category === 'dependent_vowel') {
            // Берём последний компонент (гласная обычно добавляется последней)
            component = glyph.components[glyph.components.length - 1];
          } else if (category === 'subscript_consonant') {
            // Подписные согласные обычно в середине или в конце
            component = glyph.components[Math.min(1, glyph.components.length - 1)];
          } else {
            // Для остальных - берём по индексу или первый
            component = glyph.components[Math.min(charIdx, glyph.components.length - 1)];
          }

          return {
            partId: `${glyph.id}-${charIdx}`,
            component: component,
            char,
            category,
            color,
            zone: 'component',
            hbGlyphId: component?.hbGlyphId,
          };
        });

        return { ...glyph, parts };
      } else {
        // Если компонентов нет, используем геометрическую сегментацию (если включена)
        if (enableSegmentation) {
          const parts = mapGlyphToVisualParts(glyph, units).map((p, idx) => ({
            ...p,
            partId: `${glyph.id}-${idx}`,
          }));
          return { ...glyph, parts };
        } else {
          // Без сегментации: один part = весь глиф
          return {
            ...glyph,
            parts: [{
              partId: `${glyph.id}-full`,
              component: null,
              char: glyph.chars?.join('') || '',
              category: 'full',
              color: '#111',
              zone: 'full',
              pathData: glyph.d,
            }]
          };
        }
      }
    });
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
    setSelectedPartKey(null);

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
                <option key={font.id} value={font.id}>{font.label}</option>
              ))}
            </select>
          </label>
          <span style={{ fontSize: '12px', color: '#92400e' }}>
            Выберите шрифт и нажмите Shape
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
                const isSelected = selectedPartKey === part.partId;
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
                            setSelectedPartKey(part.partId);
                            console.log('[SELECTED PART]', part);
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
                        setSelectedPartKey(part.partId);
                        console.log('[SELECTED PART]', part);
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
                            setSelectedPartKey(part.partId);
                            console.log('[SELECTED PART]', part);
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
                          setSelectedPartKey(part.partId);
                          console.log('[SELECTED PART]', part);
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
        ✨ Кликните по части глифа чтобы увидеть информацию
      </p>

      {selectedPartKey && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "#eff6ff",
            border: "1px solid #3b82f6",
            borderRadius: 4,
          }}
        >
          <strong>Выбрана часть:</strong>
          {(() => {
            const [gId, pIdx] = selectedPartKey.split('-');
            const glyph = glyphsWithParts.find(g => String(g.id) === gId);
            if (!glyph) return <p>Глиф не найден</p>;

            const part = glyph.parts.find(p => p.partId === selectedPartKey);
            if (!part) return <p>Часть не найдена</p>;

            return (
              <div style={{ marginTop: 8 }}>
                <p><strong>Символ:</strong> {part.char || '?'}</p>
                <p><strong>Категория:</strong> {part.category}</p>
                <p><strong>Зона:</strong> {part.zone}</p>
                <p><strong>Цвет:</strong> <span style={{ color: part.color, fontWeight: 'bold' }}>■</span> {part.color}</p>
                {part.component && (
                  <p><small>Компонент глифа (ID: {part.component.hbGlyphId})</small></p>
                )}
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
