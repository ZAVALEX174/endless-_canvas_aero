// contextMenu.js — Функции контекстного меню
// Извлечено из main5.js

(function() {

function showContextMenu(x, y) {
  const menu = document.getElementById('contextMenu');
  if (!menu) return;
  menu.style.display = 'block';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  contextMenuVisible = true;
}

function hideContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) menu.style.display = 'none';
  contextMenuVisible = false;
}

function deleteObject(force) {
  const active = canvas.getActiveObject();
  if (!active) return;
  if (active.type === 'line' && !force) {
    const _ep2b = getLineAbsoluteEndpoints(active);
    const startKey = getPointKey(_ep2b.x1, _ep2b.y1);
    const endKey = getPointKey(_ep2b.x2, _ep2b.y2);
    const startNode = window.connectionNodes ? window.connectionNodes.get(startKey) : null;
    const endNode = window.connectionNodes ? window.connectionNodes.get(endKey) : null;
    if ((startNode && startNode.locked && startNode.incomingEdges.length + startNode.outgoingEdges.length > 1) ||
      (endNode && endNode.locked && endNode.incomingEdges.length + endNode.outgoingEdges.length > 1)) {
      showNotification('Нельзя удалить линию из заблокированного узла (Shift+Delete — принудительно)', 'error');
      hideContextMenu();
      return;
    }
  }
  saveToUndoStack();
  canvas.remove(active);
  canvas.renderAll();
  updatePropertiesPanel();
  hideContextMenu();
}

function duplicateObject() {
  const active = canvas.getActiveObject();
  if (!active) return;
  active.clone(clone => {
    clone.left += 20;
    clone.top += 20;
    canvas.add(clone);
    canvas.setActiveObject(clone);
    invalidateCache();
    canvas.renderAll();
  });
  hideContextMenu();
}

function bringObjectToFront() {
  const active = canvas.getActiveObject();
  if (active) active.bringToFront();
  canvas.renderAll();
  hideContextMenu();
}

function sendObjectToBack() {
  const active = canvas.getActiveObject();
  if (active) active.sendToBack();
  canvas.renderAll();
  hideContextMenu();
}

// ── Переключение запечатанного тупика ─────────────────────────────────────
// Определяем ближайший тупиковый узел к указанной точке на canvas.
// Тупик = degree-1 узел без объекта-источника.
function findNearbyDeadEndNode(canvasX, canvasY, threshold) {
  threshold = threshold || 20;
  var lines = getCachedLines();
  if (!lines || !lines.length) return null;

  // Собираем узлы и их степени
  var nodeDeg = {};
  var nodeCoords = {};
  var _ck = typeof getCalcNodeKey === 'function' ? getCalcNodeKey : getPointKey;
  lines.forEach(function(line) {
    var ep = getLineAbsoluteEndpoints(line);
    var lid = (line.properties && line.properties.layerId) || 'default';
    var k1 = _ck(ep.x1, ep.y1, lid);
    var k2 = _ck(ep.x2, ep.y2, lid);
    nodeDeg[k1] = (nodeDeg[k1] || 0) + 1;
    nodeDeg[k2] = (nodeDeg[k2] || 0) + 1;
    nodeCoords[k1] = { x: roundTo5(ep.x1), y: roundTo5(ep.y1) };
    nodeCoords[k2] = { x: roundTo5(ep.x2), y: roundTo5(ep.y2) };
  });

  // Ищем ближайший тупик (degree=1) к курсору
  var bestKey = null;
  var bestDist = Infinity;
  for (var key in nodeDeg) {
    if (nodeDeg[key] !== 1) continue;
    var c = nodeCoords[key];
    var d = Math.hypot(c.x - canvasX, c.y - canvasY);
    if (d < threshold && d < bestDist) {
      bestDist = d;
      bestKey = key;
    }
  }
  return bestKey ? { key: bestKey, x: nodeCoords[bestKey].x, y: nodeCoords[bestKey].y } : null;
}

function toggleSealedNode(nodeKey) {
  if (!nodeKey) return;
  if (!window.sealedNodes) window.sealedNodes = new Set();
  if (window.sealedNodes.has(nodeKey)) {
    window.sealedNodes.delete(nodeKey);
    showNotification('Тупик открыт (связь с атмосферой)', 'success');
  } else {
    window.sealedNodes.add(nodeKey);
    showNotification('Тупик запечатан (глухой)', 'success');
  }
  // Обновить визуализацию
  if (typeof updateSealedNodeVisuals === 'function') updateSealedNodeVisuals();
  if (typeof debouncedAutoSave === 'function') debouncedAutoSave();
}

// Показать контекстное меню с учётом тупикового узла
var _pendingSealNodeKey = null;

function showContextMenuExtended(x, y, canvasX, canvasY) {
  var menu = document.getElementById('contextMenu');
  if (!menu) return;

  // Проверяем наличие тупика рядом с кликом
  var deadEnd = findNearbyDeadEndNode(canvasX, canvasY, 20);
  var sealItem = document.getElementById('contextMenuSealToggle');

  if (deadEnd) {
    _pendingSealNodeKey = deadEnd.key;
    var isSealed = window.sealedNodes && window.sealedNodes.has(deadEnd.key);
    if (!sealItem) {
      sealItem = document.createElement('div');
      sealItem.id = 'contextMenuSealToggle';
      sealItem.className = 'context-menu-item';
      sealItem.onclick = function() { toggleSealedNode(_pendingSealNodeKey); hideContextMenu(); };
      menu.insertBefore(sealItem, menu.firstChild);
    }
    sealItem.textContent = isSealed ? 'Открыть тупик (атмосфера)' : 'Запечатать тупик (глухой)';
    sealItem.style.display = 'block';
  } else {
    _pendingSealNodeKey = null;
    if (sealItem) sealItem.style.display = 'none';
  }

  menu.style.display = 'block';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  contextMenuVisible = true;
}

// Экспорт функций
window.showContextMenu = showContextMenu;
window.showContextMenuExtended = showContextMenuExtended;
window.hideContextMenu = hideContextMenu;
window.findNearbyDeadEndNode = findNearbyDeadEndNode;
window.toggleSealedNode = toggleSealedNode;
window.deleteObject = deleteObject;
window.duplicateObject = duplicateObject;
window.bringObjectToFront = bringObjectToFront;
window.sendObjectToBack = sendObjectToBack;

})();
