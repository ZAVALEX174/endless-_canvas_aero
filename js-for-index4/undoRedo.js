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

function undoAction() {
  if (undoStack.length < 2) return;
  const current = undoStack.pop();
  redoStack.push(current);
  const prev = undoStack[undoStack.length - 1];
  canvas.loadFromJSON(prev, () => {
    invalidateCache();
    updateConnectionGraph();
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
