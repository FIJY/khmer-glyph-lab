import React, { useEffect, useMemo, useState } from 'react';
import { buildEduUnits, mapEduUnitsToGlyphs } from '../lib/eduUnits.js';

const DEBUG = Boolean(globalThis.window?.__EDU_DEBUG__);

export default function VisualDecoderLab() {
  const [text, setText] = useState('កៅ');
  const [glyphs, setGlyphs] = useState([]);
  const [selectedGlyphId, setSelectedGlyphId] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [didAutoload, setDidAutoload] = useState(false);

  const units = useMemo(() => buildEduUnits(text), [text]);
  const mapping = useMemo(() => mapEduUnitsToGlyphs(glyphs, units), [glyphs, units]);

  const selectedLinks = mapping.filter((link) => link.glyphId === selectedGlyphId);
  const selectedUnits = units.filter((unit) => selectedLinks.some((link) => link.unitId === unit.id));

  async function handleShape() {
    setLoading(true);
    setError('');
    setSelectedGlyphId(null);

    try {
      const response = await fetch(`/api/shape?text=${encodeURIComponent(text)}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      if (DEBUG) {
        console.log('[EDU_DEBUG] glyphs', data);
      }
      setGlyphs(Array.isArray(data) ? data : []);
    } catch (shapeError) {
      setError(`Shape API error: ${shapeError.message}. Проверьте сервер.`);
      setGlyphs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (didAutoload) {
      return;
    }
    setDidAutoload(true);
    handleShape();
  }, [didAutoload]);

  const width = Math.max(500, glyphs.reduce((acc, glyph) => Math.max(acc, glyph.x + glyph.advance + 40), 500));

  return (
    <section>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} style={{ minWidth: 280 }} placeholder="Введите кхмерский текст" />
        <button type="button" onClick={handleShape} disabled={loading}>{loading ? 'Shaping...' : 'Shape'}</button>
      </div>

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

      <svg width={width} height={260} viewBox={`0 -120 ${width} 260`} style={{ border: '1px solid #ddd', background: '#fff' }}>
                <line x1="0" y1="140" x2={width} y2="140" stroke="#e5e7eb" strokeDasharray="4 4" />
        <text x="12" y="136" fill="#9ca3af" fontSize="12">baseline</text>
        {glyphs.map((glyph) => {
          const isSelected = glyph.id === selectedGlyphId;
          return (
            <g
              key={glyph.id}
              transform={`translate(${glyph.x + 30}, 140)`}
              onClick={() => setSelectedGlyphId(glyph.id)}
              style={{ cursor: 'pointer' }}
            >
              <path d={glyph.d} fill={isSelected ? '#1d4ed8' : '#111'} transform="scale(0.03 0.03)" />
              <rect
                x={glyph.bb.x1 * 0.03}
                y={-glyph.bb.y2 * 0.03}
                width={Math.max((glyph.bb.x2 - glyph.bb.x1) * 0.03, 1)}
                height={Math.max((glyph.bb.y2 - glyph.bb.y1) * 0.03, 1)}
                fill="none"
                stroke={isSelected ? '#1d4ed8' : 'transparent'}
              />
            </g>
          );
        })}
        {!loading && glyphs.length === 0 ? (
          <text x="12" y="24" fill="#6b7280" fontSize="14">
            Нет глифов для отображения. Введите текст и нажмите Shape.
          </text>
        ) : null}
      </svg>

      <p style={{ marginTop: 8, color: '#4b5563' }}>Кликните по глифу в SVG, чтобы увидеть связанные edu units.</p>

      <div style={{ marginTop: 12 }}>
        <strong>Selected glyph links:</strong>
        {selectedGlyphId === null ? <p>Нет выбора.</p> : (
          <ul>
            {selectedLinks.map((link) => (
              <li key={`${link.glyphId}-${link.unitId}`}>
                {link.unitId} {link.sharedGlyph ? '(shared glyph)' : ''}
              </li>
            ))}
          </ul>
        )}
        {selectedUnits.length > 0 ? <pre>{JSON.stringify(selectedUnits, null, 2)}</pre> : null}
      </div>

      <details open>
        <summary>Debug panel</summary>
        <h4>Raw glyph JSON</h4>
        <pre>{JSON.stringify(glyphs, null, 2)}</pre>
        <h4>EduUnits JSON</h4>
        <pre>{JSON.stringify(units, null, 2)}</pre>
        <h4>Mapping JSON</h4>
        <pre>{JSON.stringify(mapping, null, 2)}</pre>
      </details>
    </section>
  );
}
