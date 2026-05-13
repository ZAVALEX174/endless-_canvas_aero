// intersections.js — Функции пересечений и разделения линий
// Извлечено из main5.js

(function() {

function findAllIntersections(layerId) {
  const allLines = getCachedLines();
  const allImages = getCachedImages();
  const lines = layerId ? allLines.filter(l => (l.properties && l.properties.layerId || 'default') === layerId) : allLines;
  const images = layerId ? allImages.filter(i => (i.properties && i.properties.layerId || 'default') === layerId) : allImages;
  const intersections = [];

  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const inter = lineIntersection(lines[i], lines[j]);
      if (inter) intersections.push(inter);
    }
  }

  for (let line of lines) {
    for (let img of images) {
      const center = getObjectCenter(img);
      const closest = findClosestPointOnLine(center, line);
      if (closest.param >= 0 && closest.param <= 1) {
        const tolerance = Math.max(img.width * img.scaleX, img.height * img.scaleY) / 2;
        if (closest.distance <= tolerance) {
          intersections.push({
            x: closest.x,
            y: closest.y,
            line1: line,
            object: img,
            type: 'object-center',
            param: closest.param,
            distance: closest.distance
          });
        }
      }
    }
  }

  return intersections;
}

function collectPointInfo(x, y) {
  const lines = getCachedLines();
  const images = getCachedImages();
  const linesInPoint = [];
  const objectsInPoint = [];

  for (let line of lines) {
    const closest = findClosestPointOnLine({ x, y }, line);
    if (closest.distance < 10) {
      const ep = getLineAbsoluteEndpoints(line);
      const distStart = Math.hypot(x - ep.x1, y - ep.y1);
      const distEnd = Math.hypot(x - ep.x2, y - ep.y2);
      const airVolume = line.properties && line.properties.airVolume ? line.properties.airVolume : 0;
      const airResistance = line.properties && line.properties.airResistance ? line.properties.airResistance : 0;
      const name = line.properties && line.properties.name ? line.properties.name : 'Линия';
      linesInPoint.push({
        line,
        isStart: distStart < 8,
        isEnd: distEnd < 8,
        param: closest.param,
        airVolume: airVolume,
        airResistance: airResistance,
        name: name
      });
    }
  }

  for (let img of images) {
    const center = getObjectCenter(img);
    if (Math.hypot(center.x - x, center.y - y) < 35) {
      const airVolume = img.properties && img.properties.airVolume ? img.properties.airVolume : 0;
      const airResistance = img.properties && img.properties.airResistance ? img.properties.airResistance : 0;
      const name = img.properties && img.properties.name ? img.properties.name : 'Объект';
      objectsInPoint.push({
        object: img,
        name: name,
        airVolume: airVolume,
        airResistance: airResistance
      });
    }
  }

  return {
    x, y,
    linesInPoint,
    objectsInPoint,
    totalLines: linesInPoint.length,
    totalObjects: objectsInPoint.length,
    linesStarting: linesInPoint.filter(l => l.isStart).length,
    linesEnding: linesInPoint.filter(l => l.isEnd).length
  };
}

function createIntersectionPoint(x, y, index, data, color = '#ff4757') {
  const circle = new fabric.Circle({
    left: x, top: y,
    originX: 'center', originY: 'center',
    radius: 6, fill: color, stroke: color,
    selectable: true, hasControls: false, hasBorders: false,
    lockScalingX: true, lockScalingY: true, lockRotation: true,
    id: 'intersection-point', pointIndex: index, pointData: data,
    hoverCursor: 'pointer'
  });
  const text = new fabric.Text((index + 1).toString(), {
    left: x, top: y, fontSize: 10, fill: 'white',
    originX: 'center', originY: 'center',
    selectable: false, evented: false, id: 'intersection-point-label'
  });

  circle.on('mousedown', function (e) {
    // С originX/Y='center' координаты left/top — это центр круга
    this._dragOrigX = this.left;
    this._dragOrigY = this.top;
    this._hasDragged = false;
    this._dragPrevX = undefined;
    this._dragPrevY = undefined;
  });

  circle.on('mouseup', function (e) {
    if (!this._hasDragged) {
      // п.8 (2026-05-13): модалку точки пересечения открываем ТОЛЬКО в
      // режиме «стрелка». В режиме рисования/размещения/cross-layer клик
      // по узлу должен начинать новую линию из этого узла, а не открывать
      // Properties. (Аналогичная защита есть в handleCanvasDoubleClick.)
      var inDrawingMode =
        (typeof isDrawingLine !== 'undefined' && isDrawingLine) ||
        (typeof currentImageData !== 'undefined' && currentImageData) ||
        (typeof isCrossLayerMode !== 'undefined' && isCrossLayerMode);
      if (!inDrawingMode) {
        const cx = this.left;
        const cy = this.top;
        const info = collectPointInfo(cx, cy);
        showIntersectionPointInfoModal(info);
      }
    }
    this._hasDragged = false;
  });

  canvas.add(circle);
  canvas.add(text);
  intersectionVisuals.push({ circle, text });
  return circle;
}

// Очищает старые маркеры узлов и пересоздаёт их по текущим endpoints линий.
// Вызывается после simplifyAllLines (там слился узел, маркер должен исчезнуть)
// и в любой другой ситуации, когда геометрия изменилась без вызова splitAllLines.
function rebuildNodeMarkers() {
  clearIntersectionPoints();
  const allLayers = typeof getLayers === 'function' ? getLayers() : [{ id: 'default', visible: true }];
  const targetLayerIds = allLayers
    .filter(l => l.visible !== false)
    .map(l => l.id);
  if (!targetLayerIds.length) targetLayerIds.push('default');

  const nodeMap = new Map();
  getCachedLines().forEach(line => {
    const lid = (line.properties && line.properties.layerId) || 'default';
    if (!targetLayerIds.includes(lid)) return;
    const ep = getLineAbsoluteEndpoints(line);
    [{ x: ep.x1, y: ep.y1 }, { x: ep.x2, y: ep.y2 }].forEach(p => {
      const key = getPointKey(p.x, p.y) + '@' + lid;
      const ex = nodeMap.get(key);
      if (ex) ex.degree++;
      else nodeMap.set(key, { x: p.x, y: p.y, degree: 1, layerId: lid });
    });
  });

  const visualized = new Set();
  let vizIdx = 0;
  const visList = [];
  nodeMap.forEach(node => {
    const visKey = roundTo5(node.x) + '_' + roundTo5(node.y);
    if (visualized.has(visKey)) return;
    visualized.add(visKey);
    const color = node.degree === 1 ? '#3498db' : '#ff4757';
    const data = { x: node.x, y: node.y, degree: node.degree, layerId: node.layerId };
    createIntersectionPoint(node.x, node.y, vizIdx++, data, color);
    visList.push(data);
  });
  intersectionPoints = visList;
  scheduleRender();
}

function clearIntersectionPoints() {
  const objects = canvas.getObjects();
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.id === 'intersection-point' || obj.id === 'intersection-point-label') {
      canvas.remove(obj);
    }
  }
  intersectionPoints = [];
  intersectionVisuals = [];
}

function bringIntersectionPointsToFront() {
  for (let v of intersectionVisuals) {
    v.circle.bringToFront();
    v.text.bringToFront();
  }
}

// Кластеризация близких точек пересечения: заменяет группу точек в пределах
// threshold на одну snap-to-grid точку (центроид). Решает проблему когда
// несколько линий проходят почти через одну точку, но координаты отличаются на 1-5px.
function mergeNearbyIntersections(intersections, threshold) {
  if (!intersections.length) return intersections;
  threshold = threshold || APP_CONFIG.SNAP_RADIUS;

  // Union-Find для кластеризации
  const parent = intersections.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (a, b) => { parent[find(a)] = find(b); };

  for (let i = 0; i < intersections.length; i++) {
    for (let j = i + 1; j < intersections.length; j++) {
      if (Math.hypot(intersections[i].x - intersections[j].x, intersections[i].y - intersections[j].y) <= threshold) {
        union(i, j);
      }
    }
  }

  // Группируем в кластеры
  const clusters = new Map();
  intersections.forEach((pt, i) => {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(pt);
  });

  // Для каждого кластера вычисляем центроид, снаппим к сетке,
  // и обновляем координаты всех пересечений в кластере
  const result = [];
  clusters.forEach(group => {
    if (group.length === 1) {
      result.push(group[0]);
      return;
    }
    const cx = group.reduce((s, p) => s + p.x, 0) / group.length;
    const cy = group.reduce((s, p) => s + p.y, 0) / group.length;
    const snappedX = roundTo5(Math.round(cx / APP_CONFIG.GRID_SIZE) * APP_CONFIG.GRID_SIZE);
    const snappedY = roundTo5(Math.round(cy / APP_CONFIG.GRID_SIZE) * APP_CONFIG.GRID_SIZE);

    for (const pt of group) {
      result.push({ ...pt, x: snappedX, y: snappedY });
    }
  });

  return result;
}

// Собирает сегменты для разделения линий одного слоя по его пересечениям.
// Не меняет canvas — возвращает { linesToRemove, linesToAdd }.
function _collectSplitsForLayer(layerId, intersections) {
  const lines = getCachedLines().filter(l => (l.properties && l.properties.layerId || 'default') === layerId);
  const linesToRemove = [];
  const linesToAdd = [];

  for (let line of lines) {
    const lineEp = getLineAbsoluteEndpoints(line);
    const points = intersections
      .filter(inter => inter.line1 === line || inter.line2 === line)
      .map(inter => ({ x: inter.x, y: inter.y, key: `${inter.x}_${inter.y}` }))
      .filter((p, i, arr) => arr.findIndex(p2 => p2.key === p.key) === i)
      .sort((a, b) => Math.hypot(a.x - lineEp.x1, a.y - lineEp.y1) - Math.hypot(b.x - lineEp.x1, b.y - lineEp.y1));

    if (points.length === 0) continue;

    let currentStart = { x: lineEp.x1, y: lineEp.y1 };
    const segments = [];

    for (let p of points) {
      if (Math.hypot(p.x - currentStart.x, p.y - currentStart.y) < 5) continue;
      const segProps = {};
      if (line.properties) Object.assign(segProps, line.properties);
      segProps.length = Math.hypot(p.x - currentStart.x, p.y - currentStart.y);
      const lineLen = line.properties && line.properties.length ? line.properties.length : 1;
      const proportion = segProps.length / lineLen;
      const passage = line.properties && line.properties.passageLength ? line.properties.passageLength : 0.5;
      const airVol = line.properties && line.properties.airVolume ? line.properties.airVolume : 0;
      segProps.passageLength = roundTo5(passage * proportion);
      segProps.airVolume = roundTo5(airVol * proportion);

      segments.push(new fabric.Line([currentStart.x, currentStart.y, p.x, p.y], {
        stroke: line.stroke, strokeWidth: line.strokeWidth,
        properties: segProps, id: generateLineId()
      }));
      currentStart = p;
    }

    if (Math.hypot(lineEp.x2 - currentStart.x, lineEp.y2 - currentStart.y) > 5) {
      const lastProps = {};
      if (line.properties) Object.assign(lastProps, line.properties);
      lastProps.length = Math.hypot(lineEp.x2 - currentStart.x, lineEp.y2 - currentStart.y);
      const lineLen = line.properties && line.properties.length ? line.properties.length : 1;
      const lastProportion = lastProps.length / lineLen;
      const passage = line.properties && line.properties.passageLength ? line.properties.passageLength : 0.5;
      const airVol = line.properties && line.properties.airVolume ? line.properties.airVolume : 0;
      lastProps.passageLength = roundTo5(passage * lastProportion);
      lastProps.airVolume = roundTo5(airVol * lastProportion);

      segments.push(new fabric.Line([currentStart.x, currentStart.y, lineEp.x2, lineEp.y2], {
        stroke: line.stroke, strokeWidth: line.strokeWidth,
        properties: lastProps, id: generateLineId()
      }));
    }

    if (segments.length > 1) {
      linesToRemove.push(line);
      for (let seg of segments) linesToAdd.push(seg);
    }
  }

  return { linesToRemove, linesToAdd };
}

function splitAllLines() {
  // п.26: разделение должно охватывать все видимые слои в одном вызове,
  // иначе пользователь получает «две схемы вместо одной» — на каждом слое
  // приходится переключать активный слой и нажимать «Разделить» отдельно.
  // Слои остаются физически независимыми (разные горизонты): пересечения
  // ищутся только между линиями одного слоя. Объединение слоёв — через
  // явные cross-layer-точки (см. layersManager.js: addCrossLayerConnection).
  const allLayers = typeof getLayers === 'function' ? getLayers() : [{ id: 'default', visible: true }];
  const targetLayerIds = allLayers
    .filter(l => l.visible !== false)
    .map(l => l.id);
  if (!targetLayerIds.length) targetLayerIds.push('default');

  clearIntersectionPoints();

  // Собираем пересечения и сегменты по каждому слою
  let allLinesToRemove = [];
  let allLinesToAdd = [];

  for (const layerId of targetLayerIds) {
    let layerInters = findAllIntersections(layerId);
    layerInters = mergeNearbyIntersections(layerInters, APP_CONFIG.SNAP_RADIUS);

    const result = _collectSplitsForLayer(layerId, layerInters);
    allLinesToRemove = allLinesToRemove.concat(result.linesToRemove);
    allLinesToAdd = allLinesToAdd.concat(result.linesToAdd);
  }

  // Применяем разделения ДО построения маркеров — чтобы маркеры покрывали
  // финальную геометрию (post-split endpoints включаются автоматически).
  let didSplit = false;
  if (allLinesToRemove.length) {
    saveToUndoStack();
    for (let line of allLinesToRemove) { canvas.remove(line); removeAirVolumeText(line); }
    for (let seg of allLinesToAdd) {
      canvas.add(seg);
      if (typeof applyLayerColorToObject === 'function') applyLayerColorToObject(seg);
      createOrUpdateAirVolumeText(seg);
    }
    invalidateCache();
    didSplit = true;
  }

  // п.4: Маркеры на ВСЕХ узлах (степень ≥ 1), не только на пересечениях.
  // Строим карту узлов из текущих endpoints всех видимых линий, считаем степень,
  // дедуплицируем по 2D-координатам (cross-layer узлы получают один маркер).
  const nodeMap = new Map();
  getCachedLines().forEach(line => {
    const lid = (line.properties && line.properties.layerId) || 'default';
    if (!targetLayerIds.includes(lid)) return;
    const ep = getLineAbsoluteEndpoints(line);
    [{ x: ep.x1, y: ep.y1 }, { x: ep.x2, y: ep.y2 }].forEach(p => {
      const key = getPointKey(p.x, p.y) + '@' + lid;
      const ex = nodeMap.get(key);
      if (ex) ex.degree++;
      else nodeMap.set(key, { x: p.x, y: p.y, degree: 1, layerId: lid });
    });
  });

  const visualized = new Set();
  let vizIdx = 0;
  const visList = [];
  nodeMap.forEach(node => {
    const visKey = roundTo5(node.x) + '_' + roundTo5(node.y);
    if (visualized.has(visKey)) return;
    visualized.add(visKey);
    // Концевые узлы (степень 1) — синие, чтобы визуально отличались от
    // пересечений/разветвлений (красные).
    const color = node.degree === 1 ? '#3498db' : '#ff4757';
    const data = { x: node.x, y: node.y, degree: node.degree, layerId: node.layerId };
    createIntersectionPoint(node.x, node.y, vizIdx++, data, color);
    visList.push(data);
  });
  intersectionPoints = visList;

  if (didSplit) {
    updateConnectionGraph();
    scheduleRender();
    const layersInfo = targetLayerIds.length > 1 ? ` (слоёв: ${targetLayerIds.length})` : '';
    showNotification(`Разделено ${allLinesToRemove.length} линий на ${allLinesToAdd.length} сегментов${layersInfo}`, 'success');
    // После разделения стрелки направлений в новых сегментах не имеют startNode/endNode —
    // показывают «нарисованное» направление, которое часто противоположно потоку.
    // Запускаем расчёт, чтобы стрелки и расходы соответствовали реальной сети (п.25).
    if (typeof calculateAirFlowsSafe === 'function') {
      setTimeout(() => calculateAirFlowsSafe(), 60);
    }
  } else if (vizIdx > 0) {
    scheduleRender();
    showNotification(`Узлов на схеме: ${vizIdx}`, 'info');
  } else {
    showNotification('Нет линий', 'info');
  }
}

function splitLineAtPoint(line, point) {
  const nodeCheck = isPointInLockedNode(point.x, point.y);
  if (nodeCheck && nodeCheck.node.locked) {
    showNotification('Нельзя разделить линию в заблокированном узле!', 'error');
    return null;
  }

  const closest = findClosestPointOnLine(point, line);
  if (closest.distance > 10) return null;

  // Используем округлённые координаты входной точки, а не пересчитанную проекцию,
  // чтобы все линии, сходящиеся в одной точке, имели одинаковые координаты
  var splitX = roundTo5(point.x);
  var splitY = roundTo5(point.y);

  const endpoints = getLineAbsoluteEndpoints(line);
  const distToStart = Math.hypot(splitX - endpoints.x1, splitY - endpoints.y1);
  const distToEnd = Math.hypot(splitX - endpoints.x2, splitY - endpoints.y2);
  // Порог 10 px (был 5) — гарантирует, что после сплита оба сегмента будут
  // минимум ~10 px, а значит не будут «огрызками». Было замечание пользователя:
  // после многократных сплитов в одной зоне появлялись рёбра длиной ~11 px,
  // которые ломали расчёт (дубли-огрызки в графе).
  if (distToStart < 10 || distToEnd < 10) return null;

  const totalLength = Math.hypot(endpoints.x2 - endpoints.x1, endpoints.y2 - endpoints.y1);
  if (totalLength < 20) return null;

  // Защита от создания новых узлов, слишком близких к уже существующим
  // узлам ДРУГИХ линий: если точка сплита в пределах 10 px от endpoint
  // соседней линии — не сплитить. Иначе граф получает два «близких»,
  // но формально разных узла, и солвер не сходится.
  try {
    const _lines = getCachedLines();
    for (let i = 0; i < _lines.length; i++) {
      const other = _lines[i];
      if (!other || other === line) continue;
      const oep = getLineAbsoluteEndpoints(other);
      if (Math.hypot(splitX - oep.x1, splitY - oep.y1) < 10 ||
          Math.hypot(splitX - oep.x2, splitY - oep.y2) < 10) {
        return null;
      }
    }
  } catch (e) { /* консервативно: пропускаем защиту если getCachedLines упал */ }

  normalizeLineProperties(line);
  const props = line.properties || {};
  const proportion1 = distToStart / totalLength;
  const proportion2 = distToEnd / totalLength;

  const props1 = JSON.parse(JSON.stringify(props));
  const props2 = JSON.parse(JSON.stringify(props));

  props1.name = (props.name || 'Линия') + ' (часть 1)';
  props2.name = (props.name || 'Линия') + ' (часть 2)';
  props1.length = distToStart;
  props2.length = distToEnd;
  props1.passageLength = roundTo5((props.passageLength || 0.5) * proportion1);
  props2.passageLength = roundTo5((props.passageLength || 0.5) * proportion2);

  const sourceBoundaryFlow = roundTo5(parseFloat(props.boundaryFlow) || 0);
  props1.boundaryFlow = sourceBoundaryFlow;
  props2.boundaryFlow = 0;
  props1.airVolume = sourceBoundaryFlow;
  props2.airVolume = 0;
  props1.localObjectResistance = 0;
  props2.localObjectResistance = 0;

  if (props.crossSectionalArea && props.roughnessCoefficient) {
    const perim = calculateLinePerimeter(props.crossSectionalArea, props.sectionType || AIR_MODEL_CONFIG.DEFAULT_SECTION);
    props1.airResistance = calculateAirResistance(
      props.roughnessCoefficient,
      perim,
      props1.passageLength,
      props.crossSectionalArea
    );
    props2.airResistance = calculateAirResistance(
      props.roughnessCoefficient,
      perim,
      props2.passageLength,
      props.crossSectionalArea
    );
  }

  const line1 = new fabric.Line([endpoints.x1, endpoints.y1, splitX, splitY], {
    stroke: line.stroke,
    strokeWidth: line.strokeWidth,
    strokeDashArray: line.strokeDashArray,
    fill: false,
    strokeLineCap: 'round',
    hasControls: true,
    hasBorders: true,
    id: generateLineId(),
    properties: props1
  });

  const line2 = new fabric.Line([splitX, splitY, endpoints.x2, endpoints.y2], {
    stroke: line.stroke,
    strokeWidth: line.strokeWidth,
    strokeDashArray: line.strokeDashArray,
    fill: false,
    strokeLineCap: 'round',
    hasControls: true,
    hasBorders: true,
    id: generateLineId(),
    properties: props2
  });

  if (line.lineStartsFromObject && line.startObject) {
    line1.lineStartsFromObject = true;
    line1.startObject = line.startObject;
  }

  return { line1, line2 };
}

// Экспорт функций
window.findAllIntersections = findAllIntersections;
window.mergeNearbyIntersections = mergeNearbyIntersections;
window.collectPointInfo = collectPointInfo;
window.createIntersectionPoint = createIntersectionPoint;
window.clearIntersectionPoints = clearIntersectionPoints;
window.bringIntersectionPointsToFront = bringIntersectionPointsToFront;
window.splitAllLines = splitAllLines;
window.splitLineAtPoint = splitLineAtPoint;
window.rebuildNodeMarkers = rebuildNodeMarkers;

})();
