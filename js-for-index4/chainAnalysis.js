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
    createModal('nodeAnalysisModal', 'Анализ узлов', `<pre>${report}</pre>`);
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
    html += `<tr><td>${row.name}</td><td>${formatTo5(row.length)}</td><td>${formatTo5(row.area)}</td><td>${formatTo5(row.resistance)}</td><td>${formatTo5(row.objectResistance)}</td><td>${formatTo5(row.totalResistance)}</td><td>${formatTo5(row.flow)}</td><td>${formatTo5(row.velocity)}</td><td>${formatTo5(row.depression)}</td></tr>`;
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
global.splitAllLinesAtObjectCenters = splitAllLinesAtObjectCenters;
global.calculateAllPropertiesForAllLines = calculateAllPropertiesForAllLines;
global.resetCalculation = resetCalculation;

})(window);
