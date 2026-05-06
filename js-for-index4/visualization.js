(function(global) {

// ─── Настройки подписей на линиях (отображаемые величины и масштаб) ───
// Пользователь может изменять через setLineLabelOptions / toggleLineLabelField.
// Значения по умолчанию: показываем только расход Q, шрифт 12px.
if (!global.lineLabelOptions) {
  global.lineLabelOptions = { showQ: true, showR: false, showV: false, fontSize: 12 };
}

function setLineLabelOptions(patch) {
  Object.assign(global.lineLabelOptions, patch || {});
  if (typeof updateAllAirVolumeTexts === 'function') updateAllAirVolumeTexts();
}

function toggleLineLabelField(field) {
  const opts = global.lineLabelOptions;
  if (!opts || !(field in opts)) return;
  opts[field] = !opts[field];
  if (typeof updateAllAirVolumeTexts === 'function') updateAllAirVolumeTexts();
  const btn = document.getElementById('lineLabel_' + field + 'Btn');
  if (btn) btn.classList.toggle('active', !!opts[field]);
}

function changeLineLabelFontSize(delta) {
  const opts = global.lineLabelOptions;
  if (!opts) return;
  opts.fontSize = Math.max(8, Math.min(28, (opts.fontSize || 12) + delta));
  if (typeof updateAllAirVolumeTexts === 'function') updateAllAirVolumeTexts();
}

function clearSmokeVisualization() {
  getCachedLines().forEach(line => {
    if (line._originalStrokeForSmoke) {
      line.set('stroke', line._originalStrokeForSmoke);
      delete line._originalStrokeForSmoke;
    }
  });
  getCachedImages().forEach(img => {
    if (img._originalShadowForSmoke !== undefined) {
      img.set('shadow', img._originalShadowForSmoke || null);
      delete img._originalShadowForSmoke;
    }
  });
}

function applySmokeVisualization(calculationResult) {
  clearSmokeVisualization();
  if (!calculationResult || !calculationResult.pointMap || !calculationResult.edges) return;
  const pointMap = calculationResult.pointMap;
  const edgeById = new Map(calculationResult.edges.map(edge => [edge.id, edge]));
  const firePoints = [];

  pointMap.forEach(point => {
    const fireObjects = (point.objects || []).filter(obj => isFireObject(obj.object?.properties || obj));
    if (fireObjects.length) firePoints.push({ point, fireObjects });
  });

  firePoints.forEach(({ point, fireObjects }) => {
    const visited = new Set();
    const queue = [getPointKey(point.x, point.y)];

    fireObjects.forEach(({ object }) => {
      object._originalShadowForSmoke = object.shadow || null;
      object.set('shadow', '0 0 15px rgba(231, 76, 60, 0.8)');
    });

    while (queue.length) {
      const nodeId = queue.shift();
      const node = calculationResult.nodes.get(nodeId);
      if (!node) continue;
      for (const edge of node.outEdges) {
        if ((parseFloat(edge.flow) || 0) <= 0 || visited.has(edge.id)) continue;
        visited.add(edge.id);
        // edge.chain не существует в данной модели — красим саму линию ребра
        const smokeLine = edge.line;
        if (smokeLine) {
          if (!smokeLine._originalStrokeForSmoke) smokeLine._originalStrokeForSmoke = smokeLine.stroke;
          smokeLine.set('stroke', '#e74c3c');
        }
        queue.push(edge.to);
      }
    }
  });

  canvas.renderAll();
}

function getAttachedObjectsForChainEnd(edge, pointMap) {
  const endPoint = pointMap.get(edge.to);
  return endPoint ? (endPoint.objects || []) : [];
}

// ==================== ТЕКСТ ОБЪЁМА ВОЗДУХА ====================
function createOrUpdateAirVolumeText(line) {
  if (line.airVolumeText) {
    canvas.remove(line.airVolumeText);
    line.airVolumeText = null;
  }
  if (!line.properties) return;
  if (line.properties.airVolume === undefined) return;

  const endpoints = getLineAbsoluteEndpoints(line);
  const midX = (endpoints.x1 + endpoints.x2) / 2;
  const midY = (endpoints.y1 + endpoints.y2) / 2;

  // Определяем угол отрисовки с учётом реального направления потока.
  // После расчёта в properties.startNode и endNode хранятся ключи узлов
  // в формате "x_y". Сравниваем их с абсолютными координатами концов линии:
  // если расчётное from-направление совпадает с (x2,y2) — линия перевёрнута
  // относительно нарисованного, значит стрелку надо показать в сторону (x1,y1).
  // Угол текста всегда по линии (x1→x2) — текст читается слева направо вдоль линии
  const drawAngle = Math.atan2(endpoints.y2 - endpoints.y1, endpoints.x2 - endpoints.x1) * 180 / Math.PI;

  const offset = 25;
  const offsetX = Math.sin(drawAngle * Math.PI / 180) * offset;
  const offsetY = -Math.cos(drawAngle * Math.PI / 180) * offset;
  const q = parseFloat(line.properties.airVolume) || 0;

  // Текст рисуется вдоль линии (angle = drawAngle), поэтому "→" в тексте
  // после поворота превращается в стрелку вдоль линии (x1→x2).
  // Если поток идёт x2→x1 — нужна "←", после поворота получим противоположное.
  // ВАЖНО: используем ТОЛЬКО →/←, а не ↓/↑ — после поворота на ±90°
  // символы ↓/↑ перерисовываются вбок, что визуально ломает стрелку.
  const p = line.properties || {};
  const startNode = p.startNode || '';
  let directionArrow = '→';
  if (startNode) {
    // ВАЖНО: после airSolver writeFlowResults startNode имеет вид "x_y@layerId",
    // а getPointKey возвращает только "x_y" (без слоя). Срезаем суффикс,
    // иначе сравнение всегда false и стрелка остаётся в направлении РИСОВАНИЯ
    // даже когда поток после расчёта идёт в обратную сторону.
    const startNodeXY = startNode.split('@')[0];
    const k2 = getPointKey(endpoints.x2, endpoints.y2);
    if (startNodeXY === k2) directionArrow = '←';
  }

  // Формирование надписи согласно пользовательским настройкам.
  // Когда включено несколько полей (Q + R + v) — выводим их СТОЛБЦОМ
  // (через \n), а не в строку: иначе текст растягивается вдоль линии и
  // сливается с соседними подписями.
  const opts = global.lineLabelOptions || { showQ: true, showR: false, showV: false, fontSize: 12 };
  const parts = [];
  if (opts.showQ) parts.push(`${directionArrow} ${Math.abs(q).toFixed(3)} м³/с`);
  if (opts.showR) {
    const r = parseFloat(p.totalResistance || p.airResistance || 0);
    if (!isNaN(r)) parts.push(`R=${r.toFixed(3)}`);
  }
  if (opts.showV) {
    const v = parseFloat(p.velocity || 0);
    if (!isNaN(v)) parts.push(`v=${v.toFixed(2)} м/с`);
  }
  if (!parts.length) parts.push(`${directionArrow} ${Math.abs(q).toFixed(3)} м³/с`);
  const labelText = parts.join('\n');

  // п.3: цвет стрелки отражает состояние струи —
  //   свежая (от вентилятора-источника до загрязнителя)  → красный
  //   загрязнённая (после загрязнителя)                   → синий
  // Состояние выставляет applyFlowColoring через line._flowColorState.
  // Для линий без расчёта/без источника — дефолтный цвет из CSS-переменной.
  let textFill = (typeof getCV === 'function' ? getCV('--canvas-text-fill') : '#E8E9F5') || '#E8E9F5';
  if (line._flowColorState === 'fresh') textFill = FLOW_FRESH_COLOR;
  else if (line._flowColorState === 'contaminated') textFill = FLOW_CONTAMINATED_COLOR;

  const text = new fabric.Text(labelText, {
    left: midX + offsetX,
    top: midY + offsetY,
    fontSize: opts.fontSize || 12,
    fontFamily: 'Arial',
    fill: textFill,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 1.1,
    textBackgroundColor: (typeof getCV === 'function' ? getCV('--canvas-text-bg') : 'rgba(18,19,26,0.85)') || 'rgba(18,19,26,0.85)',
    padding: 4,
    selectable: false,
    evented: false,
    originX: 'center',
    originY: 'center',
    angle: drawAngle,
    lockMovementX: true,
    lockMovementY: true,
    id: 'air-volume-text'
  });
  line.airVolumeText = text;
  // Скрыть текст если линия скрыта (слой выключен)
  if (line.visible === false) text.set('visible', false);
  canvas.add(text);
  text.bringToFront();
}

function updateAllAirVolumeTexts() {
  if (updateTextsTimeout) clearTimeout(updateTextsTimeout);
  updateTextsTimeout = setTimeout(() => {
    // ВАЖНО: сначала собираем ВСЕ orphan-тексты с холста и удаляем — иначе
    // после split/reload/auto-recalc остаются дубликаты ("→ 0.000 → 100.000"
    // друг на друге). createOrUpdateAirVolumeText удаляет только по
    // line.airVolumeText reference, который теряется при пересоздании линий.
    const stale = canvas.getObjects().filter(o => o.id === 'air-volume-text');
    if (stale.length) {
      stale.forEach(o => canvas.remove(o));
    }
    // Сбрасываем ссылки на линиях — все тексты будут пересозданы ниже.
    const lines = getCachedLines();
    lines.forEach(l => { if (l.airVolumeText) l.airVolumeText = null; });

    for (let line of lines) {
      if (line.properties && line.properties.airVolume !== undefined) {
        createOrUpdateAirVolumeText(line);
      }
    }
    scheduleRender();
    updateTextsTimeout = null;
  }, 100);
}

function removeAirVolumeText(line) {
  if (line.airVolumeText) {
    canvas.remove(line.airVolumeText);
    line.airVolumeText = null;
  }
}


function updateAllNodeLabels() {
  if (!canvas || !Array.isArray(intersectionVisuals)) return;

  const visuals = intersectionVisuals.filter(v => v && v.circle && v.text);
  visuals.sort((a, b) => {
    const ay = (a.circle.top || 0);
    const by = (b.circle.top || 0);
    if (Math.abs(ay - by) > 8) return ay - by;
    return (a.circle.left || 0) - (b.circle.left || 0);
  });

  visuals.forEach((visual, index) => {
    const circle = visual.circle;
    const text = visual.text;
    // С originX/Y='center' circle.left/top — уже центр круга
    const x = (circle.left || 0);
    const y = (circle.top || 0);

    text.set({ left: x, top: y });
    text.set('text', String(index + 1));
    text.setCoords();

    circle.pointIndex = index;
    if (circle.pointData && typeof circle.pointData === 'object') {
      circle.pointData.index = index + 1;
    }
  });

  bringIntersectionPointsToFront();
  scheduleRender();
}

function visualizeChains() {
  const colors = ['#FF0000', '#00FF00', '#0000FF', '#FF00FF', '#00FFFF', '#FFA500', '#800080', '#008000', '#FFC0CB', '#A52A2A'];
  for (let line of getCachedLines()) {
    line.set('stroke', APP_CONFIG.DEFAULT_LINE_COLOR);
  }
  for (let i = 0; i < lineChains.length; i++) {
    const color = colors[i % colors.length];
    for (let line of lineChains[i].lines) {
      line.set('stroke', color);
    }
  }
  canvas.renderAll();
  showNotification(`Визуализировано ${lineChains.length} цепочек`, 'success');
}

// ── Визуализация запечатанных тупиков ──────────────────────────────────────
// Рисует маркеры на запечатанных узлах (красный квадрат = глухой тупик).
function updateSealedNodeVisuals() {
  // Удаляем старые маркеры
  var objects = canvas.getObjects();
  for (var i = objects.length - 1; i >= 0; i--) {
    if (objects[i].id === 'sealed-node-marker') {
      canvas.remove(objects[i]);
    }
  }
  if (!window.sealedNodes || !window.sealedNodes.size) {
    canvas.renderAll();
    return;
  }
  // Собираем координаты тупиков
  var lines = getCachedLines();
  var _ck = typeof getCalcNodeKey === 'function' ? getCalcNodeKey : getPointKey;
  var nodeCoords = {};
  lines.forEach(function(line) {
    var ep = getLineAbsoluteEndpoints(line);
    var lid = (line.properties && line.properties.layerId) || 'default';
    var k1 = _ck(ep.x1, ep.y1, lid);
    var k2 = _ck(ep.x2, ep.y2, lid);
    nodeCoords[k1] = { x: roundTo5(ep.x1), y: roundTo5(ep.y1) };
    nodeCoords[k2] = { x: roundTo5(ep.x2), y: roundTo5(ep.y2) };
  });

  window.sealedNodes.forEach(function(key) {
    var c = nodeCoords[key];
    if (!c) return;
    var size = 8;
    // Красный квадрат с крестиком — «запечатан»
    var rect = new fabric.Rect({
      left: c.x - size / 2, top: c.y - size / 2,
      width: size, height: size,
      fill: '#ff4444', stroke: '#cc0000', strokeWidth: 1.5,
      selectable: false, evented: false,
      id: 'sealed-node-marker'
    });
    canvas.add(rect);
  });
  canvas.renderAll();
}

// ═══ РАСКРАСКА СТРУИ: свежая (красная) / исходящая загрязнённая (синяя) ═══
// Замечания #15-16:
//   #15: Раскрасить линии — свежая струя = красная, исходящая = синяя.
//   #16: Правило изменения цвета — распространение признака по графу от
//        объекта-загрязнителя (пожар, любой объект с isContaminant=true).
//
// Алгоритм (BFS по расчётному графу из getLastCalculationResult):
//   1. Источники = узлы с вентилятором-источником (isFlowSource !== false).
//   2. BFS по исходящим рёбрам с flow > 0.
//   3. Состояние потока: 'fresh' от источника до первого загрязнителя,
//      далее 'contaminated' до конца цепи.
//   4. Загрязнитель обнаруживается:
//      - на УЗЛЕ — через node.objects;
//      - на РЕБРЕ — через edge.lineObjects (объект привязан к линии).
//   5. Если ребро достижимо несколькими путями — состояние объединяется по
//      правилу "contaminated побеждает fresh".
//
// НЕ модифицирует airSolver.js — читает готовый результат через
// getLastCalculationResult(). Сохраняет оригинальный stroke в отдельном
// поле _originalStrokeForFlow, чтобы не конфликтовать со smoke-визуализацией.

var FLOW_FRESH_COLOR = '#e74c3c';          // красный — свежая струя
var FLOW_CONTAMINATED_COLOR = '#3498db';   // синий — загрязнённая
// п.26: раскраска струи включена по умолчанию — пользователь раньше не находил
// кнопку «Струя» и не понимал, что функция вообще есть. После первого расчёта
// схема автоматически окрашивается; кнопкой можно выключить.
if (typeof global.flowColoringEnabled === 'undefined') global.flowColoringEnabled = true;

function clearFlowColoring() {
  var restored = 0;
  getCachedLines().forEach(function(line) {
    if (line._originalStrokeForFlow !== undefined) {
      line.set('stroke', line._originalStrokeForFlow);
      delete line._originalStrokeForFlow;
      restored++;
    }
    // п.3: сбрасываем цвет стрелки тоже — иначе текст останется красным/синим
    if (line._flowColorState !== undefined) {
      delete line._flowColorState;
    }
  });
  if (restored) {
    if (typeof updateAllAirVolumeTexts === 'function') updateAllAirVolumeTexts();
    canvas.renderAll();
  }
  return restored;
}

function _nodeHasContaminant(nodeOrPoint) {
  if (!nodeOrPoint) return false;
  var arr = nodeOrPoint.objects || [];
  for (var i = 0; i < arr.length; i++) {
    var o = arr[i];
    var p = (o && o.object && o.object.properties) ? o.object.properties : o;
    if (typeof isContaminantObject === 'function' && isContaminantObject(p)) return true;
  }
  return false;
}

function _edgeHasContaminant(edge) {
  if (!edge) return false;
  // airSolver: edge.lineObjects — массив объектов, привязанных к линии
  var arr = edge.lineObjects || [];
  for (var i = 0; i < arr.length; i++) {
    var o = arr[i];
    var p = (o && o.object && o.object.properties) ? o.object.properties : o;
    if (typeof isContaminantObject === 'function' && isContaminantObject(p)) return true;
  }
  return false;
}

function applyFlowColoring(calculationResult) {
  // Очищаем прошлую раскраску и конкурирующую smoke-визуализацию
  clearFlowColoring();
  if (typeof clearSmokeVisualization === 'function') clearSmokeVisualization();

  var result = calculationResult ||
               (typeof getLastCalculationResult === 'function' ? getLastCalculationResult() : null);
  if (!result || !result.nodes || !result.edges) {
    if (typeof showNotification === 'function') {
      showNotification('Нет данных расчёта. Сначала запустите «Расчёт воздуха»', 'info');
    }
    return { painted: 0, fresh: 0, contaminated: 0 };
  }

  var nodes = result.nodes;
  var edges = result.edges;
  var pointMap = result.pointMap || new Map();

  // 1) Находим узлы-источники: там стоят вентиляторы с isFlowSource !== false
  var sourceKeys = [];
  if (typeof nodes.forEach === 'function') {
    nodes.forEach(function(node, key) {
      var hasSourceFan = (node.objects || []).some(function(o) {
        var p = (o && o.object && o.object.properties) ? o.object.properties : o;
        return p && (p.type || '').toLowerCase() === 'fan' && p.isFlowSource !== false;
      });
      if (hasSourceFan) sourceKeys.push(key);
    });
  }

  // Если источников нет — ничего не красим (но не ошибка — просто нечего красить)
  if (!sourceKeys.length) {
    return { painted: 0, fresh: 0, contaminated: 0 };
  }

  // 2) BFS: edgeState: Map<edgeId, 'fresh'|'contaminated'>
  // Правило слияния: contaminated побеждает fresh
  var edgeState = new Map();

  function promote(edgeId, state) {
    var prev = edgeState.get(edgeId);
    if (prev === 'contaminated') return; // уже худшее
    if (prev === 'fresh' && state === 'contaminated') {
      edgeState.set(edgeId, 'contaminated');
      return;
    }
    if (!prev) edgeState.set(edgeId, state);
  }

  sourceKeys.forEach(function(srcKey) {
    // queue элементы: { nodeKey, contaminated }
    var queue = [{ nodeKey: srcKey, contaminated: false }];
    // visited — пара (nodeKey, contaminated), чтобы допустить обход узла
    // повторно с ухудшенным состоянием
    var visited = new Set();

    while (queue.length) {
      var cur = queue.shift();
      var sig = cur.nodeKey + '|' + (cur.contaminated ? '1' : '0');
      if (visited.has(sig)) continue;
      visited.add(sig);

      var node = nodes.get(cur.nodeKey);
      if (!node) continue;

      // Проверка загрязнителя на узле: если есть — статус "загрязнено"
      // применяется к исходящим рёбрам (не к рёбрам, по которым мы пришли)
      var nodeContaminated = cur.contaminated || _nodeHasContaminant(node);

      var outs = node.outEdges || [];
      for (var i = 0; i < outs.length; i++) {
        var edge = outs[i];
        var q = parseFloat(edge.flow) || 0;
        if (q <= 0) continue;

        // Если на САМОМ ребре висит загрязнитель — тоже ухудшение
        var edgeContaminated = nodeContaminated || _edgeHasContaminant(edge);
        var state = edgeContaminated ? 'contaminated' : 'fresh';
        promote(edge.id, state);

        queue.push({ nodeKey: edge.to, contaminated: edgeContaminated });
      }
    }
  });

  // 3) Применяем цвета к линиям
  var freshCount = 0;
  var contaminatedCount = 0;
  var byId = new Map(edges.map(function(e) { return [e.id, e]; }));
  edgeState.forEach(function(state, edgeId) {
    var edge = byId.get(edgeId);
    if (!edge || !edge.line) return;
    var line = edge.line;
    if (line._originalStrokeForFlow === undefined) {
      line._originalStrokeForFlow = line.stroke;
    }
    if (state === 'fresh') {
      line.set('stroke', FLOW_FRESH_COLOR);
      line._flowColorState = 'fresh';
      freshCount++;
    } else {
      line.set('stroke', FLOW_CONTAMINATED_COLOR);
      line._flowColorState = 'contaminated';
      contaminatedCount++;
    }
  });

  // п.3: после смены состояния перерисовываем тексты, чтобы цвет стрелки
  // соответствовал состоянию линии (свежая красная / загрязнённая синяя).
  if (typeof updateAllAirVolumeTexts === 'function') updateAllAirVolumeTexts();
  canvas.renderAll();
  return { painted: edgeState.size, fresh: freshCount, contaminated: contaminatedCount };
}

function toggleFlowColoring() {
  global.flowColoringEnabled = !global.flowColoringEnabled;
  var btn = document.getElementById('flowColoringBtn');
  if (btn) btn.classList.toggle('active', !!global.flowColoringEnabled);

  if (!global.flowColoringEnabled) {
    clearFlowColoring();
    if (typeof showNotification === 'function') showNotification('Раскраска струи выключена', 'info');
    return;
  }

  var res = applyFlowColoring();
  if (typeof showNotification === 'function') {
    if (!res.painted) {
      showNotification('Раскраска включена, но красить нечего: нет источников или нет расчёта', 'warning');
    } else {
      showNotification('Струя: свежих ' + res.fresh + ', загрязнённых ' + res.contaminated, 'success');
    }
  }
}

// ─── Проверка связей: подсветить висящие концы линий ──────────────────────
// Висящий конец — это точка, к которой подключена ровно одна линия и нет
// ни вентилятора/атмосферы, ни запечатанного тупика. Такие точки подсвечиваются
// жёлтым кругом. Повторный вызов очищает подсветку.
function clearDanglingMarkers() {
  var objs = canvas.getObjects();
  for (var i = objs.length - 1; i >= 0; i--) {
    if (objs[i].id === 'dangling-marker') canvas.remove(objs[i]);
  }
}

function checkDanglingConnections() {
  // Toggle: повторный клик при уже подсвеченных маркерах — просто снимает подсветку
  var existing = canvas.getObjects().filter(function(o) { return o.id === 'dangling-marker'; });
  if (existing.length) {
    clearDanglingMarkers();
    var btn = document.getElementById('checkConnectionsBtn');
    if (btn) btn.classList.remove('active');
    canvas.renderAll();
    if (typeof showNotification === 'function') showNotification('Подсветка висящих концов снята', 'info');
    return;
  }

  clearDanglingMarkers();
  var lines = getCachedLines().filter(function(l) { return l.visible !== false; });
  if (!lines.length) {
    if (typeof showNotification === 'function') showNotification('Нет линий для проверки', 'info');
    canvas.renderAll();
    return;
  }

  // endpoint count по ключу
  var counts = new Map();
  var coords = new Map();
  lines.forEach(function(line) {
    var ep = getLineAbsoluteEndpoints(line);
    var k1 = getPointKey(ep.x1, ep.y1);
    var k2 = getPointKey(ep.x2, ep.y2);
    counts.set(k1, (counts.get(k1) || 0) + 1);
    counts.set(k2, (counts.get(k2) || 0) + 1);
    if (!coords.has(k1)) coords.set(k1, { x: ep.x1, y: ep.y1 });
    if (!coords.has(k2)) coords.set(k2, { x: ep.x2, y: ep.y2 });
  });

  // Исключаем точки, к которым привязан вентилятор или атмосфера (это легитимные концы)
  var images = (typeof getCachedImages === 'function') ? getCachedImages().filter(function(i) { return i.visible !== false; }) : [];
  var attachedKeys = new Set();
  images.forEach(function(img) {
    var p = img.properties || {};
    if (p.type !== 'fan' && p.type !== 'atmosphere') return;
    var c = getObjectCenter(img);
    var best = null, bestD = Infinity;
    coords.forEach(function(pt, key) {
      var d = Math.hypot(pt.x - c.x, pt.y - c.y);
      if (d < bestD) { bestD = d; best = key; }
    });
    if (best && bestD < 30) attachedKeys.add(best);
  });

  var sealed = (window.sealedNodes instanceof Set) ? window.sealedNodes : new Set();

  var dangling = [];
  counts.forEach(function(cnt, key) {
    if (cnt !== 1) return;
    if (attachedKeys.has(key)) return;
    if (sealed.has(key)) return;
    var c = coords.get(key);
    if (c) dangling.push(c);
  });

  if (!dangling.length) {
    if (typeof showNotification === 'function') showNotification('Висящих концов не найдено — все линии связаны', 'success');
    canvas.renderAll();
    return;
  }

  dangling.forEach(function(c) {
    var mark = new fabric.Circle({
      left: c.x - 12, top: c.y - 12,
      radius: 12,
      fill: 'rgba(255, 215, 0, 0.25)',
      stroke: '#ffcc00',
      strokeWidth: 2,
      selectable: false,
      evented: false,
      id: 'dangling-marker'
    });
    canvas.add(mark);
    mark.bringToFront();
  });

  var btn = document.getElementById('checkConnectionsBtn');
  if (btn) btn.classList.add('active');

  canvas.renderAll();
  if (typeof showNotification === 'function') {
    showNotification('Висящих концов: ' + dangling.length + ' (жёлтые круги). Нажмите ещё раз, чтобы убрать подсветку.', 'warning');
  }
}

// ═══ п.11: Жёлтая подсветка линии/узла привязки выбранного объекта ════════
// При выделении объекта (вентилятор/клапан/атмосфера и т.п.) подсвечиваем
// элемент сети, к которому он привяжется в расчёте: ближайший узел (≤18 px)
// или ближайшую линию (≤35 px). Это совпадает с логикой
// collectNetworkAttachmentInfo в networkBuilder.js (фактическая привязка).
var _attachHighlightedLine = null;
var _attachHighlightedNodeMarker = null;

function clearAttachmentHighlight() {
  if (_attachHighlightedNodeMarker) {
    if (canvas) canvas.remove(_attachHighlightedNodeMarker);
    _attachHighlightedNodeMarker = null;
  }
  if (_attachHighlightedLine) {
    if (typeof _attachHighlightedLine._origStrokeForAttachment === 'string') {
      _attachHighlightedLine.set('stroke', _attachHighlightedLine._origStrokeForAttachment);
    }
    delete _attachHighlightedLine._origStrokeForAttachment;
    _attachHighlightedLine = null;
  }
  if (canvas) canvas.requestRenderAll();
}

function highlightAttachmentForObject(obj) {
  clearAttachmentHighlight();
  if (!obj || obj.type !== 'image') return;
  if (typeof getObjectCenter !== 'function' || typeof getCachedLines !== 'function') return;
  var c = getObjectCenter(obj);
  var lid = (obj.properties && obj.properties.layerId) || 'default';
  // Фильтруем по слою — привязка на чужом слое не имеет смысла
  var lines = getCachedLines().filter(function(l) {
    return ((l.properties && l.properties.layerId) || 'default') === lid;
  });

  // 1) Узел в радиусе 18 px (приоритет: вентилятор/атмосфера крепится к узлу)
  var bestNode = null, bestNodeDist = 18;
  lines.forEach(function(line) {
    if (typeof getLineAbsoluteEndpoints !== 'function') return;
    var ep = getLineAbsoluteEndpoints(line);
    [{ x: ep.x1, y: ep.y1 }, { x: ep.x2, y: ep.y2 }].forEach(function(p) {
      var d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < bestNodeDist) { bestNodeDist = d; bestNode = p; }
    });
  });
  if (bestNode) {
    _attachHighlightedNodeMarker = new fabric.Circle({
      left: bestNode.x, top: bestNode.y,
      originX: 'center', originY: 'center',
      radius: 14, fill: 'transparent',
      stroke: '#f1c40f', strokeWidth: 3,
      selectable: false, evented: false,
      id: 'attachment-highlight'
    });
    canvas.add(_attachHighlightedNodeMarker);
    _attachHighlightedNodeMarker.bringToFront();
    canvas.requestRenderAll();
    return;
  }

  // 2) Линия в радиусе 35 px (объект на ребре)
  if (typeof findLinesInArea !== 'function') return;
  var hits = findLinesInArea(c.x, c.y, 35).filter(function(h) {
    return ((h.line.properties && h.line.properties.layerId) || 'default') === lid;
  });
  if (hits.length) {
    var target = hits[0].line;
    target._origStrokeForAttachment = target.stroke;
    target.set('stroke', '#f1c40f');
    _attachHighlightedLine = target;
    canvas.requestRenderAll();
  }
}

// Export all functions to global scope
global.highlightAttachmentForObject = highlightAttachmentForObject;
global.clearAttachmentHighlight = clearAttachmentHighlight;
global.clearSmokeVisualization = clearSmokeVisualization;
global.applySmokeVisualization = applySmokeVisualization;
global.getAttachedObjectsForChainEnd = getAttachedObjectsForChainEnd;
global.createOrUpdateAirVolumeText = createOrUpdateAirVolumeText;
global.updateAllAirVolumeTexts = updateAllAirVolumeTexts;
global.removeAirVolumeText = removeAirVolumeText;
global.updateAllNodeLabels = updateAllNodeLabels;
global.visualizeChains = visualizeChains;
global.updateSealedNodeVisuals = updateSealedNodeVisuals;
global.setLineLabelOptions = setLineLabelOptions;
global.toggleLineLabelField = toggleLineLabelField;
global.changeLineLabelFontSize = changeLineLabelFontSize;
global.checkDanglingConnections = checkDanglingConnections;
global.clearDanglingMarkers = clearDanglingMarkers;
global.applyFlowColoring = applyFlowColoring;
global.clearFlowColoring = clearFlowColoring;
global.toggleFlowColoring = toggleFlowColoring;

})(window);
