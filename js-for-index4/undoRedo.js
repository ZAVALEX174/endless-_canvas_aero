// undoRedo.js — Функции отмены/повтора действий
// Извлечено из main5.js

(function() {

function saveToUndoStack() {
  const json = JSON.stringify(canvas.toJSON(['id', 'properties', 'isPreview']));
  undoStack.push(json);
  redoStack = [];
  if (undoStack.length > APP_CONFIG.MAX_UNDO_STEPS) undoStack.shift();
  updateUndoRedoButtons();
  if (typeof debouncedAutoSave === 'function') debouncedAutoSave();
}

function _resetVisualStateAfterUndoRedo() {
  // Сброс расчёта и визуализаций после Undo/Redo:
  // загрузка из JSON может оставить «тени» прошлого расчёта — поэтому
  // сбрасываем подкраски (smoke, flow), маркеры висящих концов и
  // приводим тексты воздуха к свежему состоянию.
  if (typeof clearSmokeVisualization === 'function') clearSmokeVisualization();
  if (typeof clearFlowColoring === 'function') clearFlowColoring();
  if (typeof clearDanglingMarkers === 'function') clearDanglingMarkers();
  if (typeof resetCalculation === 'function') {
    try { resetCalculation(); } catch (e) { /* безопасно — продолжаем */ }
  }
}

function undoAction() {
  if (undoStack.length < 2) return;
  const current = undoStack.pop();
  redoStack.push(current);
  const prev = undoStack[undoStack.length - 1];
  canvas.loadFromJSON(prev, () => {
    invalidateCache();
    updateConnectionGraph();
    _resetVisualStateAfterUndoRedo();
    updateAllAirVolumeTexts();
    canvas.renderAll();
    updatePropertiesPanel();
  });
  updateUndoRedoButtons();
}

function redoAction() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  undoStack.push(next);
  canvas.loadFromJSON(next, () => {
    invalidateCache();
    updateConnectionGraph();
    _resetVisualStateAfterUndoRedo();
    updateAllAirVolumeTexts();
    canvas.renderAll();
    updatePropertiesPanel();
  });
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.disabled = undoStack.length < 2;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

// Экспорт функций
window.saveToUndoStack = saveToUndoStack;
window.undoAction = undoAction;
window.redoAction = redoAction;
window.updateUndoRedoButtons = updateUndoRedoButtons;

})();
