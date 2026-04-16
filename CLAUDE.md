# Калькулятор вентиляционной сети шахты — контекст проекта

## Назначение
Веб-приложение для расчёта распределения воздуха в шахтной вентиляционной сети. Интерактивное рисование схемы на canvas + автоматический расчёт потоков, давлений и депрессии.

## Стек
- Frontend: HTML5 + CSS3 + Fabric.js (canvas)
- Расчёты: Vanilla JS, метод узловых потенциалов (Гаусс-Зейдель)
- Без бэкенда, без сборки — открывать `index.html` в браузере
- Модульная архитектура: IIFE-паттерн, экспорт в `window`, порядок загрузки через `<script>` в index.html

## Структура файлов

### Основные файлы
| Файл | Строк | Назначение |
|---|---|---|
| `index.html` | ~560 | UI: тулбар, модалки, панели свойств, загрузка скриптов |
| `styles/style2.css` | ~1280 | Стили |
| `js/fabric-min.js` | — | Библиотека Fabric.js (не трогать) |
| `img/` | 24 файла | Иконки объектов (fan, valve, fire и т.д.) |
| `Математика к атомосфере (1).xlsx` | 3 вкладки | Справочные расчёты (3 варианта сети) |

### Модули JS (js-for-index4/) — порядок загрузки важен!

| # | Файл | Строк | Назначение |
|---|---|---|---|
| 1 | `config.js` | 130 | APP_CONFIG, AIR_MODEL_CONFIG, OBJECT_RESISTANCE_CATALOG, inferCatalogKey, getCatalogResistance |
| 2 | `utils.js` | 64 | roundTo5, formatTo5, debounce, throttle, showNotification, getPointKey |
| 3 | `airModel.js` | 164 | Физика: коэффициенты сечений, шероховатость, скорость, депрессия, ест. тяга, типы объектов, synchronizeObjectDerivedProperties, getObjectResistanceContribution |
| 4 | `lineModel.js` | 201 | Свойства линий: calculateLinePerimeter, calculateAirResistance, recalculateLineHydraulicBase, createDefaultLineProperties, normalizeLineProperties, generateLineId |
| 5 | `geometry.js` | 135 | Геометрия: getObjectCenter, getLineAbsoluteEndpoints, findClosestPointOnLine, findClosestPointOnObjectEdge, lineIntersection |
| 6 | `cache.js` | 120 | Кэш: invalidateCache, getCachedObjects/Lines/Images, updateSpatialGrid, findLinesInArea, scheduleRender |
| 7 | `networkBuilder.js` | 532 | Граф сети: buildNetworkGraph, updateConnectionGraph, collectNetworkAttachmentInfo, buildLineChains, buildLineToChainMap |
| 8 | `airSolver.js` | 618 | **Расчётный движок** (ЗАЩИЩЁННЫЙ): propagateDeltas, performTopologicalSort, solveNodePotentials, writeFlowResults, computeNetworkMetrics, **calculateAirFlows** |
| 9 | `visualization.js` | 206 | Визуализация: createOrUpdateAirVolumeText, updateAllAirVolumeTexts, updateAllNodeLabels, applySmokeVisualization, visualizeChains |
| 10 | `chainAnalysis.js` | 258 | Анализ: getExportRows, analyzeNetworkNodes, showAirVolumeReport, splitAllLinesAtObjectCenters, calculateAllPropertiesForAllLines, resetCalculation |
| 11 | `intersections.js` | 336 | Пересечения: findAllIntersections, collectPointInfo, createIntersectionPoint, clearIntersectionPoints, splitLineAtPoint, splitAllLines |
| 12 | `undoRedo.js` | 56 | Undo/Redo: saveToUndoStack, undoAction, redoAction |
| 13 | `contextMenu.js` | 80 | Контекстное меню: showContextMenu, deleteObject, duplicateObject, bringObjectToFront, sendObjectToBack |
| 14 | `imageManager.js` | 342 | Изображения: defaultImages, allImages, loadFabricImage, updateImageLibrary, addImageAtPosition, splitLinesAtImagePosition |
| 15 | `modals.js` | 438 | Модалки: createModal, showLinePropertiesModal, showObjectPropertiesModal, applyLineProperties, applyObjectProperties, initializeModals, clearCanvas |
| 16 | `propertyPanel.js` | 102 | Панель свойств: updatePropertiesPanel, updateStatus |
| 17 | `canvasSetup.js` | 528 | Canvas: initializeCanvas, drawGrid, setupCanvasEvents, все mouse-обработчики, activateLineDrawing, deactivateAllModes, lineDragState, extendSetupCanvasEvents |
| 18 | `keyboard.js` | 120 | Клавиши: setupKeyboardShortcuts, toggleNodeLock, isPointInLockedNode. **Shift+Delete** обходит блокировку узла |
| 19 | `main5.js` | 169 | **Точка входа**: глобальные переменные, textBaseline-фикс, DOMContentLoaded-инициализация, window-экспорты |
| 20 | `projectManager.js` | 155 | Сохранение/загрузка JSON + localStorage + **автосохранение** (autoSaveDrawing, restoreFromAutoSave, clearAutoSave, debouncedAutoSave) |
| 21 | `csvExport.js` | 77 | Экспорт таблицы ветвей в CSV |
| 22 | `pdfExport.js` | 250 | Экспорт схемы + таблицы в PDF |

### Архитектурный паттерн
- Каждый модуль — IIFE: `(function(global) { ... })(window);`
- Функции экспортируются в `window` через `global.funcName = funcName;`
- Глобальные переменные (canvas, undoStack, cachedLines и др.) объявлены в `main5.js` и доступны всем модулям
- Порядок загрузки в index.html обеспечивает зависимости (config → utils → airModel → ... → main5.js)
- projectManager, csvExport, pdfExport — отдельные IIFE-модули, читают данные через window-функции (getExportRows, getLastCalculationResult)

## Ключевые формулы (совпадают с Excel)

```
Периметр:       P = C_section × √S       (C зависит от типа сечения: 3.54–4.16)
Геом. фактор:   x = P × L / S
Сопротивление:  R = α × x                (α — коэфф. шероховатости крепи)
С дельтой:      R_total = (α + Δ) × x    = baseR + x × Δ_propagated
Депрессия:      h = R × Q²
Скорость:       v = Q / S
Ест. тяга:      He = 9.81 × 0.0047 × H × (t1 - t2) × sign
```

## Архитектура расчёта (airSolver.js)

### Основная функция: `calculateAirFlows()` (в airSolver.js)
Оркестратор, вызывает подфункции в порядке:

1. **Валидация** — проверка нулевых площадей/длин, наличия источника
2. **Построение узлов** — из `pointMap` (объекты привязываются к узлам/линиям через `collectNetworkAttachmentInfo()` из networkBuilder.js)
3. **Ориентация рёбер** — **ЗАЩИЩЁННЫЙ БЛОК, НЕ ТРОГАТЬ** (внутри calculateAirFlows в airSolver.js)
   - BFS от источников (вентиляторов с `isFlowSource=true`)
   - Итеративный flip перевёрнутых линий
   - Обработка несвязных подграфов
4. **`propagateDeltas(edges, nodes)`** (airSolver.js) — рекурсивная пропагация Δ вниз по сети
   - `delta[edge] = local_delta + endNode_delta + Σ delta[children]`
   - `totalResistance = baseR + geometryFactor × propagatedDelta`
5. **`performTopologicalSort(nodes)`** (airSolver.js) — топосортировка (с fallback для циклов)
6. **`solveNodePotentials(nodes, edges)`** (airSolver.js) — Гаусс-Зейдель (до 500 итераций, tol=1e-8)
   - `P[i] = (srcQ + Σ(P[j]/R[ij])) / Σ(1/R[ij])`
   - `Q = (P_from - P_to) / R`, переориентация рёбер при Q < 0
7. **`writeFlowResults(edges)`** (airSolver.js) — запись результатов в `line.properties`
8. **`computeNetworkMetrics(nodes, edges, topoOrder)`** (airSolver.js) — Hсети, He, Hвент,тр

### Привязка объектов: `collectNetworkAttachmentInfo()` (в networkBuilder.js)
- Объекты привязываются к ближайшему узлу (≤18px) или линии (≤35px)
- Вентиляторы и атмосфера предпочитают узлы
- Объекты на линиях → `edge.localDeltaCoefficient`
- Объекты на узлах → `node.localDeltaCoefficient`

### Типы объектов
| Тип | Поведение в расчёте |
|---|---|
| `fan` | Источник потока (`airVolume` при `isFlowSource=true`) |
| `valve` | Сопротивление (двери, перемычки: 0–10000 Н·с²/м⁴) |
| `atmosphere` | Естественная тяга (He из H, t1, t2) |
| `fire` | Сопротивление (очаг пожара) |
| `default` | Сопротивление из каталога |

### Конфигурация (в config.js)
- `AIR_MODEL_CONFIG` — коэффициенты сечений, шероховатости, сопротивления дверей
- `AIR_MODEL_CONFIG.SOLVER_MAX_ITERATIONS` = 500
- `AIR_MODEL_CONFIG.SOLVER_TOLERANCE` = 1e-8
- `AIR_MODEL_CONFIG.MIN_RESISTANCE` = 1e-9
- `OBJECT_RESISTANCE_CATALOG` — каталог сопротивлений (перемычки, двери)
- `APP_CONFIG` — grid, snap radius, undo steps

### Экспорт данных (в chainAnalysis.js)
- `getExportRows()` → массив объектов с полями: `name, length, area, sectionType, supportType, alpha, perimeter, resistance, objectResistance, totalResistance, flow, velocity, depression, attachedObjects`
- `getLastCalculationResult()` (в main5.js) → `{ nodes, edges, pointMap, networkDepressionPa, naturalDraftPa, requiredFanPressurePa, totalSourceFlow }`
- CSV и PDF читают данные через эти функции

## Excel-справка (3 варианта)

### Вкладка 1: 6 ветвей (1-2, 2-3, 2-5, 3-4, 4-5, 5-6)
Базовый расчёт: R = α × P × L / S, деление потока по сопротивлениям.

### Вкладка 2: 6 ветвей + дельта
Добавлен столбец M (дополнительное сопротивление). Объект с Δ=0.0027 на ветви 3-4.
Формула: R = (α + Δ) × P × L / S. Пропагация: M[parent] = N[parent] + Σ M[children].

### Вкладка 3: 12 ветвей (+ 5-7, 7-8, 7-10, 8-9, 9-10, 10-11)
Баг в Excel: объект на ветви 5-6 с Δ=0.0027 есть в расчётах (N21), но отсутствует на диаграмме. Код обрабатывает корректно.

## Автосохранение (projectManager.js)

- `debouncedAutoSave()` — debounce 2 сек, вызывается из `saveToUndoStack()` и canvas-событий `object:added/modified/removed`
- Ключи localStorage: `fabricDrawing_autosave` (JSON), `fabricDrawing_autosave_time` (ISO timestamp)
- При загрузке страницы (`main5.js` → DOMContentLoaded) проверяется `hasAutoSave()`, показывается баннер `#autosaveRecoveryBanner`
- `clearCanvas()` в modals.js вызывает `clearAutoSave()`
- Пустой холст — автосохранение удаляется автоматически

## Удаление из заблокированных узлов

- `Delete` — блокируется если линия в заблокированном узле (keyboard.js, contextMenu.js, modals.js)
- `Shift+Delete` — обходит блокировку (keyboard.js)
- `deleteObject(force)` — параметр `force=true` обходит блокировку (contextMenu.js)
- `deleteCurrentObject()` в modals.js — показывает `confirm()` вместо жёсткого отказа

## Координаты узлов и getPointKey (utils.js)

- `getPointKey(x, y)` округляет до **2 знаков** (0.01px) для формирования ключа узла
- Это сделано для компенсации микро-расхождений координат Fabric.js при сериализации/десериализации линий
- `roundTo5()` по-прежнему используется для расчётных значений (сопротивление, длина и т.д.)
- `splitLineAtPoint()` использует `roundTo5(point.x/y)` вместо пересчитанной проекции — гарантирует одинаковые координаты для всех линий в точке разреза

## Кнопка "Разделить по центрам" (splitAllLinesAtObjectCenters)

- Дублирует автоматическое поведение `splitLinesAtImagePosition` (imageManager.js) при `autoSplitMode=true`
- Полезна только если autoSplit был выключен при размещении объектов
- Можно безопасно убрать из UI — функция останется доступна программно

## Важные ограничения

1. **Алгоритм направлений (BFS-ориентация)** — НЕ МОДИФИЦИРОВАТЬ. Пользователь подтвердил что он работает верно.
2. Линейный солвер (Q = ΔP/R) — физически приближённый (реальная модель квадратичная h=RQ²), но соответствует Excel.
3. Пропагация дельт суммирует ВСЕ дочерние ветви включая параллельные — это намеренно, соответствует Excel.
4. `roundTo5()` — округление до 5 знаков. Применять только к финальным значениям, не к промежуточным.
