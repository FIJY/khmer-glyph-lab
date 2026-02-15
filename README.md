# Khmer Glyph Lab

Минимальная лаборатория для дебага шейпинга и выбора/классификации кхмерских глифов.

## Установка

```bash
npm install
```

## Шрифт

Положите `KhmerOSBattambang.ttf` в `public/fonts`.

Если файла нет, сервер использует `public/fonts/NotoSansKhmer-Regular.ttf` как fallback.

## Запуск

```bash
npm run dev
```

Скрипт `dev` кроссплатформенный (Windows/macOS/Linux), без зависимости от `bash`.

- Frontend: обычно http://localhost:5173 (если порт занят, Vite может выбрать 5174 и выше — смотрите URL в консоли)
- Backend: http://localhost:3001

## Endpoints

- `GET /health` → `OK`
- `GET /api/shape?text=...` → массив glyph metadata

Пример:

`/api/shape?text=%E1%9E%80%E1%9F%85`

## Что проверять в debug

- base/dependent vowel/subscript должны быть раздельными edu units.
- shared glyph должен отмечаться как `sharedGlyph: true`.
- glyph JSON содержит поля: `clusterStart`, `clusterEnd`, `clusterText`, `chars`, `codePoints`.

## Файлы проекта

- `server/server.cjs`
- `src/App.jsx`
- `src/components/VisualDecoderLab.jsx`
- `src/lib/khmerClassifier.js`
- `src/lib/eduUnits.js`
