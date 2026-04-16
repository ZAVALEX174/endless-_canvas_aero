// keyboard.js — extracted from main5.js
(function(global) {

function toggleNodeLock() {
  nodeLockEnabled = !nodeLockEnabled;
  const btn = document.getElementById('nodeLockBtn');
  if (btn) {
    btn.innerHTML = nodeLockEnabled
      ? '<span>🔒</span> Узлы: ЗАБЛОКИРОВАНЫ'
      : '<span>🔓</span> Узлы: РАЗБЛОКИРОВАНЫ';
  }
  showNotification(nodeLockEnabled ? 'Узлы заблокированы' : 'Узлы разблокированы', nodeLockEnabled ? 'warning' : 'info');
  updateConnectionGraph();
  scheduleRender();
}

function isPointInLockedNode(x, y, threshold = APP_CONFIG.NODE_THRESHOLD) {
  if (!window.connectionNodes) return null;
  let result = null;
  window.connectionNodes.forEach(node => {
    if (!node.locked) return;
    const dist = Math.hypot(x - node.x, y - node.y);
    if (dist < threshold) result = { node, distance: dist };
  });
  return result;
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (isDrawingLine) deactivateAllModes();
      const modals = document.querySelectorAll('.modal');
      for (let m of modals) m.style.display = 'none';
    }
    if (e.key === 'Delete') {
      const active = canvas.getActiveObject();
      if (active) {
        // Групповое удаление (ActiveSelection — Ctrl+A или ручное выделение)
        if (active.type === 'activeSelection' && typeof active.getObjects === 'function') {
          const objs = active.getObjects().slice();
          // Проверка заблокированных узлов (пропускаем такие линии без shift)
          if (!e.shiftKey) {
            for (const o of objs) {
              if (o.type !== 'line') continue;
              const _ep = getLineAbsoluteEndpoints(o);
              const sk = getPointKey(_ep.x1, _ep.y1);
              const ek = getPointKey(_ep.x2, _ep.y2);
              const sn = window.connectionNodes ? window.connectionNodes.get(sk) : null;
              const en = window.connectionNodes ? window.connectionNodes.get(ek) : null;
              if ((sn && sn.locked && sn.incomingEdges.length + sn.outgoingEdges.length > 1) ||
                  (en && en.locked && en.incomingEdges.length + en.outgoingEdges.length > 1)) {
                showNotification('В выделении есть линии из заблокированных узлов (Shift+Delete — принудительно)', 'error');
                return;
              }
            }
          }
          saveToUndoStack();
          canvas.discardActiveObject();
          objs.forEach(o => canvas.remove(o));
          canvas.renderAll();
          updatePropertiesPanel();
          if (typeof invalidateCache === 'function') invalidateCache();
          if (typeof updateConnectionGraph === 'function') updateConnectionGraph();
          return;
        }
        if (active.type === 'line' && !e.shiftKey) {
          const _ep2a = getLineAbsoluteEndpoints(active);
          const startKey = getPointKey(_ep2a.x1, _ep2a.y1);
          const endKey = getPointKey(_ep2a.x2, _ep2a.y2);
          const startNode = window.connectionNodes ? window.connectionNodes.get(startKey) : null;
          const endNode = window.connectionNodes ? window.connectionNodes.get(endKey) : null;
          if ((startNode && startNode.locked && startNode.incomingEdges.length + startNode.outgoingEdges.length > 1) ||
            (endNode && endNode.locked && endNode.incomingEdges.length + endNode.outgoingEdges.length > 1)) {
            showNotification('Нельзя удалить линию из заблокированного узла (Shift+Delete — принудительно)', 'error');
            return;
          }
        }
        saveToUndoStack();
        canvas.remove(active);
        canvas.renderAll();
        updatePropertiesPanel();
      }
    }
    if (e.ctrlKey) {
      if (e.key === 'z') {
        e.preventDefault();
        undoAction();
      }
      if (e.key === 'y') {
        e.preventDefault();
        redoAction();
      }
      if (e.key === 's') {
        e.preventDefault();
        saveDrawing();
      }
      if (e.key === 'o') {
        e.preventDefault();
        loadDrawing();
      }
      if (e.key === 'a') {
        // Ctrl+A — выделить все (кроме служебных) без захвата фокуса из инпутов
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
        e.preventDefault();
        const all = canvas.getObjects().filter(o =>
          o && o.id !== 'grid-group' && !o.isPreview &&
          o.id !== 'intersection-point' && o.id !== 'intersection-point-label' &&
          o.id !== 'air-volume-text' && o.id !== 'sealed-node-marker' &&
          o.id !== 'dangling-marker'
        );
        if (!all.length) return;
        canvas.discardActiveObject();
        const sel = new fabric.ActiveSelection(all, { canvas });
        canvas.setActiveObject(sel);
        canvas.requestRenderAll();
      }
    }
    // Hot-клавиши — не перехватываем ввод в инпутах и при Ctrl/Meta (Alt допустим для Alt+N, Alt+P)
    const _tag = (e.target && e.target.tagName) || '';
    if (_tag === 'INPUT' || _tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey) return;
    switch (e.key.toLowerCase()) {
      case 'l':
        e.preventDefault();
        activateLineDrawing();
        break;
      case 'g':
        e.preventDefault();
        toggleGrid();
        break;
      case 's':
        e.preventDefault();
        splitAllLines();
        break;
      case 'a':
        e.preventDefault();
        toggleAutoSplitMode();
        break;
      case 'n':
        if (e.altKey) {
          e.preventDefault();
          toggleNodeLock();
        }
        break;
      case 'p':
        if (e.altKey) {
          e.preventDefault();
          (typeof calculateAirFlowsSafe === 'function' ? calculateAirFlowsSafe : calculateAirFlows)();
        }
        break;
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Alt') altKeyPressed = true;
    if (e.code === 'Space') {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
      e.preventDefault();
      if (!spacePressed) {
        spacePressed = true;
        if (canvas) canvas.defaultCursor = 'grab';
      }
    }
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'Alt') altKeyPressed = false;
    if (e.code === 'Space') {
      spacePressed = false;
      if (canvas && !currentImageData) canvas.defaultCursor = 'default';
    }
  });
  document.addEventListener('click', hideContextMenu);
}

// Exports
global.toggleNodeLock = toggleNodeLock;
global.isPointInLockedNode = isPointInLockedNode;
global.setupKeyboardShortcuts = setupKeyboardShortcuts;

})(window);
