// projectManager.js – сохранение и загрузка проекта

(function(global) {
  'use strict';

  var AUTOSAVE_KEY = 'fabricDrawing_autosave';
  var AUTOSAVE_TIME_KEY = 'fabricDrawing_autosave_time';
  var CUSTOM_PROPS = ['id', 'properties', 'pointIndex', 'pointData', 'lineStartsFromObject', 'startObject', 'airVolumeText', 'isPreview'];

  // ==================== ФОРМАТ ФАЙЛА ====================
  var FILE_MAGIC = 'AERONET1';        // 8 байт — сигнатура формата
  var FILE_EXTENSION = '.vnet';
  var FILE_MIME = 'application/octet-stream';

  // Упаковать JSON в проприетарный формат: MAGIC + version(1) + base64(JSON)
  function packFile(json) {
    var encoded = btoa(unescape(encodeURIComponent(json)));  // UTF-8 → base64
    return FILE_MAGIC + '\x01' + encoded;
  }

  // Распаковать файл. Возвращает JSON-строку или null
  function unpackFile(data) {
    // Проприетарный формат
    if (data.substring(0, FILE_MAGIC.length) === FILE_MAGIC) {
      var payload = data.substring(FILE_MAGIC.length + 1);  // +1 за байт версии
      try {
        return decodeURIComponent(escape(atob(payload)));    // base64 → UTF-8
      } catch (e) {
        return null;
      }
    }
    // Обратная совместимость: старый JSON-формат
    if (data.charAt(0) === '{') {
      try {
        JSON.parse(data);  // валидация
        return data;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  // ==================== СОХРАНЕНИЕ / ЗАГРУЗКА ====================

  // Сохранить чертёж в файл и localStorage
  global.saveDrawing = function() {
    if (!canvas) {
      showNotification('Холст не инициализирован', 'error');
      return;
    }

    var projectData = {
      canvas: canvas.toJSON(CUSTOM_PROPS),
      layers: typeof getLayersData === 'function' ? getLayersData() : [],
      crossLayerConnections: typeof getCrossLayerConnections === 'function' ? getCrossLayerConnections() : [],
      sealedNodes: Array.from(window.sealedNodes || [])
    };
    var json = JSON.stringify(projectData);
    localStorage.setItem('fabricDrawing', json);

    var packed = packFile(json);
    var blob = new Blob([packed], { type: FILE_MIME });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'чертеж-' + new Date().toISOString().slice(0, 10) + FILE_EXTENSION;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    var count = canvas.getObjects().filter(function(obj) {
      return obj.id !== 'grid-group' && obj.id !== 'grid-line' && !obj.isPreview;
    }).length;
    showNotification('Чертеж сохранен! (' + count + ' объектов)', 'success');
  };

  // Загрузить чертёж из файла
  global.loadDrawing = function() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = FILE_EXTENSION + ',.json';
    input.onchange = function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(event) {
        try {
          var raw = event.target.result;
          var json = unpackFile(raw);
          if (!json) {
            showNotification('Неизвестный формат файла', 'error');
            return;
          }
          restoreCanvasFromJSON(json);
          showNotification('Чертеж загружен!', 'success');
        } catch (error) {
          showNotification('Ошибка загрузки файла: ' + error.message, 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // Общая логика восстановления canvas из JSON-строки
  function restoreCanvasFromJSON(json) {
    deactivateAllModes();
    canvas.clear();
    drawGrid(APP_CONFIG.GRID_SIZE);

    // Поддержка нового формата { canvas, layers } и старого (чистый canvas JSON)
    var canvasJson = json;
    try {
      var parsed = JSON.parse(json);
      if (parsed && parsed.canvas && parsed.layers !== undefined) {
        // Новый формат
        canvasJson = JSON.stringify(parsed.canvas);
        if (typeof setLayersData === 'function') setLayersData(parsed.layers);
        if (typeof setCrossLayerConnections === 'function') {
          setCrossLayerConnections(parsed.crossLayerConnections || []);
        }
        // Восстановление запечатанных тупиков
        if (parsed.sealedNodes && Array.isArray(parsed.sealedNodes)) {
          window.sealedNodes = new Set(parsed.sealedNodes);
          sealedNodes = window.sealedNodes;
        } else {
          window.sealedNodes = new Set();
          sealedNodes = window.sealedNodes;
        }
      }
    } catch (e) { /* оставляем canvasJson = json */ }

    canvas.loadFromJSON(canvasJson, function() {
      canvas.getObjects().forEach(function(obj) {
        if (obj.lineStartsFromObject && obj.properties && obj.properties.startsFromObject && obj.properties.startsFromObject.objectId) {
          var startObj = canvas.getObjects().find(function(o) {
            return o.id === obj.properties.startsFromObject.objectId || o._id === obj.properties.startsFromObject.objectId;
          });
          if (startObj) {
            obj.startObject = startObj;
          }
        }
        if (obj.type === 'line') normalizeLineProperties(obj);
        if (obj.type === 'image' && !obj.shadow) {
          var imgSh = (typeof getCV === 'function' ? getCV('--image-shadow-color') : 'rgba(255,255,255,0.45)') || 'rgba(255,255,255,0.45)';
          obj.set('shadow', new fabric.Shadow({ color: imgSh, blur: 6, offsetX: 0, offsetY: 0 }));
        }
      });

      // Применить видимость и цвета слоёв к загруженным объектам
      if (typeof getLayers === 'function') {
        var layerMap = {};
        getLayers().forEach(function(l) { layerMap[l.id] = l; });
        canvas.getObjects().forEach(function(obj) {
          if (!obj.properties) return;
          var layerId = obj.properties.layerId || 'default';
          var layer = layerMap[layerId];
          if (layer && !layer.visible) {
            obj.set('visible', false);
            obj.set('selectable', false);
            obj.set('evented', false);
          }
        });
        // Перекрасить все объекты согласно цветам слоёв (тени могли не сохраниться корректно)
        if (typeof applyAllLayerColors === 'function') applyAllLayerColors();
        else canvas.requestRenderAll();
        if (typeof refreshCrossLayerMarkers === 'function') refreshCrossLayerMarkers();
      }

      setTimeout(function() {
        invalidateCache();
        updateConnectionGraph();
        updateAllAirVolumeTexts();
      }, 500);

      canvas.renderAll();
      updatePropertiesPanel();
      updateStatus();
    });
  }

  // ==================== АВТОСОХРАНЕНИЕ ====================

  function autoSaveDrawing() {
    if (!canvas) return;
    var objs = canvas.getObjects();
    var hasContent = false;
    for (var i = 0; i < objs.length; i++) {
      if (objs[i].id !== 'grid-group' && objs[i].id !== 'grid-line' && !objs[i].isPreview) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) {
      localStorage.removeItem(AUTOSAVE_KEY);
      localStorage.removeItem(AUTOSAVE_TIME_KEY);
      return;
    }
    try {
      var projectData = {
        canvas: canvas.toJSON(CUSTOM_PROPS),
        layers: typeof getLayersData === 'function' ? getLayersData() : [],
        crossLayerConnections: typeof getCrossLayerConnections === 'function' ? getCrossLayerConnections() : [],
        sealedNodes: Array.from(window.sealedNodes || [])
      };
      var json = JSON.stringify(projectData);
      localStorage.setItem(AUTOSAVE_KEY, json);
      localStorage.setItem(AUTOSAVE_TIME_KEY, new Date().toISOString());
    } catch (e) {
      console.warn('Автосохранение не удалось:', e.message);
    }
  }

  var debouncedAutoSave = debounce(autoSaveDrawing, 2000);

  function restoreFromAutoSave() {
    var json = localStorage.getItem(AUTOSAVE_KEY);
    if (!json) return;
    try {
      restoreCanvasFromJSON(json);
      showNotification('Схема восстановлена из автосохранения', 'success');
    } catch (e) {
      showNotification('Ошибка восстановления: ' + e.message, 'error');
      clearAutoSave();
    }
  }

  function hasAutoSave() {
    return !!localStorage.getItem(AUTOSAVE_KEY);
  }

  function getAutoSaveTime() {
    return localStorage.getItem(AUTOSAVE_TIME_KEY);
  }

  function clearAutoSave() {
    localStorage.removeItem(AUTOSAVE_KEY);
    localStorage.removeItem(AUTOSAVE_TIME_KEY);
  }

  // Экспорт
  global.autoSaveDrawing = autoSaveDrawing;
  global.debouncedAutoSave = debouncedAutoSave;
  global.restoreFromAutoSave = restoreFromAutoSave;
  global.hasAutoSave = hasAutoSave;
  global.getAutoSaveTime = getAutoSaveTime;
  global.clearAutoSave = clearAutoSave;

})(window);
