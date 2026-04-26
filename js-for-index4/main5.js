// main5.js – Точка входа: глобальные переменные, инициализация, экспорты
// Все функции вынесены в отдельные модули (config.js, utils.js, airModel.js, etc.)

// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ====================
let canvas;
let isDrawingLine = false;
let isContinuousLineMode = true;
let lineStartPoint = null;
let previewLine = null;
let lastLineEndPoint = null;
let currentEditingLine = null;
let currentImageData = null;
let gridVisible = true;
let undoStack = [];
let redoStack = [];
let contextMenuVisible = false;
let autoSplitMode = true;
let lineSplitMode = 'AUTO';
let altKeyPressed = false;
let spacePressed = false;
let isCrossLayerMode = false;

let intersectionPoints = [];
let intersectionVisuals = [];
let currentEditingObject = null;
let currentEditingObjectType = null;
let isCalculatingAirVolumes = false;

let nodeLockEnabled = APP_CONFIG.NODE_LOCK_DEFAULT;
let elementCounter = 0;

let cachedLines = null;
let cachedImages = null;
let cachedAllObjects = null;
let cacheDirty = true;

let spatialGrid = new Map();
let spatialGridDirty = true;

let isUpdatingConnections = false;
let updateGraphTimeout = null;
let updateTextsTimeout = null;
let renderTimeout = null;

let lineChains = [];
let chainIdCounter = 0;
window.lineToChainMap = new Map();

const performanceMetrics = {
  lastRenderTime: 0,
  lastIntersectionTime: 0,
  lastGraphUpdateTime: 0,
  objectCount: 0
};

let lastCalculationResult = null;

// Множество «запечатанных» тупиков (ключ узла → true).
// По умолчанию все тупики — свободные отверстия (связь с атмосферой).
// Узел в этом Set закрыт (глухой тупик, давление не фиксируется в 0).
let sealedNodes = new Set();
window.sealedNodes = sealedNodes;

// ==================== ИСПРАВЛЕНИЕ ДЛЯ FABRIC.JS (textBaseline) ====================
try {
  const contextProto = CanvasRenderingContext2D.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(contextProto, 'textBaseline');
  if (descriptor && descriptor.set) {
    const originalSetter = descriptor.set;
    Object.defineProperty(contextProto, 'textBaseline', {
      set: function (value) {
        const correctedValue = (value === 'alphabetical') ? 'alphabetic' : value;
        return originalSetter.call(this, correctedValue);
      },
      get: descriptor.get,
      configurable: true
    });
  }
} catch (e) {
  console.error("Не удалось применить фикс для Chrome (textBaseline):", e);
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
document.addEventListener('DOMContentLoaded', () => {
  initializeCanvas();
  updateImageLibrary();
  updateStatus();
  initializeModals();
  setupKeyboardShortcuts();
  // Инициализация слоёв
  if (typeof renderLayersPanel === 'function') renderLayersPanel();
  if (typeof populateLayerSelects === 'function') populateLayerSelects();

  // Подсветить кнопку «Непрерывный» если режим включён по умолчанию
  const _contBtn = document.getElementById('continuousModeBtn');
  if (_contBtn && isContinuousLineMode) _contBtn.classList.add('active');

  // п.26: «Струя» включена по умолчанию — синхронизируем UI с состоянием
  const _flowBtn = document.getElementById('flowColoringBtn');
  if (_flowBtn && window.flowColoringEnabled) _flowBtn.classList.add('active');

  if (typeof initTabs === 'function') initTabs();
  if (typeof initLegend === 'function') initLegend();
  if (typeof initStatusBarCoords === 'function') initStatusBarCoords();
  if (typeof initTooltips === 'function') initTooltips();
  if (typeof applyCanvasTheme === 'function') applyCanvasTheme();

  // Проверка автосохранения
  if (hasAutoSave()) {
    var saveTime = getAutoSaveTime();
    var timeStr = saveTime ? new Date(saveTime).toLocaleString() : '';
    var banner = document.getElementById('autosaveRecoveryBanner');
    if (banner) {
      var timeEl = document.getElementById('autosaveTime');
      if (timeEl) timeEl.textContent = timeStr ? ' (' + timeStr + ')' : '';
      banner.style.display = 'flex';
    }
  }

  const nodeLockBtn = document.getElementById('nodeLockBtn');
  if (nodeLockBtn) {
    nodeLockBtn.innerHTML = nodeLockEnabled
      ? '<span>🔒</span> Узлы: ЗАБЛОКИРОВАНЫ'
      : '<span>🔓</span> Узлы: РАЗБЛОКИРОВАНЫ';
    nodeLockBtn.addEventListener('click', toggleNodeLock);
  }

  const calcBtn = document.getElementById('calculateAirBtn');
  if (calcBtn) calcBtn.addEventListener('click', () => calculateAirFlowsSafe());

  const resetBtn = document.getElementById('resetCalcBtn');
  if (resetBtn) resetBtn.addEventListener('click', () => resetCalculation());

  const analyzeBtn = document.getElementById('analyzePointsBtn');
  if (analyzeBtn) analyzeBtn.addEventListener('click', () => analyzeNetworkNodes(true));

  const chainsBtn = document.createElement('button');
  chainsBtn.textContent = 'Цепочки';
  chainsBtn.className = 'context-btn';
  chainsBtn.onclick = () => {
    buildLineChains();
    visualizeChains();
  };
  const contextBar = document.querySelector('.app-context-bar');
  if (contextBar) contextBar.appendChild(chainsBtn);

  addChainAnalysisButtons();

  window.addEventListener('resize', debounce(updateCanvasSize, 250));
});

// ──────────────────────────────────────────────────────────────────────────
// Безопасная обёртка над calculateAirFlows: делает dry-run cleanup и
// показывает предупреждения пользователю, НЕ модифицируя защищённый солвер.
// Вызывается из UI-кнопки «Расчёт воздуха» и горячей клавиши Alt+P.
// Прямые вызовы calculateAirFlows из compare/reverse/auto-recalc оставлены
// без обёртки, чтобы не мешать автоматическим потокам.
// ──────────────────────────────────────────────────────────────────────────
function calculateAirFlowsSafe() {
  try {
    // 1) Dry-run cleanup: ищем линии-огрызки и дубли
    let ghosts = { removed: 0, details: [] };
    if (typeof cleanupGhostLines === 'function') {
      ghosts = cleanupGhostLines({ dryRun: true });
    }

    // 2) Проверка наличия источника и атмосферы
    const imgs = (typeof getCachedImages === 'function') ? getCachedImages() : [];
    const fans = imgs.filter(i => i && i.properties && i.properties.type === 'fan' && i.properties.isFlowSource !== false);
    const atms = imgs.filter(i => i && i.properties && i.properties.type === 'atmosphere');

    const warnings = [];
    if (!fans.length) {
      warnings.push('⚠ В сети нет ни одного вентилятора-источника (fan с isFlowSource=true).');
    }
    if (ghosts.removed > 0) {
      warnings.push('⚠ В графе найдено линий-мусора: ' + ghosts.removed +
                    ' (микро-линии и дубли после сплитов). Солвер может ' +
                    'не сойтись — рекомендуется нажать «Очистить мусор».');
    }
    if (!atms.length && fans.length) {
      warnings.push('ℹ В сети нет объекта «Атмосфера» — естественная тяга He=0. ' +
                    'Если это намеренно — игнорируйте.');
    }

    if (warnings.length) {
      if (typeof showNotification === 'function') {
        showNotification(warnings.join(' | '),
                         ghosts.removed > 0 ? 'warning' : 'info', 6000);
      }
      console.warn('[calculateAirFlowsSafe]\n' + warnings.join('\n'));
    }
  } catch (e) {
    console.warn('[calculateAirFlowsSafe] pre-check error:', e);
  }

  // В любом случае запускаем расчёт — pre-check только предупреждает
  const result = calculateAirFlows();

  // Если включён режим раскраски струи — применить его к свежим результатам.
  // Делаем в setTimeout, чтобы applySmokeVisualization внутри солвера успел
  // отработать ДО нас (и мы не боролись с ним за stroke).
  if (window.flowColoringEnabled && typeof applyFlowColoring === 'function') {
    setTimeout(function() {
      try { applyFlowColoring(); } catch (e) { console.warn('applyFlowColoring failed', e); }
    }, 50);
  }

  // Событие для слушателей (3D-вид, будущие модули) — расчёт готов, данные в кэше
  try {
    document.dispatchEvent(new CustomEvent('calc:done'));
  } catch (e) { /* IE — игнор */ }

  return result;
}
window.calculateAirFlowsSafe = calculateAirFlowsSafe;

// ==================== ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ ====================
window.splitAllLinesAtObjectCenters = splitAllLinesAtObjectCenters;
window.calculateAllPropertiesForAllLines = calculateAllPropertiesForAllLines;
window.resetCalculation = resetCalculation;
// window.canvas назначается после инициализации в initializeCanvas
window.roundTo5 = roundTo5;
window.formatTo5 = formatTo5;
window.undoAction = undoAction;
window.redoAction = redoAction;
window.clearCanvas = clearCanvas;
window.toggleGrid = toggleGrid;
window.activateLineDrawing = activateLineDrawing;
window.toggleContinuousMode = toggleContinuousMode;
window.toggleAutoSplitMode = toggleAutoSplitMode;
window.toggleLineSplitMode = toggleLineSplitMode;
window.splitAllLines = splitAllLines;
window.showAddImageModal = showAddImageModal;
window.closeAddImageModal = closeAddImageModal;
window.addNewImage = addNewImage;
window.showLinePropertiesModal = showLinePropertiesModal;
window.closeLinePropertiesModal = closeLinePropertiesModal;
window.showObjectPropertiesModal = showObjectPropertiesModal;
window.closeObjectPropertiesModal = closeObjectPropertiesModal;
window.applyObjectProperties = applyObjectProperties;
window.deleteCurrentObject = deleteCurrentObject;
window.showContextMenu = showContextMenu;
window.deleteObject = deleteObject;
window.duplicateObject = duplicateObject;
window.bringObjectToFront = bringObjectToFront;
window.sendObjectToBack = sendObjectToBack;
window.calculateAirFlows = calculateAirFlows;
window.analyzeNetworkNodes = analyzeNetworkNodes;
window.buildLineChains = buildLineChains;
window.visualizeChains = visualizeChains;
window.showAirVolumeReport = showAirVolumeReport;
window.closeAirVolumeReport = function () {
  const modal = document.getElementById('airVolumeReportModal');
  if (modal) modal.style.display = 'none';
};
window.showIntersectionPointInfoModal = showIntersectionPointInfoModal;
window.closeIntersectionPointModal = function () {
  const modal = document.getElementById('intersectionPointModal');
  if (modal) modal.style.display = 'none';
};
// exportAirVolumeReportToCSV назначается в csvExport.js через window
window.getExportRows = getExportRows;
window.getLastCalculationResult = () => lastCalculationResult;
// saveDrawing и loadDrawing назначаются в projectManager.js через window
window.toggleNodeLock = toggleNodeLock;

window.calculateAirVolumesForAllLines = calculateAirFlows;
window.analyzeIntersectionPoints = function () {
  analyzeNetworkNodes(true);
};

// ── Реверс вентиляторов ─────────────────────────────────────────────
window.toggleFanReverse = function() {
  const images = getCachedImages();
  const fans = images.filter(img => isFanObject(img.properties || {}));
  if (!fans.length) {
    showNotification('Нет вентиляторов на схеме', 'warning');
    return;
  }
  const wasReverse = fans.some(f => (f.properties || {}).fanMode === 'reverse');
  fans.forEach(fan => {
    const p = fan.properties || {};
    p.fanMode = (p.fanMode === 'reverse') ? 'supply' : 'reverse';
    fan.set('properties', p);
  });
  invalidateCache();
  const newMode = wasReverse ? 'Подача' : 'Реверс';
  showNotification(`Вентиляторы переключены: ${newMode}. Пересчёт...`, 'info');
  calculateAirFlows();
  // Обновить стиль кнопки
  const btn = document.getElementById('toggleReverseBtn');
  if (btn) {
    btn.classList.toggle('active', !wasReverse);
    btn.title = wasReverse ? 'Переключить в реверс' : 'Переключить в подачу';
  }
};

window.compareNormalVsReverse = function() {
  const images = getCachedImages();
  const fans = images.filter(img => isFanObject(img.properties || {}));
  if (!fans.length) {
    showNotification('Нет вентиляторов на схеме', 'warning');
    return;
  }

  // Сохраняем текущие режимы
  const savedModes = fans.map(f => ({ fan: f, mode: (f.properties || {}).fanMode || 'supply' }));

  // 1. Расчёт в режиме "Подача"
  fans.forEach(f => { f.properties.fanMode = 'supply'; f.set('properties', f.properties); });
  invalidateCache();
  calculateAirFlows();
  const supplyRows = getExportRows();
  const supplyResult = lastCalculationResult ? {
    totalSourceFlow: lastCalculationResult.totalSourceFlow,
    networkDepressionPa: lastCalculationResult.networkDepressionPa,
    naturalDraftPa: lastCalculationResult.naturalDraftPa,
    requiredFanPressurePa: lastCalculationResult.requiredFanPressurePa
  } : {};

  // 2. Расчёт в режиме "Реверс"
  fans.forEach(f => { f.properties.fanMode = 'reverse'; f.set('properties', f.properties); });
  invalidateCache();
  calculateAirFlows();
  const reverseRows = getExportRows();
  const reverseResult = lastCalculationResult ? {
    totalSourceFlow: lastCalculationResult.totalSourceFlow,
    networkDepressionPa: lastCalculationResult.networkDepressionPa,
    naturalDraftPa: lastCalculationResult.naturalDraftPa,
    requiredFanPressurePa: lastCalculationResult.requiredFanPressurePa
  } : {};

  // 3. Восстанавливаем исходные режимы
  savedModes.forEach(({ fan, mode }) => { fan.properties.fanMode = mode; fan.set('properties', fan.properties); });
  invalidateCache();
  calculateAirFlows();

  // 4. Строим таблицу сравнения
  let html = '<div class="property-group">';
  html += '<h5>Общие показатели</h5>';
  html += '<table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:15px;">';
  html += '<tr><th>Показатель</th><th>Подача</th><th>Реверс</th></tr>';
  html += `<tr><td>Подача, м\u00b3/с</td><td>${formatTo5(supplyResult.totalSourceFlow || 0)}</td><td>${formatTo5(reverseResult.totalSourceFlow || 0)}</td></tr>`;
  html += `<tr><td>H\u0441\u0435\u0442\u0438, \u041f\u0430</td><td>${formatTo5(supplyResult.networkDepressionPa || 0)}</td><td>${formatTo5(reverseResult.networkDepressionPa || 0)}</td></tr>`;
  html += `<tr><td>He, \u041f\u0430</td><td>${formatTo5(supplyResult.naturalDraftPa || 0)}</td><td>${formatTo5(reverseResult.naturalDraftPa || 0)}</td></tr>`;
  html += `<tr><td>H\u0432\u0435\u043d\u0442,\u0442\u0440, \u041f\u0430</td><td>${formatTo5(supplyResult.requiredFanPressurePa || 0)}</td><td>${formatTo5(reverseResult.requiredFanPressurePa || 0)}</td></tr>`;
  html += '</table>';

  html += '<h5>Ветви: Подача vs Реверс</h5>';
  html += '<div style="overflow:auto; max-height:400px;"><table style="width:100%; border-collapse:collapse; font-size:11px;">';
  html += '<tr><th>Ветвь</th><th>Q подача</th><th>v подача</th><th>h подача</th><th>Q реверс</th><th>v реверс</th><th>h реверс</th><th>\u0394Q</th></tr>';

  const maxLen = Math.max(supplyRows.length, reverseRows.length);
  for (let i = 0; i < maxLen; i++) {
    const s = supplyRows[i] || {};
    const r = reverseRows[i] || {};
    const dQ = ((r.flow || 0) - (s.flow || 0));
    const dqColor = Math.abs(dQ) > 0.01 ? (dQ > 0 ? 'color:#2a7' : 'color:#c44') : '';
    html += `<tr>`;
    html += `<td>${escapeHtml(s.name || r.name || '-')}</td>`;
    html += `<td>${formatTo5(s.flow || 0)}</td><td>${formatTo5(s.velocity || 0)}</td><td>${formatTo5(s.depression || 0)}</td>`;
    html += `<td>${formatTo5(r.flow || 0)}</td><td>${formatTo5(r.velocity || 0)}</td><td>${formatTo5(r.depression || 0)}</td>`;
    html += `<td style="${dqColor}">${dQ >= 0 ? '+' : ''}${formatTo5(dQ)}</td>`;
    html += `</tr>`;
  }
  html += '</table></div></div>';

  createModal('compareReverseModal', '\u0421\u0440\u0430\u0432\u043d\u0435\u043d\u0438\u0435: \u041f\u043e\u0434\u0430\u0447\u0430 vs \u0420\u0435\u0432\u0435\u0440\u0441', html);
};

// ── Анимация вентиляторов на canvas ────────────────────────────────────────
let _fanAnimId = null;
let _fanAngle = 0;

function _getFanObjects() {
  return getCachedImages ? getCachedImages().filter(img => isFanObject(img.properties || {})) : [];
}

function _startFanCanvasAnimation() {
  if (_fanAnimId) return; // уже запущена
  function step() {
    _fanAngle = (_fanAngle + 4) % 360;
    _getFanObjects().forEach(function(fan) { fan.set('angle', _fanAngle); });
    if (canvas) canvas.requestRenderAll();
    _fanAnimId = fabric.util.requestAnimFrame(step);
  }
  _fanAnimId = fabric.util.requestAnimFrame(step);
}

function _stopFanCanvasAnimation() {
  if (_fanAnimId) {
    fabric.util.cancelAnimFrame(_fanAnimId);
    _fanAnimId = null;
  }
  // Вернуть исходный угол вентиляторов
  _getFanObjects().forEach(function(fan) { fan.set('angle', fan._originalAngle || 0); });
  if (canvas) canvas.requestRenderAll();
}

// ── Переключение анимации + реверс ─────────────────────────────────────────
window.toggleFanAnimationAndReverse = function() {
  const btn = document.getElementById('fanAnimationBtn');
  const isActive = btn && btn.classList.contains('active');

  if (isActive) {
    // Выключить анимацию, вернуть в подачу
    if (btn) btn.classList.remove('active');
    _stopFanCanvasAnimation();
    const fans = _getFanObjects();
    fans.forEach(fan => {
      const p = fan.properties || {};
      p.fanMode = 'supply';
      fan.set('properties', p);
    });
    if (typeof invalidateCache === 'function') invalidateCache();
    showNotification('Реверс выключен. Пересчёт...', 'info');
    if (typeof calculateAirFlows === 'function') calculateAirFlows();
  } else {
    // Сохранить исходные углы, запустить анимацию + реверс
    if (btn) btn.classList.add('active');
    _getFanObjects().forEach(function(fan) {
      fan._originalAngle = fan.angle || 0;
    });
    _startFanCanvasAnimation();
    window.toggleFanReverse && window.toggleFanReverse();
  }
};

// Экспорт счётчика
window.elementCounter = elementCounter;
window.getNextElementNumber = function() {
  elementCounter++;
  window.elementCounter = elementCounter;
  return elementCounter;
};

console.log('Модуль вентиляционной сети загружен. Используется единая расчётная модель по ТЗ.');
