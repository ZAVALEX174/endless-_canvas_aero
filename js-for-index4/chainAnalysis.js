(function(global) {

// Построить карту ключ-узла → порядковый номер из intersectionVisuals
// (номера совпадают с теми, что отображаются на холсте после splitAllLines).
function buildNodeKeyToIndexMap() {
  const map = new Map();
  try {
    const visuals = (typeof intersectionVisuals !== 'undefined' && Array.isArray(intersectionVisuals)) ? intersectionVisuals : [];
    visuals.forEach((v, i) => {
      if (!v || !v.circle) return;
      const r = v.circle.radius || 6;
      const cx = (v.circle.left || 0) + r;
      const cy = (v.circle.top || 0) + r;
      const key = getPointKey(cx, cy);
      // pointIndex на круге обновляется в updateAllNodeLabels
      const idx = (typeof v.circle.pointIndex === 'number' ? v.circle.pointIndex : i) + 1;
      map.set(key, idx);
    });
  } catch (e) { /* ignore */ }
  return map;
}

function getExportRows() {
  const nodeIdx = buildNodeKeyToIndexMap();
  return getCachedLines().map(line => {
    normalizeLineProperties(line);
    const p = line.properties || {};
    // Ключи узлов: после расчёта — из p.startNode/p.endNode (ориентированные),
    // иначе — из геометрических концов линии.
    let startKey = p.startNode || '';
    let endKey = p.endNode || '';
    if (!startKey || !endKey) {
      const ep = getLineAbsoluteEndpoints(line);
      if (!startKey) startKey = getPointKey(ep.x1, ep.y1);
      if (!endKey) endKey = getPointKey(ep.x2, ep.y2);
    }
    const startNodeNumber = nodeIdx.get(startKey) || '';
    const endNodeNumber = nodeIdx.get(endKey) || '';
    return {
      id: line.id || '',
      name: p.name || 'Без названия',
      length: roundTo5(parseFloat(p.passageLength) || 0),
      area: roundTo5(parseFloat(p.crossSectionalArea) || 0),
      sectionType: p.sectionType || AIR_MODEL_CONFIG.DEFAULT_SECTION,
      supportType: p.supportType || AIR_MODEL_CONFIG.DEFAULT_SUPPORT,
      alpha: roundTo5(parseFloat(p.roughnessCoefficient) || 0),
      perimeter: roundTo5(parseFloat(p.perimeter) || 0),
      resistance: roundTo5(parseFloat(p.airResistance) || 0),
      objectResistance: roundTo5(parseFloat(p.localObjectResistance) || 0),
      totalResistance: roundTo5(parseFloat(p.totalResistance) || 0),
      flow: roundTo5(parseFloat(p.airVolume) || 0),
      velocity: roundTo5(parseFloat(p.velocity) || 0),
      depression: roundTo5(parseFloat(p.depression) || 0),
      attachedObjects: p.attachedObjects || '',
      startNodeKey: startKey,
      endNodeKey: endKey,
      startNodeNumber,
      endNodeNumber
    };
  });
}

// ==================== АНАЛИЗ УЗЛОВ ====================
function analyzeNetworkNodes(showModal = false) {
  const { nodes } = buildNetworkGraph({ includeObjects: true });
  let report = '';

  nodes.forEach(node => {
    const incoming = node.incomingEdges.length;
    const outgoing = node.outgoingEdges.length;
    const objNames = [];
    for (let obj of node.objects) {
      const name = obj.object.properties && obj.object.properties.name ? obj.object.properties.name : 'Объект';
      objNames.push(name);
    }
    const namesStr = objNames.length ? objNames.join(', ') : 'нет';
    console.log(`Узел (${node.x.toFixed(1)}, ${node.y.toFixed(1)}): вх=${incoming}, исх=${outgoing}, объекты=${namesStr}`);
    report += `\n📍 (${node.x.toFixed(1)}, ${node.y.toFixed(1)})\n  Входящих: ${incoming}, Исходящих: ${outgoing}\n  Объекты: ${namesStr}\n`;
  });

  if (showModal) {
    createModal('nodeAnalysisModal', 'Анализ узлов', `<pre>${escapeHtml(report)}</pre>`);
  }
  return report;
}

function calculateChainResistanceAndFlow(chain) {
  let totalResistance = 0;
  const flowValues = [];

  for (let line of chain.lines) {
    const r = line.properties && line.properties.airResistance ? line.properties.airResistance : 1;
    totalResistance += r;
    flowValues.push(line.properties && line.properties.airVolume ? line.properties.airVolume : 0);
  }

  const { nodes } = buildNetworkGraph({ includeObjects: true });
  const nodeSet = new Set();
  for (let line of chain.lines) {
    nodeSet.add(`${roundTo5(line.x1)}_${roundTo5(line.y1)}`);
    nodeSet.add(`${roundTo5(line.x2)}_${roundTo5(line.y2)}`);
  }
  for (let key of nodeSet) {
    const node = nodes.get(key);
    if (node) {
      for (let obj of node.objects) {
        totalResistance += obj.airResistance || 0;
      }
    }
  }

  const nonZero = flowValues.filter(v => v > 0);
  const flow = nonZero.length ? nonZero[0] : 0;
  const consistent = nonZero.every(v => Math.abs(v - flow) < 0.001);

  return {
    totalResistance: roundTo5(totalResistance),
    flow,
    flowValues,
    flowConsistent: consistent,
    startNode: chain.startNode,
    endNode: chain.endNode,
    hasObjectAtStart: chain.hasObjectAtStart,
    hasObjectAtEnd: chain.hasObjectAtEnd
  };
}

function showChainSummary(chain) {
  const data = calculateChainResistanceAndFlow(chain);
  const html = `
    <h4>Цепочка ${chain.id}</h4>
    <p>Линий: ${chain.lines.length}</p>
    <p>Суммарное сопротивление: ${data.totalResistance.toFixed(5)}</p>
    <p>Поток: ${data.flow.toFixed(5)} м³/с ${data.flowConsistent ? '' : '(⚠️ значения различаются)'}</p>
    <p>Начало: (${data.startNode.x.toFixed(1)}, ${data.startNode.y.toFixed(1)}) ${data.hasObjectAtStart ? '✅' : ''}</p>
    <p>Конец: (${data.endNode.x.toFixed(1)}, ${data.endNode.y.toFixed(1)}) ${data.hasObjectAtEnd ? '✅' : ''}</p>
  `;
  createModal('chainSummaryModal', 'Анализ цепочки', html);
}

function showAllChainsSummary() {
  if (!lineChains.length) {
    showNotification('Сначала постройте цепочки', 'warning');
    return;
  }
  let html = '<h4>Сводка по всем цепочкам</h4>';
  for (let i = 0; i < lineChains.length; i++) {
    const data = calculateChainResistanceAndFlow(lineChains[i]);
    html += `
      <div style="border:1px solid #ccc; margin:10px 0; padding:10px;">
        <h5>Цепочка ${i + 1}</h5>
        <p>Линий: ${lineChains[i].lines.length}</p>
        <p>Сопротивление: ${data.totalResistance.toFixed(3)}</p>
        <p>Поток: ${data.flow.toFixed(3)}</p>
      </div>
    `;
  }
  createModal('allChainsModal', 'Все цепочки', html);
}

function analyzeSelectedChain() {
  const active = canvas.getActiveObject();
  if (!active || active.type !== 'line') {
    showNotification('Выберите линию', 'error');
    return;
  }
  if (!lineToChainMap.size) buildLineToChainMap();
  const chain = lineToChainMap.get(active.id);
  if (!chain) {
    showNotification('Линия не принадлежит цепочке', 'error');
    return;
  }
  showChainSummary(chain);
}

function showAirVolumeReport() {
  const rows = getExportRows();
  let html = '<div class="property-group">';
  if (lastCalculationResult) {
    html += `<p><strong>Подача:</strong> ${formatTo5(lastCalculationResult.totalSourceFlow || 0)} м³/с</p>`;
    html += `<p><strong>Общешахтная депрессия Hсети:</strong> ${formatTo5(lastCalculationResult.networkDepressionPa || 0)} Па</p>`;
    html += `<p><strong>Естественная тяга He:</strong> ${formatTo5(lastCalculationResult.naturalDraftPa || 0)} Па</p>`;
    html += `<p><strong>Требуемый напор вентилятора:</strong> ${formatTo5(lastCalculationResult.requiredFanPressurePa || 0)} Па</p>`;
  }
  html += '<h5>Ветви</h5>';
  html += '<div style="overflow:auto;"><table style="width:100%; border-collapse:collapse; font-size:12px;">';
  html += '<tr><th>Название</th><th>L</th><th>S</th><th>R</th><th>Robj</th><th>Rполн</th><th>Q</th><th>v</th><th>h</th></tr>';
  rows.forEach(row => {
    html += `<tr><td>${escapeHtml(row.name)}</td><td>${formatTo5(row.length)}</td><td>${formatTo5(row.area)}</td><td>${formatTo5(row.resistance)}</td><td>${formatTo5(row.objectResistance)}</td><td>${formatTo5(row.totalResistance)}</td><td>${formatTo5(row.flow)}</td><td>${formatTo5(row.velocity)}</td><td>${formatTo5(row.depression)}</td></tr>`;
  });
  html += '</table></div></div>';
  createModal('airVolumeReportModal', 'Отчёт по воздуху', html, [
    {
      text: 'Экспорт CSV',
      class: 'btn-primary',
      onClick: 'exportAirVolumeReportToCSV()'
    }
  ]);
}

// ── Журнал уведомлений ────────────────────────────────────────────────
// Показывает полную историю показанных уведомлений с timestamp и типом.
// Пользователь явно попросил, чтобы оповещения не скрывались автоматом —
// здесь можно посмотреть всё, что когда-либо появлялось, даже после ×.
function showNotificationLogModal() {
  // Пересоздаём модалку с нуля — иначе createModal обновляет только body,
  // а footer с кнопками остаётся старым (с устаревшим списком).
  const oldModal = document.getElementById('notificationLogModal');
  if (oldModal) oldModal.remove();

  const log = (typeof getNotificationLog === 'function' ? getNotificationLog() : (window.notificationLog || []));
  const sorted = log.slice().reverse(); // свежие сверху
  const fmtTs = (ts) => {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const typeColor = {
    success: 'var(--color-airflow,#2ecc71)',
    error:   'var(--color-fire,#e74c3c)',
    info:    'var(--color-accent,#4f9aff)',
    warning: 'var(--color-fan,#f0a500)'
  };
  let html = '<div class="property-group">';
  html += `<p style="margin:0 0 8px 0; font-size:12px; color:var(--color-text-secondary,#888);">Всего записей: ${log.length}. Свежие сверху. Журнал не очищается автоматически — нажмите «Очистить журнал», когда хотите начать с чистого листа.</p>`;
  if (!log.length) {
    html += '<p style="color:var(--color-text-secondary,#888); font-style:italic;">Журнал пуст.</p>';
  } else {
    html += '<div style="max-height:60vh; overflow:auto;">';
    html += '<table style="width:100%; border-collapse:collapse; font-size:12px;">';
    html += '<tr><th style="text-align:left; padding:4px 8px; border-bottom:1px solid var(--color-border,#333);">Время</th>';
    html += '<th style="text-align:left; padding:4px 8px; border-bottom:1px solid var(--color-border,#333);">Тип</th>';
    html += '<th style="text-align:left; padding:4px 8px; border-bottom:1px solid var(--color-border,#333);">Сообщение</th></tr>';
    sorted.forEach(entry => {
      const c = typeColor[entry.type] || typeColor.info;
      html += `<tr>`;
      html += `<td style="padding:4px 8px; vertical-align:top; white-space:nowrap; color:var(--color-text-secondary,#888);">${escapeHtml(fmtTs(entry.ts))}</td>`;
      html += `<td style="padding:4px 8px; vertical-align:top;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${c}; margin-right:6px;"></span>${escapeHtml(entry.type)}</td>`;
      html += `<td style="padding:4px 8px;">${escapeHtml(entry.msg)}</td>`;
      html += `</tr>`;
    });
    html += '</table></div>';
  }
  html += '</div>';
  // ВАЖНО: createModal помещает onClick прямо в атрибут onclick="…" с двойными
  // кавычками снаружи. Внутри строки используем ТОЛЬКО одинарные кавычки —
  // двойные ломают HTML-парсинг атрибута и кнопки молча перестают работать.
  createModal('notificationLogModal', 'Журнал уведомлений', html, [
    {
      text: 'Очистить журнал',
      class: 'btn-danger',
      onClick: "clearNotificationLog(); document.getElementById('notificationLogModal').style.display='none'; showNotification('Журнал очищен', 'info');"
    },
    {
      text: 'Закрыть все на экране',
      class: 'btn-secondary',
      onClick: "dismissAllNotifications(); document.getElementById('notificationLogModal').style.display='none';"
    }
  ]);
}

// Найти кандидатов для объединения в одном слое:
// промежуточные узлы степени 2, без объектов, с коллинеарными сегментами
// и совпадающими гидравлическими свойствами.
function _findMergeCandidates(layerId) {
  const lines = getCachedLines().filter(l =>
    (l.properties && l.properties.layerId || 'default') === layerId
  );
  const images = getCachedImages().filter(i =>
    (i.properties && i.properties.layerId || 'default') === layerId
  );

  // Карта nodeKey → массив { line, end: 'start'|'end', ep }
  const nodeMap = new Map();
  lines.forEach(line => {
    const ep = getLineAbsoluteEndpoints(line);
    const k1 = getPointKey(ep.x1, ep.y1);
    const k2 = getPointKey(ep.x2, ep.y2);
    if (!nodeMap.has(k1)) nodeMap.set(k1, []);
    if (!nodeMap.has(k2)) nodeMap.set(k2, []);
    nodeMap.get(k1).push({ line, end: 'start', ep, x: ep.x1, y: ep.y1 });
    nodeMap.get(k2).push({ line, end: 'end', ep, x: ep.x2, y: ep.y2 });
  });

  const candidates = [];
  nodeMap.forEach((items, key) => {
    if (items.length !== 2) return;
    const px = items[0].x, py = items[0].y;

    // На узле не должно быть объекта (вентилятор/клапан/атмосфера и т.п.)
    const hasObject = images.some(img => {
      const c = getObjectCenter(img);
      return Math.hypot(c.x - px, c.y - py) < 18;
    });
    if (hasObject) return;

    // ВНИМАНИЕ: проверка isPointInLockedNode УДАЛЕНА.
    // Раньше она блокировала simplify во всех проходных узлах сети,
    // т.к. nodeLockEnabled=true глобально помечает узлы степени ≥ 2 как
    // locked (защита от случайного удаления). Но «Упростить» — намеренное
    // действие пользователя, и проходной узел при объединении ПРОПАДАЕТ
    // (две линии становятся одной), а не «удаляется содержимое». Защита
    // от удаления тут не нужна.

    const [a, b] = items;
    // Внешние концы сегментов (противоположные узлу)
    const aOuter = a.end === 'start'
      ? { x: a.ep.x2, y: a.ep.y2 }
      : { x: a.ep.x1, y: a.ep.y1 };
    const bOuter = b.end === 'start'
      ? { x: b.ep.x2, y: b.ep.y2 }
      : { x: b.ep.x1, y: b.ep.y1 };
    const aDx = aOuter.x - px, aDy = aOuter.y - py;
    const bDx = bOuter.x - px, bDy = bOuter.y - py;
    const aLen = Math.hypot(aDx, aDy);
    const bLen = Math.hypot(bDx, bDy);
    if (aLen < 1 || bLen < 1) return;
    // Сегменты должны смотреть в противоположные стороны от узла:
    // косинус угла между направлениями из узла наружу ≈ -1.
    // Допуск ~3.6° (cos > -0.998 — отклоняем).
    const cos = (aDx * bDx + aDy * bDy) / (aLen * bLen);
    if (cos > -0.998) return;

    // Гидравлические свойства должны совпадать — иначе объединение исказит расчёт
    const pa = a.line.properties || {};
    const pb = b.line.properties || {};
    const eq = (x, y) => (parseFloat(x) || 0) === (parseFloat(y) || 0);
    if (!eq(pa.crossSectionalArea, pb.crossSectionalArea)) return;
    if (!eq(pa.roughnessCoefficient, pb.roughnessCoefficient)) return;
    if ((pa.sectionType || '') !== (pb.sectionType || '')) return;
    if ((pa.supportType || '') !== (pb.supportType || '')) return;

    candidates.push({
      lineA: a.line, lineB: b.line,
      outerA: aOuter, outerB: bOuter,
      nodeX: px, nodeY: py,
      layerId
    });
  });

  return candidates;
}

function _mergeTwoSegments(c) {
  const pa = c.lineA.properties || {};
  const newLength = Math.hypot(c.outerA.x - c.outerB.x, c.outerA.y - c.outerB.y);
  const passA = parseFloat(pa.passageLength) || 0;
  const passB = parseFloat((c.lineB.properties || {}).passageLength) || 0;
  const bfA = parseFloat(pa.boundaryFlow) || 0;
  const bfB = parseFloat((c.lineB.properties || {}).boundaryFlow) || 0;

  const merged = {};
  Object.assign(merged, pa);
  merged.length = roundTo5(newLength);
  merged.passageLength = roundTo5(passA + passB);
  // boundaryFlow: splitLineAtPoint оставляет его только на line1 (на line2 = 0);
  // splitAllLines копирует одинаковое значение в оба сегмента.
  // max() корректно обрабатывает оба случая.
  merged.boundaryFlow = roundTo5(Math.max(bfA, bfB));
  merged.airVolume = merged.boundaryFlow;
  merged.velocity = 0;
  merged.depression = 0;
  merged.localObjectResistance = 0;
  merged.localDeltaCoefficient = 0;
  merged.startNode = '';
  merged.endNode = '';
  // Имя без суффикса " (часть N)"
  let name = pa.name || 'Линия';
  name = name.replace(/\s*\(часть\s+\d+\)\s*$/i, '');
  merged.name = name;
  merged.layerId = c.layerId;
  // Пересчёт сопротивления через каноническую функцию
  if (typeof recalculateLineHydraulicBase === 'function') {
    const hydra = recalculateLineHydraulicBase(merged);
    if (hydra && typeof hydra.airResistance === 'number') {
      merged.airResistance = roundTo5(hydra.airResistance);
      merged.perimeter = roundTo5(hydra.perimeter || 0);
    }
  }
  merged.totalResistance = merged.airResistance;

  return new fabric.Line([c.outerA.x, c.outerA.y, c.outerB.x, c.outerB.y], {
    stroke: c.lineA.stroke,
    strokeWidth: c.lineA.strokeWidth,
    strokeDashArray: c.lineA.strokeDashArray,
    fill: false,
    strokeLineCap: 'round',
    hasControls: true,
    hasBorders: true,
    id: generateLineId(),
    properties: merged
  });
}

// Объединяет коллинеарные сегменты, разделённые в проходных узлах (степень 2,
// без объектов и блокировок). Обратная операция к splitAllLines.
// Работает по всем видимым слоям; внутри каждого слоя итерируется до сходимости.
function simplifyAllLines() {
  const allLayers = typeof getLayers === 'function' ? getLayers() : [{ id: 'default', visible: true }];
  const targetLayerIds = allLayers
    .filter(l => l.visible !== false)
    .map(l => l.id);
  if (!targetLayerIds.length) targetLayerIds.push('default');

  let totalReduced = 0;
  let savedUndo = false;
  let safety = 200;

  while (safety-- > 0) {
    let mergedThisPass = 0;

    for (const layerId of targetLayerIds) {
      const candidates = _findMergeCandidates(layerId);
      if (!candidates.length) continue;

      const removedSet = new Set();
      const addedList = [];

      for (const c of candidates) {
        if (removedSet.has(c.lineA) || removedSet.has(c.lineB)) continue;
        if (!savedUndo) { saveToUndoStack(); savedUndo = true; }
        removedSet.add(c.lineA);
        removedSet.add(c.lineB);
        addedList.push(_mergeTwoSegments(c));
      }

      if (addedList.length) {
        removedSet.forEach(line => {
          if (typeof removeAirVolumeText === 'function') removeAirVolumeText(line);
          canvas.remove(line);
        });
        addedList.forEach(line => {
          canvas.add(line);
          if (typeof applyLayerColorToObject === 'function') applyLayerColorToObject(line);
          if (typeof createOrUpdateAirVolumeText === 'function') createOrUpdateAirVolumeText(line);
        });
        if (typeof invalidateCache === 'function') invalidateCache();
        // Каждое объединение: 2 → 1, чистое уменьшение = размер removedSet - addedList.length
        mergedThisPass += removedSet.size - addedList.length;
      }
    }

    if (!mergedThisPass) break;
    totalReduced += mergedThisPass;
  }

  // Сколько линий осталось — нужно для информативного уведомления.
  const linesAfter = (typeof getCachedLines === 'function') ? getCachedLines().length : 0;
  const linesBefore = linesAfter + totalReduced;

  // ВАЖНО: rebuildNodeMarkers и updateAllAirVolumeTexts вызываем ВСЕГДА,
  // даже если totalReduced=0. Иначе после Delete части схемы (а потом
  // «Упростить» как safety-net) юзер видит мусорные кружки и подписи от
  // удалённых ветвей и думает, что «Упростить» ничего не делает.
  if (typeof updateConnectionGraph === 'function') updateConnectionGraph();
  if (typeof rebuildNodeMarkers === 'function') rebuildNodeMarkers();
  if (typeof updateAllAirVolumeTexts === 'function') updateAllAirVolumeTexts();
  if (typeof scheduleRender === 'function') scheduleRender();

  if (totalReduced > 0) {
    showNotification(
      `Упростить: было ${linesBefore} линий → стало ${linesAfter} (объединено пар: ${totalReduced}). Мусорные маркеры узлов убраны.`,
      'success'
    );
    // Аналогично splitAllLines (п.25): пересчитать после изменения графа,
    // чтобы стрелки потоков и значения соответствовали новой топологии.
    if (typeof calculateAirFlowsSafe === 'function') {
      setTimeout(() => calculateAirFlowsSafe(), 60);
    }
  } else {
    showNotification(
      `Упростить: объединять нечего (${linesAfter} ${linesAfter === 1 ? 'линия' : 'линий'} — все ветви уже минимальные). Мусорные маркеры узлов убраны.`,
      'info'
    );
  }
}

// Разделить линии по центрам объектов (изображений) на холсте
function splitAllLinesAtObjectCenters() {
  const images = getCachedImages();
  if (!images.length) {
    showNotification('Нет объектов для разделения', 'info');
    return;
  }
  let totalSplit = 0;
  for (let img of images) {
    const center = getObjectCenter(img);
    const lines = getCachedLines().slice(); // snapshot
    for (let line of lines) {
      const closest = findClosestPointOnLine(center, line);
      if (closest.param > 0.05 && closest.param < 0.95 && closest.distance < 30) {
        const nodeCheck = isPointInLockedNode(closest.x, closest.y);
        if (nodeCheck && nodeCheck.node.locked) continue;
        const split = splitLineAtPoint(line, { x: closest.x, y: closest.y });
        if (split) {
          saveToUndoStack();
          canvas.remove(line);
          removeAirVolumeText(line);
          canvas.add(split.line1);
          canvas.add(split.line2);
          createOrUpdateAirVolumeText(split.line1);
          createOrUpdateAirVolumeText(split.line2);
          invalidateCache();
          totalSplit++;
          break; // пересчитать кэш и перейти к следующему объекту
        }
      }
    }
  }
  if (totalSplit > 0) {
    updateConnectionGraph();
    scheduleRender();
    showNotification(`Разделено ${totalSplit} линий по центрам объектов`, 'success');
  } else {
    showNotification('Линии для разделения не найдены', 'info');
  }
}

// Пересчитать свойства всех линий (геометрические и гидравлические)
function calculateAllPropertiesForAllLines() {
  const lines = getCachedLines();
  if (!lines.length) {
    showNotification('Нет ветвей для пересчёта', 'info');
    return;
  }
  lines.forEach(line => {
    normalizeLineProperties(line);
    updateDerivedLineFields(line);
    createOrUpdateAirVolumeText(line);
  });
  invalidateCache();
  updateConnectionGraph();
  scheduleRender();
  updatePropertiesPanel();
  showNotification(`Пересчитано ${lines.length} ветвей`, 'success');
}

// Сбросить результаты расчёта воздуха
function resetCalculation() {
  lastCalculationResult = null;
  clearSmokeVisualization();
  getCachedLines().forEach(line => {
    if (line.properties) {
      line.properties.airVolume = 0;
      line.properties.velocity = 0;
      line.properties.depression = 0;
      line.properties.deltaCoefficient = 0;
      line.properties.startNode = '';
      line.properties.endNode = '';
    }
    removeAirVolumeText(line);
  });
  invalidateCache();
  scheduleRender();
  updatePropertiesPanel();
  showNotification('Результаты расчёта сброшены', 'info');
}

// ═══ ОЧИСТКА МУСОРА В ГРАФЕ ════════════════════════════════════════════════
// Находит и удаляет:
//   1) микро-линии (длина < MIN_LENGTH px) — почти всегда это «огрызки»,
//      оставшиеся после некорректных сплитов/перетаскиваний;
//   2) дубли — когда между одной и той же парой узлов (через getPointKey
//      с учётом layerId) есть несколько линий, причём среди них есть
//      короткие. Короткие удаляются, длинная (реально нарисованная ветвь)
//      остаётся. Намеренно параллельные «длинные» ветви НЕ трогаются.
//
// Использует saveToUndoStack — можно откатить через Ctrl+Z.
// Возвращает { removed, details } для UI-фидбэка.
function cleanupGhostLines(options) {
  options = options || {};
  const MIN_LENGTH = typeof options.minLength === 'number' ? options.minLength : 15;
  const dryRun = !!options.dryRun;

  const lines = getCachedLines().slice();
  if (!lines.length) {
    return { removed: 0, details: [] };
  }

  const toRemove = new Set();
  const details = [];

  // 1) Микро-линии
  lines.forEach(line => {
    const ep = getLineAbsoluteEndpoints(line);
    const len = Math.hypot(ep.x2 - ep.x1, ep.y2 - ep.y1);
    if (len < MIN_LENGTH) {
      toRemove.add(line);
      details.push({
        id: line.id,
        name: (line.properties && line.properties.name) || '?',
        reason: 'micro',
        length: roundTo5(len)
      });
    }
  });

  // 2) Дубли по паре endpoint-ключей (с layerId)
  //    Группируем линии по ключу "keyA|keyB" (в отсортированном виде)
  const groups = new Map();
  lines.forEach(line => {
    const ep = getLineAbsoluteEndpoints(line);
    const lid = (line.properties && line.properties.layerId) || 'default';
    const k1 = getPointKey(ep.x1, ep.y1) + '@' + lid;
    const k2 = getPointKey(ep.x2, ep.y2) + '@' + lid;
    const pair = k1 < k2 ? (k1 + '|' + k2) : (k2 + '|' + k1);
    if (!groups.has(pair)) groups.set(pair, []);
    groups.get(pair).push({ line, length: Math.hypot(ep.x2 - ep.x1, ep.y2 - ep.y1) });
  });

  groups.forEach((arr, pair) => {
    if (arr.length < 2) return;
    // Если в группе есть «короткие» — удаляем их, оставляя самую длинную
    const maxLen = arr.reduce((m, o) => Math.max(m, o.length), 0);
    arr.forEach(o => {
      // Короткая среди дублей → мусор.
      // Также: если все дубли примерно одинаковые и очень короткие — оставим
      // только один (первый), остальные удалим.
      const isShort = o.length < MIN_LENGTH;
      const isNonMaxTwin = o.length < maxLen * 0.5; // меньше половины самой длинной
      if (isShort || isNonMaxTwin) {
        if (!toRemove.has(o.line)) {
          toRemove.add(o.line);
          details.push({
            id: o.line.id,
            name: (o.line.properties && o.line.properties.name) || '?',
            reason: 'duplicate',
            length: roundTo5(o.length),
            pair: pair
          });
        }
      }
    });
    // Если в группе все линии НЕ короткие и все одинаковые по длине — оставим
    // только одну (считаем это точным дублем после копирования)
    const allNormal = arr.every(o => o.length >= MIN_LENGTH);
    const allSame = arr.every(o => Math.abs(o.length - arr[0].length) < 0.5);
    if (allNormal && allSame && arr.length > 1) {
      // Оставляем первую, остальные — на удаление
      for (let i = 1; i < arr.length; i++) {
        if (!toRemove.has(arr[i].line)) {
          toRemove.add(arr[i].line);
          details.push({
            id: arr[i].line.id,
            name: (arr[i].line.properties && arr[i].line.properties.name) || '?',
            reason: 'exact-duplicate',
            length: roundTo5(arr[i].length),
            pair: pair
          });
        }
      }
    }
  });

  if (dryRun || toRemove.size === 0) {
    return { removed: toRemove.size, details };
  }

  // Реальное удаление — с сохранением в undo
  if (typeof saveToUndoStack === 'function') saveToUndoStack();
  toRemove.forEach(line => {
    if (typeof removeAirVolumeText === 'function') removeAirVolumeText(line);
    canvas.remove(line);
  });
  if (typeof invalidateCache === 'function') invalidateCache();
  if (typeof updateConnectionGraph === 'function') updateConnectionGraph();
  canvas.renderAll();
  if (typeof updatePropertiesPanel === 'function') updatePropertiesPanel();

  return { removed: toRemove.size, details };
}

// UI-обёртка — можно повесить на кнопку
function cleanupGhostLinesUI() {
  // Сначала dry-run чтобы показать что найдено
  const preview = cleanupGhostLines({ dryRun: true });
  if (!preview.removed) {
    showNotification('Мусор не найден — граф чистый', 'success');
    return;
  }
  const msg = 'Найдено линий-мусора: ' + preview.removed + '\n' +
              preview.details.slice(0, 8).map(d =>
                '  • ' + d.name + ' (' + d.reason + ', L=' + d.length + ')'
              ).join('\n') +
              (preview.details.length > 8 ? '\n  ...' : '') +
              '\n\nУдалить? (Ctrl+Z — откат)';
  if (!confirm(msg)) return;
  const result = cleanupGhostLines();
  showNotification('Удалено линий-мусора: ' + result.removed, 'success');
}

// Export all functions to global scope
global.cleanupGhostLines = cleanupGhostLines;
global.cleanupGhostLinesUI = cleanupGhostLinesUI;
global.getExportRows = getExportRows;
global.analyzeNetworkNodes = analyzeNetworkNodes;
global.calculateChainResistanceAndFlow = calculateChainResistanceAndFlow;
global.showChainSummary = showChainSummary;
global.showAllChainsSummary = showAllChainsSummary;
global.analyzeSelectedChain = analyzeSelectedChain;
global.showAirVolumeReport = showAirVolumeReport;
global.showNotificationLogModal = showNotificationLogModal;
global.splitAllLinesAtObjectCenters = splitAllLinesAtObjectCenters;
global.simplifyAllLines = simplifyAllLines;
global.calculateAllPropertiesForAllLines = calculateAllPropertiesForAllLines;
global.resetCalculation = resetCalculation;

})(window);
