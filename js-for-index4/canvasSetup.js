// canvasSetup.js — extracted from main5.js
(function(global) {

function getCV(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ==================== PAN & ZOOM ====================
let isPanning = false;
let lastPanX = 0, lastPanY = 0;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5.0;
const ZOOM_STEP = 0.1;

function updateZoomIndicator() {
  const el = document.getElementById('zoomLevel');
  if (el) el.textContent = Math.round((canvas.getZoom() || 1) * 100) + '%';
}

function zoomToPoint(point, newZoom) {
  newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
  canvas.zoomToPoint(point, newZoom);
  drawGrid(APP_CONFIG.GRID_SIZE);
  updateZoomIndicator();
}

function zoomIn() {
  const center = new fabric.Point(canvas.width / 2, canvas.height / 2);
  zoomToPoint(center, canvas.getZoom() + ZOOM_STEP);
}

function zoomOut() {
  const center = new fabric.Point(canvas.width / 2, canvas.height / 2);
  zoomToPoint(center, canvas.getZoom() - ZOOM_STEP);
}

function zoomReset() {
  const objs = canvas.getObjects().filter(o => o.id !== 'grid-group' && !o.isPreview &&
    o.id !== 'intersection-point' && o.id !== 'intersection-point-label' &&
    o.id !== 'air-volume-text' && o.id !== 'sealed-node-marker' && o.id !== 'dangling-marker');
  if (!objs.length) {
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    drawGrid(APP_CONFIG.GRID_SIZE);
    updateZoomIndicator();
    return;
  }
  // Bounding box всех объектов
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  objs.forEach(o => {
    const br = o.getBoundingRect(true);
    if (br.left < minX) minX = br.left;
    if (br.top < minY) minY = br.top;
    if (br.left + br.width > maxX) maxX = br.left + br.width;
    if (br.top + br.height > maxY) maxY = br.top + br.height;
  });
  // getBoundingRect при нестандартном viewportTransform возвращает экранные координаты —
  // конвертируем обратно в мировые
  const vpt = canvas.viewportTransform;
  const z = vpt[0] || 1;
  minX = (minX - vpt[4]) / z;
  minY = (minY - vpt[5]) / z;
  maxX = (maxX - vpt[4]) / z;
  maxY = (maxY - vpt[5]) / z;

  const padding = 60;
  const contentW = maxX - minX + padding * 2;
  const contentH = maxY - minY + padding * 2;
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(canvas.width / contentW, canvas.height / contentH)));
  canvas.setViewportTransform([zoom, 0, 0, zoom,
    -((minX - padding) * zoom) + (canvas.width - contentW * zoom) / 2,
    -((minY - padding) * zoom) + (canvas.height - contentH * zoom) / 2
  ]);
  drawGrid(APP_CONFIG.GRID_SIZE);
  updateZoomIndicator();
}

function handleMouseWheel(opt) {
  opt.e.preventDefault();
  opt.e.stopPropagation();
  const delta = opt.e.deltaY;
  let zoom = canvas.getZoom();
  zoom *= 0.999 ** delta;
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  const point = canvas.getPointer(opt.e, true);
  canvas.zoomToPoint(new fabric.Point(point.x, point.y), zoom);
  drawGrid(APP_CONFIG.GRID_SIZE);
  updateZoomIndicator();
}

function handlePanMouseUp() {
  if (isPanning) {
    isPanning = false;
    canvas.selection = true;
    canvas.defaultCursor = spacePressed ? 'grab' : 'default';
    drawGrid(APP_CONFIG.GRID_SIZE);
  }
}

// Отключаем стандартные контролы Fabric.js для всех линий глобально
fabric.Line.prototype.hasControls = false;
fabric.Line.prototype.hasBorders  = false;
fabric.Line.prototype.lockRotation = true;
fabric.Line.prototype.lockScalingX = true;
fabric.Line.prototype.lockScalingY = true;

function initializeCanvas() {
  canvas = new fabric.Canvas('fabric-canvas', {
    backgroundColor: getCV('--canvas-bg') || '#12131A',
    preserveObjectStacking: true,
    selection: true,
    selectionColor: getCV('--canvas-selection') || 'rgba(79,154,255,0.15)',
    selectionBorderColor: getCV('--canvas-selection-border') || '#4F9AFF',
    selectionLineWidth: 2,
    renderOnAddRemove: true,
    skipOffscreen: true,
    enableRetinaScaling: false
  });
  updateCanvasSize();
  drawGrid(APP_CONFIG.GRID_SIZE);
  setupCanvasEvents();
  extendSetupCanvasEvents();
  window.canvas = canvas; // назначаем после создания

  // ═══ Контекстное меню по RMB ═══════════════════════════════════════════
  // Fabric.js 5.x не всегда надёжно отправляет 'mouse:down' с button===2,
  // а даже когда отправляет — preventDefault в mousedown НЕ блокирует
  // последующее событие contextmenu (браузерное меню всё равно показывается).
  // Поэтому ловим contextmenu напрямую на upperCanvasEl и показываем
  // собственное меню сами.
  function _onCanvasContextMenu(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    // Вычисляем мировые координаты с учётом viewportTransform
    var rect = canvas.upperCanvasEl.getBoundingClientRect();
    var canvasX = ev.clientX - rect.left;
    var canvasY = ev.clientY - rect.top;
    var vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    var worldX = (canvasX - vpt[4]) / (vpt[0] || 1);
    var worldY = (canvasY - vpt[5]) / (vpt[3] || 1);

    // Показ меню: screen-координаты (ev.clientX/Y) — для позиционирования
    // самого меню (position:fixed), world-координаты — для поиска тупика
    if (typeof showContextMenuExtended === 'function') {
      showContextMenuExtended(ev.clientX, ev.clientY, worldX, worldY);
    } else if (typeof showContextMenu === 'function') {
      showContextMenu(ev.clientX, ev.clientY);
    }

    return false;
  }

  var upperEl = canvas.upperCanvasEl;
  if (upperEl) upperEl.addEventListener('contextmenu', _onCanvasContextMenu);
}

function updateCanvasSize() {
  const wrapper = document.getElementById('canvas-wrapper');
  if (!wrapper) return;
  canvas.setDimensions({
    width: wrapper.clientWidth,
    height: wrapper.clientHeight
  });
  if (gridVisible) drawGrid(APP_CONFIG.GRID_SIZE);
  scheduleRender();
}

function drawGrid(gridSize) {
  const old = canvas.getObjects().filter(obj => obj.id === 'grid-group');
  old.forEach(obj => canvas.remove(obj));
  if (!gridVisible || !canvas) return;

  // Вычисляем видимую область в мировых координатах
  const vpt = canvas.viewportTransform;
  const zoom = vpt[0] || 1;
  const worldLeft = -vpt[4] / zoom;
  const worldTop = -vpt[5] / zoom;
  const worldRight = worldLeft + canvas.width / zoom;
  const worldBottom = worldTop + canvas.height / zoom;

  // Начало/конец с выравниванием на сетку (с запасом в 1 шаг)
  const startX = Math.floor(worldLeft / gridSize) * gridSize - gridSize;
  const endX   = Math.ceil(worldRight / gridSize) * gridSize + gridSize;
  const startY = Math.floor(worldTop / gridSize) * gridSize - gridSize;
  const endY   = Math.ceil(worldBottom / gridSize) * gridSize + gridSize;

  const gridColor = getCV('--canvas-grid') || 'rgba(30,31,46,0.8)';
  const lines = [];
  for (let x = startX; x <= endX; x += gridSize) {
    lines.push(new fabric.Line([x, startY, x, endY], {
      stroke: gridColor, strokeWidth: 1,
      selectable: false, evented: false, id: 'grid-line'
    }));
  }
  for (let y = startY; y <= endY; y += gridSize) {
    lines.push(new fabric.Line([startX, y, endX, y], {
      stroke: gridColor, strokeWidth: 1,
      selectable: false, evented: false, id: 'grid-line'
    }));
  }
  const group = new fabric.Group(lines, {
    selectable: false,
    evented: false,
    id: 'grid-group'
  });
  canvas.add(group);
  canvas.sendToBack(group);
  canvas.renderAll();
}

function toggleGrid() {
  gridVisible = !gridVisible;
  const btn = document.getElementById('gridToggleBtn');
  if (btn) {
    if (gridVisible) btn.classList.add('active'); else btn.classList.remove('active');
  }
  drawGrid(APP_CONFIG.GRID_SIZE);
  canvas.renderAll();
}

function snapToGrid(value) {
  return Math.round(value / APP_CONFIG.GRID_SIZE) * APP_CONFIG.GRID_SIZE;
}

// ==================== СОБЫТИЯ CANVAS ====================
function setupCanvasEvents() {
  canvas.on('mouse:down', handleCanvasMouseDown);
  canvas.on('mouse:move', throttle(handleCanvasMouseMove, 16));
  canvas.on('mouse:up', handlePanMouseUp);
  canvas.on('mouse:wheel', handleMouseWheel);
  canvas.on('mouse:out', handleCanvasMouseOut);
  canvas.on('mouse:dblclick', handleCanvasDoubleClick);
  canvas.on('selection:created', updatePropertiesPanel);
  canvas.on('selection:updated', updatePropertiesPanel);
  canvas.on('selection:cleared', updatePropertiesPanel);
  canvas.on('object:added', handleObjectAdded);
  canvas.on('object:modified', handleObjectModified);
  canvas.on('object:removed', handleObjectRemoved);
}

function handleCanvasMouseDown(e) {
  // Pan mode: Space + ЛКМ
  if (spacePressed && e.e.button === 0) {
    isPanning = true;
    lastPanX = e.e.clientX;
    lastPanY = e.e.clientY;
    canvas.selection = false;
    canvas.defaultCursor = 'grabbing';
    return;
  }

  const pointer = canvas.getPointer(e.e);

  if (isCrossLayerMode && e.e.button === 0) {
    const x = snapToGrid(pointer.x);
    const y = snapToGrid(pointer.y);
    addCrossLayerConnection(x, y);
    return;
  }

  if (currentImageData && !isDrawingLine && e.e.button === 0 && (!e.target || e.target.id === 'grid-group' || e.target.type === 'text')) {
    addImageAtPosition(pointer.x, pointer.y);
    currentImageData = null;
    const activeItems = document.querySelectorAll('.image-item.active');
    for (let it of activeItems) it.classList.remove('active');
    canvas.defaultCursor = 'default';
    canvas.selection = true;
    return;
  }
  if (isDrawingLine) {
    handleLineDrawingStart(e, pointer);
    return;
  }
  if (e.e.button === 2) {
    // RMB обрабатывается через отдельный contextmenu-listener на
    // upperCanvasEl (см. initializeCanvas::_onCanvasContextMenu).
    // Здесь только preventDefault, чтобы Fabric не обрабатывал RMB как
    // начало выделения/рисования/драга.
    e.e.preventDefault();
    return;
  }
  if (!isDrawingLine && e.target && e.target.type === 'line' && e.e.button === 0) {
    const line = e.target;
    const endpoints = getLineAbsoluteEndpoints(line);
    const distStart = Math.hypot(pointer.x - endpoints.x1, pointer.y - endpoints.y1);
    const distEnd = Math.hypot(pointer.x - endpoints.x2, pointer.y - endpoints.y2);
    const threshold = 15;
    if (distStart < threshold || distEnd < threshold) {
      lineDragState.pending = true;
      lineDragState.pendingEnd = distStart < distEnd ? 'start' : 'end';
    } else {
      lineDragState.pending = true;
      lineDragState.pendingEnd = 'whole';
    }
    lineDragState.pendingLine = line;
    // Захватываем абсолютные координаты ЗДЕСЬ, до любого движения
    lineDragState.pendingAbsX1 = endpoints.x1;
    lineDragState.pendingAbsY1 = endpoints.y1;
    lineDragState.pendingAbsX2 = endpoints.x2;
    lineDragState.pendingAbsY2 = endpoints.y2;
    lineDragState.pendingLeft   = line.left;
    lineDragState.pendingTop    = line.top;
    // Вычисляем startFree/endFree ЗДЕСЬ — до движения, пока connectionNodes актуален
    const _sk = getPointKey(endpoints.x1, endpoints.y1);
    const _ek = getPointKey(endpoints.x2, endpoints.y2);
    const _sn = window.connectionNodes ? window.connectionNodes.get(_sk) : null;
    const _en = window.connectionNodes ? window.connectionNodes.get(_ek) : null;
    const _sl = !!(_sn && _sn.locked && (_sn.incomingEdges.length + _sn.outgoingEdges.length > 1));
    const _el = !!(_en && _en.locked && (_en.incomingEdges.length + _en.outgoingEdges.length > 1));
    lineDragState.pendingStartFree = !_sl && (!_sn || (_sn.incomingEdges.length + _sn.outgoingEdges.length <= 1));
    lineDragState.pendingEndFree = !_el && (!_en || (_en.incomingEdges.length + _en.outgoingEdges.length <= 1));
    lineDragState.pendingStartLocked = _sl;
    lineDragState.pendingEndLocked = _el;
  }
}

function handleLineDrawingStart(e, pointer) {
  if (!lineStartPoint) {
    let snappedX = snapToGrid(pointer.x);
    let snappedY = snapToGrid(pointer.y);
    let startFromObject = null;

    if (altKeyPressed && e.target) {
      const edge = findClosestPointOnObjectEdge(e.target, pointer);
      if (edge) {
        startFromObject = { x: edge.x, y: edge.y, object: e.target };
        snappedX = edge.x;
        snappedY = edge.y;
      }
    }

    const node = isPointInLockedNode(snappedX, snappedY);
    if (node) {
      snappedX = node.node.x;
      snappedY = node.node.y;
    }

    lineStartPoint = { x: snappedX, y: snappedY };
    if (startFromObject) {
      lineStartPoint.object = startFromObject.object;
      lineStartPoint.edgePoint = true;
    }

    previewLine = new fabric.Line([lineStartPoint.x, lineStartPoint.y, snappedX, snappedY], {
      stroke: APP_CONFIG.DEFAULT_LINE_COLOR,
      strokeWidth: 2,
      strokeDashArray: [5, 5],
      selectable: false,
      evented: false,
      id: 'preview-line',
      isPreview: true
    });
    canvas.add(previewLine);
  } else {
    handleLineDrawingEnd(e, pointer);
  }
}

function handleLineDrawingEnd(e, pointer) {
  let snappedX = snapToGrid(pointer.x);
  let snappedY = snapToGrid(pointer.y);
  let endFromObject = null;

  if (altKeyPressed && e.target) {
    const edge = findClosestPointOnObjectEdge(e.target, pointer);
    if (edge) {
      endFromObject = { x: edge.x, y: edge.y, object: e.target };
      snappedX = edge.x;
      snappedY = edge.y;
    }
  }

  const node = isPointInLockedNode(snappedX, snappedY);
  if (node) {
    snappedX = node.node.x;
    snappedY = node.node.y;
  }

  if (!altKeyPressed && !node) {
    const lineHit = findLinesInArea(snappedX, snappedY, 10);
    if (lineHit.length && lineHit[0].param > 0.05 && lineHit[0].param < 0.95) {
      const split = splitLineAtPoint(lineHit[0].line, {
        x: snappedX,
        y: snappedY
      });
      if (split) {
        saveToUndoStack();
        canvas.remove(lineHit[0].line);
        removeAirVolumeText(lineHit[0].line);
        canvas.add(split.line1);
        canvas.add(split.line2);
        if (typeof applyLayerColorToObject === 'function') {
          applyLayerColorToObject(split.line1);
          applyLayerColorToObject(split.line2);
        }
        createOrUpdateAirVolumeText(split.line1);
        createOrUpdateAirVolumeText(split.line2);
        snappedX = split.line2.x1;
        snappedY = split.line2.y1;
      }
    }
  }

  const length = Math.hypot(snappedX - lineStartPoint.x, snappedY - lineStartPoint.y);
  const lineId = generateLineId();
  const startObjectProps = lineStartPoint.object ? synchronizeObjectDerivedProperties(lineStartPoint.object.properties || {}) : {};
  const props = createDefaultLineProperties(`Линия ${getCachedLines().length + 1}`, getObjectSupplyContribution(startObjectProps));
  props.length = roundTo5(length);
  props.number = typeof getNextElementNumber === 'function' ? getNextElementNumber() : undefined;
  props.layerId = typeof getActiveLayerId === 'function' ? getActiveLayerId() : 'default';

  const newLine = new fabric.Line([lineStartPoint.x, lineStartPoint.y, snappedX, snappedY], {
    stroke: APP_CONFIG.DEFAULT_LINE_COLOR,
    strokeWidth: APP_CONFIG.DEFAULT_LINE_WIDTH,
    fill: false,
    strokeLineCap: 'round',
    hasControls: true,
    hasBorders: true,
    id: lineId,
    properties: props
  });

  if (lineStartPoint.object) {
    newLine.lineStartsFromObject = true;
    newLine.startObject = lineStartPoint.object;
  }

  if (previewLine) {
    canvas.remove(previewLine);
    previewLine = null;
  }

  canvas.add(newLine);
  if (typeof applyLayerColorToObject === 'function') applyLayerColorToObject(newLine);
  canvas.setActiveObject(newLine);

  saveToUndoStack();
  invalidateCache();
  updateConnectionGraph();
  createOrUpdateAirVolumeText(newLine);

  // Авторазделение: если включён autoSplitMode — разрезаем новую линию в точках,
  // где она проходит через существующие объекты на холсте.
  if (typeof autoSplitMode !== 'undefined' && autoSplitMode) {
    try {
      const imgs = (typeof getCachedImages === 'function') ? getCachedImages() : [];
      for (const img of imgs) {
        if (!img || img.type !== 'image') continue;
        const c = getObjectCenter(img);
        // findClosestPointOnLine всегда требует "живую" линию — после сплитов используем активную
        const target = canvas.getActiveObject() || newLine;
        if (!target || target.type !== 'line') break;
        const closest = findClosestPointOnLine(c, target);
        if (closest && closest.param > 0.05 && closest.param < 0.95 && closest.distance < 30) {
          const nodeCheck = isPointInLockedNode(closest.x, closest.y);
          if (nodeCheck && nodeCheck.node.locked) continue;
          const split = splitLineAtPoint(target, { x: closest.x, y: closest.y });
          if (split) {
            canvas.remove(target);
            removeAirVolumeText(target);
            canvas.add(split.line1);
            canvas.add(split.line2);
            if (typeof applyLayerColorToObject === 'function') {
              applyLayerColorToObject(split.line1);
              applyLayerColorToObject(split.line2);
            }
            createOrUpdateAirVolumeText(split.line1);
            createOrUpdateAirVolumeText(split.line2);
            invalidateCache();
            canvas.setActiveObject(split.line2);
          }
        }
      }
      updateConnectionGraph();
    } catch (err) {
      console.warn('Авторазделение после рисования: ошибка', err);
    }
  }

  scheduleRender();
  updatePropertiesPanel();

  if (!isContinuousLineMode) {
    deactivateAllModes();
  } else {
    lineStartPoint = { x: snappedX, y: snappedY };
    if (endFromObject) lineStartPoint.object = endFromObject.object;
    previewLine = new fabric.Line([lineStartPoint.x, lineStartPoint.y, snappedX, snappedY], {
      stroke: APP_CONFIG.DEFAULT_LINE_COLOR,
      strokeWidth: 2,
      strokeDashArray: [5, 5],
      selectable: false,
      evented: false,
      id: 'preview-line',
      isPreview: true
    });
    canvas.add(previewLine);
  }
}

function handleCanvasMouseMove(e) {
  if (isPanning) {
    const dx = e.e.clientX - lastPanX;
    const dy = e.e.clientY - lastPanY;
    lastPanX = e.e.clientX;
    lastPanY = e.e.clientY;
    const vpt = canvas.viewportTransform;
    vpt[4] += dx;
    vpt[5] += dy;
    canvas.setViewportTransform(vpt);
    return;
  }
  if (!isDrawingLine || !lineStartPoint) return;
  const pointer = canvas.getPointer(e.e);
  const snappedX = snapToGrid(pointer.x);
  const snappedY = snapToGrid(pointer.y);
  const preview = canvas.getObjects().find(obj => obj.id === 'preview-line');
  if (preview) {
    preview.set({ x2: snappedX, y2: snappedY });
    preview.setCoords();
    canvas.requestRenderAll();
  }
}

function handleCanvasMouseOut() {
  if (altKeyPressed && isDrawingLine) {
    canvas.forEachObject(obj => {
      if (obj.type !== 'line' && obj.id !== 'grid-group') {
        obj.set({ stroke: null, strokeWidth: 0 });
      }
    });
    scheduleRender();
  }
}

function handleCanvasDoubleClick(e) {
  if (e.target) {
    canvas.setActiveObject(e.target);
    showObjectPropertiesModal();
  }
}

function handleObjectAdded(e) {
  const obj = e.target;
  // Принудительно отключаем стандартные контролы Fabric для линий (на случай загрузки из JSON)
  if (obj && obj.type === 'line' && obj.id !== 'grid-line' && obj.id !== 'preview-line') {
    obj.hasControls  = false;
    obj.hasBorders   = false;
    obj.lockRotation = true;
    obj.lockScalingX = true;
    obj.lockScalingY = true;
  }
  if (obj && obj.id !== 'intersection-point' && obj.id !== 'intersection-point-label' && obj.id !== 'air-volume-text') {
    invalidateCache();
    setTimeout(() => {
      bringIntersectionPointsToFront();
      updateAllAirVolumeTexts();
    }, 100);
  }
  if (typeof debouncedAutoSave === 'function') debouncedAutoSave();
}

function handleObjectModified(e) {
  const obj = e.target;
  if (obj && obj.type === 'line') {
    calculateAllLineProperties(obj);
    createOrUpdateAirVolumeText(obj);
    invalidateCache();
    updateConnectionGraph();
  }
  if (typeof debouncedAutoSave === 'function') debouncedAutoSave();
}

function handleObjectRemoved(e) {
  const obj = e.target;
  if (obj && obj.type === 'line') removeAirVolumeText(obj);
  invalidateCache();
  updateConnectionGraph();
  if (typeof debouncedAutoSave === 'function') debouncedAutoSave();
}

// ==================== УПРАВЛЕНИЕ РЕЖИМАМИ ====================
function activateLineDrawing() {
  deactivateAllModes();
  currentImageData = null;
  const activeItems = document.querySelectorAll('.image-item.active');
  for (let it of activeItems) it.classList.remove('active');
  cleanupPreviewLines();
  isDrawingLine = true;
  canvas.defaultCursor = 'crosshair';
  canvas.selection = false;
  canvas.forEachObject(obj => {
    if (obj.id !== 'grid-group') obj.selectable = false;
  });
  showNotification('Режим рисования линии. Клик для начала, ESC отмена.', 'info');
}

function cleanupPreviewLines() {
  const objects = canvas.getObjects();
  for (let obj of objects) {
    if (obj.id === 'preview-line') canvas.remove(obj);
  }
}

function deactivateAllModes() {
  isDrawingLine = false;
  isCrossLayerMode = false;
  const clBtn = document.getElementById('crossLayerBtn');
  if (clBtn) clBtn.classList.remove('active');
  cleanupPreviewLines();
  previewLine = null;
  lineStartPoint = null;
  lastLineEndPoint = null;
  canvas.defaultCursor = 'default';
  canvas.selection = true;
  canvas.forEachObject(obj => {
    if (obj.id !== 'grid-group') obj.selectable = true;
  });
  updateStatus();
}

function toggleCrossLayerMode() {
  if (isCrossLayerMode) {
    deactivateAllModes();
    showNotification('Режим точек связи выключен', 'info');
    return;
  }
  deactivateAllModes();
  isCrossLayerMode = true;
  canvas.defaultCursor = 'crosshair';
  canvas.selection = false;
  const btn = document.getElementById('crossLayerBtn');
  if (btn) btn.classList.add('active');
  showNotification('Режим точек связи слоёв: кликните на точку пересечения линий разных слоёв. Повторный клик = убрать.', 'info');
}

function toggleContinuousMode() {
  isContinuousLineMode = !isContinuousLineMode;
  const btn = document.getElementById('continuousModeBtn');
  if (btn) {
    if (isContinuousLineMode) btn.classList.add('active'); else btn.classList.remove('active');
  }
  showNotification(isContinuousLineMode ? 'Непрерывный режим включён' : 'Непрерывный режим выключен', 'info');
}

function toggleAutoSplitMode() {
  autoSplitMode = !autoSplitMode;
  const btn = document.getElementById('autoSplitBtn');
  if (btn) {
    if (autoSplitMode) btn.classList.add('active'); else btn.classList.remove('active');
  }
}

function toggleLineSplitMode() {
  lineSplitMode = lineSplitMode === 'AUTO' ? 'MANUAL' : 'AUTO';
  const btn = document.getElementById('lineSplitModeBtn');
  if (btn) {
    btn.textContent = lineSplitMode === 'AUTO' ? 'АВТО' : 'РУЧНОЙ';
    if (lineSplitMode === 'AUTO') btn.classList.remove('active'); else btn.classList.add('active');
  }
}

const lineDragState = {
  active: false, line: null,
  // Абсолютные координаты концов ДО начала перемещения (захваченные в mousedown)
  origAbsX1: 0, origAbsY1: 0, origAbsX2: 0, origAbsY2: 0,
  // left/top линии ДО начала перемещения (для вычисления дельты drag'а)
  origLeft: 0, origTop: 0,
  startLocked: false, endLocked: false, draggedEnd: null,
  startFree: false, endFree: false,
  pending: false, pendingEnd: null, pendingLine: null,
  pendingAbsX1: 0, pendingAbsY1: 0, pendingAbsX2: 0, pendingAbsY2: 0,
  pendingLeft: 0, pendingTop: 0,
  pendingStartFree: undefined, pendingEndFree: undefined,
  pendingStartLocked: false, pendingEndLocked: false
};

function extendSetupCanvasEvents() {
  // Ctrl+Shift+D — режим перетаскивания линии целиком с отрывом
  let ctrlShiftDActive = false;
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      ctrlShiftDActive = true;
      e.preventDefault();
    }
  });
  document.addEventListener('keyup', function(e) {
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'D' || e.key === 'd') {
      ctrlShiftDActive = false;
    }
  });

  canvas.on('object:moving', e => {
    const obj = e.target;
    if (obj.type === 'line') {
      if (!lineDragState.active) {
        if (lineDragState.pending && lineDragState.pendingLine === obj) {
          // Переносим ВСЕ значения из mousedown (захваченные ДО любого движения)
          lineDragState.draggedEnd  = lineDragState.pendingEnd;
          lineDragState.startFree   = lineDragState.pendingStartFree;
          lineDragState.endFree     = lineDragState.pendingEndFree;
          lineDragState.startLocked = lineDragState.pendingStartLocked;
          lineDragState.endLocked   = lineDragState.pendingEndLocked;
          lineDragState.origAbsX1   = lineDragState.pendingAbsX1;
          lineDragState.origAbsY1   = lineDragState.pendingAbsY1;
          lineDragState.origAbsX2   = lineDragState.pendingAbsX2;
          lineDragState.origAbsY2   = lineDragState.pendingAbsY2;
          lineDragState.origLeft    = lineDragState.pendingLeft;
          lineDragState.origTop     = lineDragState.pendingTop;
          lineDragState.pending     = false;
          lineDragState.pendingLine = null;
        } else {
          // Drag без mousedown — берём текущее состояние как исходное
          lineDragState.draggedEnd = 'whole';
          const _ep = getLineAbsoluteEndpoints(obj);
          lineDragState.origAbsX1 = _ep.x1; lineDragState.origAbsY1 = _ep.y1;
          lineDragState.origAbsX2 = _ep.x2; lineDragState.origAbsY2 = _ep.y2;
          lineDragState.origLeft  = obj.left; lineDragState.origTop = obj.top;
          const _sn2 = window.connectionNodes ? window.connectionNodes.get(getPointKey(_ep.x1, _ep.y1)) : null;
          const _en2 = window.connectionNodes ? window.connectionNodes.get(getPointKey(_ep.x2, _ep.y2)) : null;
          lineDragState.startLocked = !!(_sn2 && _sn2.locked && (_sn2.incomingEdges.length + _sn2.outgoingEdges.length > 1));
          lineDragState.endLocked   = !!(_en2 && _en2.locked && (_en2.incomingEdges.length + _en2.outgoingEdges.length > 1));
          lineDragState.startFree = !lineDragState.startLocked && (!_sn2 || (_sn2.incomingEdges.length + _sn2.outgoingEdges.length <= 1));
          lineDragState.endFree   = !lineDragState.endLocked   && (!_en2 || (_en2.incomingEdges.length + _en2.outgoingEdges.length <= 1));
        }
        lineDragState.active = true;
        lineDragState.line = obj;
      }

      // Дельта перемещения мыши относительно начала drag'а
      const dx = obj.left - lineDragState.origLeft;
      const dy = obj.top  - lineDragState.origTop;

      const de = lineDragState.draggedEnd;

      if (de === 'start' && lineDragState.startFree) {
        // Двигаем только начальный конец, конечный зафиксирован
        const nx1 = snapToGrid(lineDragState.origAbsX1 + dx);
        const ny1 = snapToGrid(lineDragState.origAbsY1 + dy);
        obj.set({ x1: nx1, y1: ny1, x2: lineDragState.origAbsX2, y2: lineDragState.origAbsY2 });
        obj.setCoords();
      } else if (de === 'end' && lineDragState.endFree) {
        // Двигаем только конечный конец, начальный зафиксирован
        const nx2 = snapToGrid(lineDragState.origAbsX2 + dx);
        const ny2 = snapToGrid(lineDragState.origAbsY2 + dy);
        obj.set({ x1: lineDragState.origAbsX1, y1: lineDragState.origAbsY1, x2: nx2, y2: ny2 });
        obj.setCoords();
      } else if (ctrlShiftDActive) {
        // Ctrl+Shift+D: перетащить линию целиком, корректируя заблокированные концы
        let nx1 = snapToGrid(lineDragState.origAbsX1 + dx);
        let ny1 = snapToGrid(lineDragState.origAbsY1 + dy);
        let nx2 = snapToGrid(lineDragState.origAbsX2 + dx);
        let ny2 = snapToGrid(lineDragState.origAbsY2 + dy);
        if (lineDragState.startLocked) { nx1 = lineDragState.origAbsX1; ny1 = lineDragState.origAbsY1; }
        if (lineDragState.endLocked)   { nx2 = lineDragState.origAbsX2; ny2 = lineDragState.origAbsY2; }
        obj.set({ x1: nx1, y1: ny1, x2: nx2, y2: ny2 });
        obj.setCoords();
      } else {
        // Заблокировано: возвращаем линию на место
        obj.set({ x1: lineDragState.origAbsX1, y1: lineDragState.origAbsY1,
                  x2: lineDragState.origAbsX2, y2: lineDragState.origAbsY2 });
        obj.setCoords();
      }
      if (obj.airVolumeText) createOrUpdateAirVolumeText(obj);
    } else if (obj.id === 'intersection-point') {
      const r = obj.radius || 6;
      const newX = roundTo5(obj.left + r);
      const newY = roundTo5(obj.top + r);

      // Порог: не считаем перетаскиванием меньше 8px — защита от случайного клика
      if (obj._dragOrigX !== undefined) {
        const dist = Math.hypot(newX - roundTo5(obj._dragOrigX), newY - roundTo5(obj._dragOrigY));
        if (dist < 8) {
          // Сбрасываем обратно, не трогаем линии
          obj.set({ left: obj._dragOrigX - r, top: obj._dragOrigY - r });
          obj.setCoords();
          return;
        }
      }

      obj._hasDragged = true;
      // Первый вызов: используем позицию до начала тащения (_dragOrigX), не текущую
      const oldX = obj._dragPrevX !== undefined
        ? obj._dragPrevX
        : (obj._dragOrigX !== undefined ? roundTo5(obj._dragOrigX) : newX);
      const oldY = obj._dragPrevY !== undefined
        ? obj._dragPrevY
        : (obj._dragOrigY !== undefined ? roundTo5(obj._dragOrigY) : newY);
      obj._dragPrevX = newX;
      obj._dragPrevY = newY;
      const key = getPointKey(oldX, oldY);
      const node = window.connectionNodes ? window.connectionNodes.get(key) : null;
      if (node) {
        node.x = newX;
        node.y = newY;
        window.connectionNodes.delete(key);
        window.connectionNodes.set(getPointKey(newX, newY), node);
        for (let edge of node.incomingEdges) {
          edge.line.set({ x2: newX, y2: newY });
          edge.line.setCoords();
          createOrUpdateAirVolumeText(edge.line);
        }
        for (let edge of node.outgoingEdges) {
          edge.line.set({ x1: newX, y1: newY });
          edge.line.setCoords();
          createOrUpdateAirVolumeText(edge.line);
        }
      }
      const label = intersectionVisuals.find(v => v.circle === obj);
      if (label && label.text) {
        label.text.set({ left: newX, top: newY });
        label.text.setCoords();
      }
    }
  });

  canvas.on('object:modified', e => {
    const obj = e.target;
    if (obj.type === 'line') {
      lineDragState.active = false;
      invalidateCache();
      updateConnectionGraph();
      createOrUpdateAirVolumeText(obj);
    } else if (obj.id === 'intersection-point') {
      const r = obj.radius || 6;
      const cx = roundTo5(obj.left + r);
      const cy = roundTo5(obj.top + r);
      const key = getPointKey(cx, cy);
      const node = window.connectionNodes ? window.connectionNodes.get(key) : null;
      if (node) {
        const affectedLines = [
          ...node.incomingEdges.map(e => e.line),
          ...node.outgoingEdges.map(e => e.line)
        ];
        for (const line of affectedLines) {
          if (typeof calculateAllLineProperties === 'function') calculateAllLineProperties(line);
          createOrUpdateAirVolumeText(line);
        }
        invalidateCache();
      }
      setTimeout(() => {
        updateConnectionGraph();
        bringIntersectionPointsToFront();
      }, 10);
    }
  });

  canvas.on('selection:created', () => {
    lineDragState.pending = false;
    lineDragState.pendingLine = null;
    lineDragState.pendingStartFree = undefined;
    lineDragState.pendingEndFree = undefined;
  });
  canvas.on('selection:cleared', () => {
    lineDragState.pending = false;
    lineDragState.pendingLine = null;
    lineDragState.pendingStartFree = undefined;
    lineDragState.pendingEndFree = undefined;
  });
}

// Exports
global.getCV = getCV;
global.initializeCanvas = initializeCanvas;
global.updateCanvasSize = updateCanvasSize;
global.drawGrid = drawGrid;
global.toggleGrid = toggleGrid;
global.snapToGrid = snapToGrid;
global.setupCanvasEvents = setupCanvasEvents;
global.handleCanvasMouseDown = handleCanvasMouseDown;
global.handleLineDrawingStart = handleLineDrawingStart;
global.handleLineDrawingEnd = handleLineDrawingEnd;
global.handleCanvasMouseMove = handleCanvasMouseMove;
global.handleCanvasMouseOut = handleCanvasMouseOut;
global.handleCanvasDoubleClick = handleCanvasDoubleClick;
global.handleObjectAdded = handleObjectAdded;
global.handleObjectModified = handleObjectModified;
global.handleObjectRemoved = handleObjectRemoved;
global.activateLineDrawing = activateLineDrawing;
global.cleanupPreviewLines = cleanupPreviewLines;
global.deactivateAllModes = deactivateAllModes;
global.toggleCrossLayerMode = toggleCrossLayerMode;
global.toggleContinuousMode = toggleContinuousMode;
global.toggleAutoSplitMode = toggleAutoSplitMode;
global.toggleLineSplitMode = toggleLineSplitMode;
global.lineDragState = lineDragState;
global.extendSetupCanvasEvents = extendSetupCanvasEvents;
global.zoomIn = zoomIn;
global.zoomOut = zoomOut;
global.zoomReset = zoomReset;
global.updateZoomIndicator = updateZoomIndicator;

})(window);
