import React, { useEffect, useMemo, useState } from "react";
import { buildEduUnits } from "../lib/eduUnits.js";
import { createClipPathParts } from "../lib/simpleGlyphSplit.js";

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
  const [clusterLevel, setClusterLevel] = useState(0); // по умолчанию 0, чтобы сохранять корректный порядок кхмерских знаков
  const [enableSegmentation, setEnableSegmentation] = useState(true);

  const units = useMemo(() => buildEduUnits(text), [text]);

  // Функция для получения категории символа по eduUnits
  function getCategoryForChar(char) {
    const unit = units.find(u => u.text === char);
    return unit ? unit.category : 'other';
  }

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

  const SPLIT_DEPENDENT_VOWELS = new Set([0x17c5]); // ◌ៅ содержит левую и правую визуальные части

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
        // ВАЖНО: у кхмерского pre-base гласного компонент может идти ПЕРЕД базовой согласной.
        // Поэтому нельзя жёстко привязывать "согласная=первый", "гласная=последний".
        const usedComponentIndexes = new Set();
        const getComponentArea = (component) => {
          if (!component?.bb) return 0;
          return Math.max(0, (component.bb.x2 - component.bb.x1) * (component.bb.y2 - component.bb.y1));
        };

        const pickComponentIndex = (category, fallbackIndex) => {
          const candidates = glyph.components
            .map((component, index) => ({ component, index, area: getComponentArea(component) }))
            .filter(({ index }) => !usedComponentIndexes.has(index));

          if (candidates.length === 0) return Math.min(fallbackIndex, glyph.components.length - 1);

          if (category === 'base_consonant' || category === 'independent_vowel') {
            // База обычно самый "крупный" компонент
            candidates.sort((a, b) => b.area - a.area);
            return candidates[0].index;
          }

          if (category === 'dependent_vowel' || category === 'diacritic_sign' || category === 'diacritic') {
            // Зависимые знаки чаще всего компактнее базы
            candidates.sort((a, b) => a.area - b.area);
            return candidates[0].index;
          }

          if (category === 'subscript_consonant' || category === 'coeng') {
            // Подписные элементы часто ниже базовой линии
            candidates.sort((a, b) => (a.component?.bb?.y1 ?? 0) - (b.component?.bb?.y1 ?? 0));
            return candidates[0].index;
          }

          return candidates[0].index;
        };

        const parts = glyph.chars.map((char, charIdx) => {
          const category = getCategoryForChar(char);
          const color = getColorForCategory(category);

          const selectedIndex = pickComponentIndex(category, charIdx);
          usedComponentIndexes.add(selectedIndex);
          const component = glyph.components[selectedIndex];

          return {
            partId: `${glyph.id}-${charIdx}`,
            component,
            char,
            category,
            color,
            zone: 'component',
            hbGlyphId: component?.hbGlyphId,
          };
        });

        // Спец-случай: некоторые гласные (например ◌ៅ) визуально занимают 2 зоны.
        // Правая часть может остаться внутри базового компонента — вырезаем её отдельно и красим как гласную.
        const dependentPart = parts.find((part) => part.category === 'dependent_vowel');
        const basePart = parts.find((part) => part.category === 'base_consonant' || part.category === 'independent_vowel');
        const dependentCp = dependentPart?.char?.codePointAt(0);

        if (enableSegmentation && dependentPart && basePart && SPLIT_DEPENDENT_VOWELS.has(dependentCp) && basePart.component?.bb) {
          const bb = basePart.component.bb;
          const width = bb.x2 - bb.x1;
          const rightStart = bb.x1 + width * 0.82;

          basePart.clipRect = {
            x: bb.x1,
            y: bb.y1,
            width: rightStart - bb.x1,
            height: bb.y2 - bb.y1,
          };

          parts.push({
            partId: `${glyph.id}-vowel-right`,
            component: basePart.component,
            char: dependentPart.char,
            category: dependentPart.category,
            color: dependentPart.color,
            zone: 'component-vowel-right',
            hbGlyphId: basePart.component?.hbGlyphId,
            clipRect: {
              x: rightStart,
              y: bb.y1,
              width: bb.x2 - rightStart,
              height: bb.y2 - bb.y1,
            },
          });
        }

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

  async function handleShape() {
    setLoading(true);
    setError("");
    setSelectedPartKey(null);

    try {
      let url = `http://localhost:3001/api/shape?text=${encodeURIComponent(text)}`;

      if (clusterLevel !== 0) {
        url += `&clusterLevel=${clusterLevel}`;
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
    handleShape();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didAutoload]);

  const SCALE = 0.1;
  const BASELINE_Y = 280;

  const width = Math.max(
    800,
    glyphs.reduce((acc, glyph) => Math.max(acc, (glyph.x + glyph.advance) * SCALE + 100), 800)
  );

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
        height={400}
        viewBox={`0 0 ${width} 400`}
        style={{ border: "2px solid #333", background: "#fafafa", display: "block" }}
      >
        <line x1="0" y1={BASELINE_Y} x2={width} y2={BASELINE_Y} stroke="#f59e0b" strokeWidth="2" strokeDasharray="5 5" />
        <line x1="0" y1="100" x2={width} y2="100" stroke="#e5e7eb" strokeDasharray="2 2" />
        <line x1="0" y1="300" x2={width} y2="300" stroke="#e5e7eb" strokeDasharray="2 2" />

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
                  yPos = BASELINE_Y; // компонент имеет свой y, который будет применен через transform? В компоненте y уже учтено в path? Нет, path без смещения, смещение в component.x и component.y. Поэтому transform должен использовать component.x и component.y.
                  // Но в текущем коде для компонентов мы передаем transform с xPos и yOffset, и затем path компонента рисуется без дополнительного смещения. Это правильно, если component.x и component.y уже включены в transform.
                  // Однако component.x и component.y - это абсолютные координаты в пространстве шрифта, которые мы добавляем к transform.
                  // Значит, для компонента transform: matrix(SCALE,0,0,SCALE, xPos, BASELINE_Y) и затем path рисуется, но path не содержит смещения. Но component.x уже добавлено в xPos. component.y должно быть добавлено к BASELINE_Y? В текущем коде мы используем BASELINE_Y как базу, а y компонента не прибавляем. Это ошибка. Надо прибавлять component.y к BASELINE_Y.
                  // Пересмотрим: в сервере мы сохранили component.x и component.y как абсолютные координаты в пространстве шрифта (с учетом dx, dy). При рендеринге мы должны преобразовать их в SVG координаты: x_svg = 50 + component.x * SCALE, y_svg = BASELINE_Y + component.y * SCALE.
                  // Поэтому исправим:
                  const compX = 50 + part.component.x * SCALE;
                  const compY = BASELINE_Y + part.component.y * SCALE;
                  pathData = part.component.d;
                  if (part.clipRect) {
                    const clipId = `clip-${part.partId}`;
                    const cr = part.clipRect;
                    return (
                      <g key={part.partId}>
                        <defs>
                          <clipPath id={clipId}>
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
                  yPos = BASELINE_Y;
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
              <text x={glyph.x * SCALE + 50} y={BASELINE_Y + 40} fontSize="12" fill="#6b7280" textAnchor="middle">
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