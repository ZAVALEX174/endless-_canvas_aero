// layersManager.js — Система слоёв
(function(global) {
  'use strict';

  // ==================== ДАННЫЕ ====================
  var layers = [
    { id: 'default', name: 'Основной', visible: true, locked: true, color: null }
  ];

  // id текущего активного слоя (новые объекты создаются на нём)
  var activeLayerId = 'default';

  // id слоя, перетаскиваемого в данный момент
  var _dragSrcId = null;

  // ==================== АКТИВНЫЙ СЛОЙ ====================

  function getActiveLayerId() { return activeLayerId; }

  function setActiveLayerId(id) {
    if (!layers.find(function(l) { return l.id === id; })) return;
    activeLayerId = id;
    renderLayersPanel();
  }

  // ==================== CRUD ====================

  function createLayer() {
    var num = layers.length + 1;
    var id = 'layer_' + Date.now();
    layers.push({ id: id, name: 'Слой ' + num, visible: true, locked: false, color: null });
    renderLayersPanel();
    populateLayerSelects();
    if (typeof saveToUndoStack === 'function') saveToUndoStack();
  }

  function renameLayer(id, newName) {
    var layer = layers.find(function(l) { return l.id === id; });
    if (!layer || !newName.trim()) return;
    layer.name = newName.trim();
    renderLayersPanel();
    populateLayerSelects();
  }

  function deleteLayer(id) {
    var idx = layers.findIndex(function(l) { return l.id === id; });
    if (idx === -1) return;
    if (layers[idx].locked) {
      if (typeof showNotification === 'function') showNotification('Основной слой нельзя удалить', 'error');
      return;
    }
    if (!confirm('Удалить слой? Объекты переместятся на «Основной».')) return;

    if (typeof canvas !== 'undefined' && canvas) {
      var deletedLayerVisible = layers[idx].visible;
      canvas.getObjects().forEach(function(obj) {
        if (obj.properties && obj.properties.layerId === id) {
          obj.properties.layerId = 'default';
          applyLayerColorToObject(obj);  // снимет тень (default без цвета) и восстановит тень изображений
          if (!deletedLayerVisible) {
            obj.set('visible', true);
            obj.set('selectable', true);
            obj.set('evented', true);
          }
        }
      });
      _syncAuxObjectVisibility();
      canvas.requestRenderAll();
    }

    layers.splice(idx, 1);
    if (activeLayerId === id) activeLayerId = 'default';
    renderLayersPanel();
    populateLayerSelects();
    if (typeof saveToUndoStack === 'function') saveToUndoStack();
  }

  function toggleLayerVisibility(id) {
    var layer = layers.find(function(l) { return l.id === id; });
    if (!layer) return;
    layer.visible = !layer.visible;
    // Если скрываем активный слой — переключаем активный на default
    if (!layer.visible && activeLayerId === id) activeLayerId = 'default';

    if (typeof canvas !== 'undefined' && canvas) {
      canvas.getObjects().forEach(function(obj) {
        if (obj.properties && obj.properties.layerId === id) {
          obj.set('visible', layer.visible);
          obj.set('selectable', layer.visible);
          obj.set('evented', layer.visible);
        }
      });
      if (!layer.visible) canvas.discardActiveObject();
      _syncAuxObjectVisibility();
      canvas.requestRenderAll();
    }
    renderLayersPanel();
  }

  // ==================== ЦВЕТ СЛОЯ ====================

  function setLayerColor(id, color) {
    var layer = layers.find(function(l) { return l.id === id; });
    if (!layer) return;
    // color = hex-строка или null (без цвета)
    layer.color = color || null;
    _applyLayerColorToObjects(id);
    renderLayersPanel();
    if (typeof saveToUndoStack === 'function') saveToUndoStack();
  }

  function _applyLayerColorToObjects(id) {
    var layer = layers.find(function(l) { return l.id === id; });
    if (!layer || typeof canvas === 'undefined' || !canvas) return;

    canvas.getObjects().forEach(function(obj) {
      if (!obj.properties || obj.properties.layerId !== id) return;
      if (layer.color) {
        obj.set('shadow', new fabric.Shadow({
          color: layer.color + 'aa',   // полупрозрачная подсветка
          blur: 14,
          offsetX: 0,
          offsetY: 0
        }));
      } else {
        // Восстановить стандартную тень для изображений или убрать совсем
        if (obj.type === 'image') {
          var defaultShadowColor = (typeof getCV === 'function'
            ? getCV('--image-shadow-color')
            : 'rgba(255,255,255,0.45)') || 'rgba(255,255,255,0.45)';
          obj.set('shadow', new fabric.Shadow({ color: defaultShadowColor, blur: 6, offsetX: 0, offsetY: 0 }));
        } else {
          obj.set('shadow', null);
        }
      }
    });
    canvas.requestRenderAll();
  }

  // Применить цвет слоя к одному объекту (также снимает тень при перемещении на слой без цвета)
  function applyLayerColorToObject(obj) {
    if (!obj.properties) return;
    var layer = layers.find(function(l) { return l.id === obj.properties.layerId; });
    if (layer && layer.color) {
      obj.set('shadow', new fabric.Shadow({
        color: layer.color + 'aa',
        blur: 14,
        offsetX: 0,
        offsetY: 0
      }));
    } else {
      // Снять цветовую тень; для изображений восстановить стандартную
      if (obj.type === 'image') {
        var defaultShadowColor = (typeof getCV === 'function'
          ? getCV('--image-shadow-color')
          : 'rgba(255,255,255,0.45)') || 'rgba(255,255,255,0.45)';
        obj.set('shadow', new fabric.Shadow({ color: defaultShadowColor, blur: 6, offsetX: 0, offsetY: 0 }));
      } else {
        obj.set('shadow', null);
      }
    }
  }

  // Применить цвета всех слоёв ко всем объектам на canvas (вызывается после загрузки)
  function applyAllLayerColors() {
    layers.forEach(function(layer) { _applyLayerColorToObjects(layer.id); });
    if (typeof canvas !== 'undefined' && canvas) canvas.requestRenderAll();
  }

  // Синхронизировать вспомогательные объекты (подписи Q и точки узлов) с видимостью линий
  function _syncAuxObjectVisibility() {
    if (typeof getCachedLines !== 'function' || typeof getLineAbsoluteEndpoints !== 'function') return;

    // Подписи расхода (line.airVolumeText): скрыть/показать вместе с линией
    getCachedLines().forEach(function(line) {
      if (line.airVolumeText) {
        line.airVolumeText.set('visible', line.visible !== false);
      }
    });

    // Точки и подписи узлов: скрыть если все линии в этой точке скрыты
    if (typeof intersectionVisuals !== 'undefined' && Array.isArray(intersectionVisuals)) {
      intersectionVisuals.forEach(function(visual) {
        if (!visual || !visual.circle) return;
        var radius = visual.circle.radius || 6;
        var cx = (visual.circle.left || 0) + radius;
        var cy = (visual.circle.top || 0) + radius;
        var hasVisibleLine = getCachedLines().some(function(line) {
          if (line.visible === false) return false;
          var ep = getLineAbsoluteEndpoints(line);
          return Math.hypot(ep.x1 - cx, ep.y1 - cy) < 15
              || Math.hypot(ep.x2 - cx, ep.y2 - cy) < 15;
        });
        visual.circle.set('visible', hasVisibleLine);
        if (visual.text) visual.text.set('visible', hasVisibleLine);
      });
    }
  }

  // ==================== DRAG-AND-DROP (порядок слоёв) ====================

  function _reorderLayer(fromId, toId) {
    if (fromId === toId) return;
    var fromIdx = layers.findIndex(function(l) { return l.id === fromId; });
    var toIdx   = layers.findIndex(function(l) { return l.id === toId; });
    // Нельзя перетащить или заменить 'default' (всегда idx 0)
    if (fromIdx <= 0 || toIdx <= 0) return;
    var moved = layers.splice(fromIdx, 1)[0];
    var newToIdx = layers.findIndex(function(l) { return l.id === toId; });
    layers.splice(newToIdx, 0, moved);
    renderLayersPanel();
    populateLayerSelects();
    if (typeof saveToUndoStack === 'function') saveToUndoStack();
  }

  // ==================== UI ====================

  function renderLayersPanel() {
    var list = document.getElementById('layersList');
    if (!list) return;
    list.innerHTML = '';

    layers.forEach(function(layer) {
      var item = document.createElement('div');
      item.className = 'layer-item';
      item.dataset.layerId = layer.id;
      var isActive = layer.id === activeLayerId;
      item.style.cssText = [
        'display:flex;align-items:center;gap:6px;padding:5px 4px;',
        'border-bottom:1px solid var(--color-border-light);',
        'border-left:3px solid ' + (isActive ? 'var(--color-accent,#4a9eff)' : 'transparent') + ';',
        'background:' + (isActive ? 'var(--color-accent-bg,rgba(74,158,255,0.10))' : 'transparent') + ';',
        'border-radius:4px;transition:background 0.15s;cursor:pointer;'
      ].join('');
      item.title = 'Кликните, чтобы выбрать активный слой';

      // Клик по строке (не по кнопкам) устанавливает активный слой
      item.addEventListener('click', (function(lid) {
        return function() { setActiveLayerId(lid); };
      })(layer.id));

      // ── Drag handle (только не-locked слои) ──
      if (!layer.locked) {
        item.draggable = true;
        item.style.cursor = 'grab';

        item.addEventListener('dragstart', function(e) {
          _dragSrcId = layer.id;
          e.dataTransfer.effectAllowed = 'move';
          item.style.opacity = '0.5';
        });
        item.addEventListener('dragend', function() {
          item.style.opacity = '1';
          // Убрать подсветку drop-target, но сохранить подсветку активного слоя
          list.querySelectorAll('.layer-item').forEach(function(el) {
            var lid = el.dataset.layerId;
            el.style.background = (lid === activeLayerId)
              ? 'var(--color-accent-bg,rgba(74,158,255,0.10))'
              : '';
          });
        });
        item.addEventListener('dragover', function(e) {
          if (_dragSrcId && _dragSrcId !== layer.id && !layer.locked) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            item.style.background = 'var(--color-hover)';
          }
        });
        item.addEventListener('dragleave', function() {
          item.style.background = '';
        });
        item.addEventListener('drop', function(e) {
          e.preventDefault();
          item.style.background = '';
          if (_dragSrcId && _dragSrcId !== layer.id) {
            _reorderLayer(_dragSrcId, layer.id);
          }
          _dragSrcId = null;
        });
      }

      // ── Глаз ──
      var eyeBtn = document.createElement('button');
      eyeBtn.className = 'toolbar-btn';
      eyeBtn.style.cssText = 'width:22px;height:22px;flex-shrink:0;opacity:' + (layer.visible ? '1' : '0.35') + ';';
      eyeBtn.title = layer.visible ? 'Скрыть слой' : 'Показать слой';
      eyeBtn.innerHTML = '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="9" cy="9" rx="7" ry="4.5"/><circle cx="9" cy="9" r="2"/></svg>';
      eyeBtn.onclick = (function(lid) { return function(e) { e.stopPropagation(); toggleLayerVisibility(lid); }; })(layer.id);

      // ── Цветовой кружок ──
      var colorDot = document.createElement('span');
      colorDot.style.cssText = [
        'display:inline-block;width:12px;height:12px;border-radius:50%;flex-shrink:0;',
        'border:1px solid var(--color-border);cursor:pointer;',
        'background:' + (layer.color || 'transparent') + ';',
        'position:relative;'
      ].join('');
      colorDot.title = layer.color ? 'Цвет слоя (клик — сменить, двойной клик — сбросить)' : 'Задать цвет слоя';

      // Скрытый input[type=color]
      var colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = layer.color || '#4a9eff';
      colorInput.style.cssText = 'position:absolute;opacity:0;width:1px;height:1px;pointer-events:none;';
      colorDot.appendChild(colorInput);

      colorDot.onclick = (function(lid, inp) {
        return function(e) {
          e.stopPropagation();
          inp.click();
        };
      })(layer.id, colorInput);

      colorDot.ondblclick = (function(lid) {
        return function(e) {
          e.stopPropagation();
          setLayerColor(lid, null);
        };
      })(layer.id);

      colorInput.addEventListener('change', (function(lid) {
        return function() { setLayerColor(lid, colorInput.value); };
      })(layer.id));

      // ── Имя ──
      var nameSpan = document.createElement('span');
      nameSpan.textContent = layer.name;
      nameSpan.style.cssText = [
        'flex:1;font-size:11px;color:var(--color-text-primary);',
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
        'cursor:' + (layer.locked ? 'default' : 'pointer') + ';'
      ].join('');

      if (!layer.locked) {
        nameSpan.title = 'Двойной клик — переименовать';
        nameSpan.ondblclick = (function(lid, span) {
          return function(e) {
            e.stopPropagation();
            var input = document.createElement('input');
            input.type = 'text';
            input.value = span.textContent;
            input.style.cssText = [
              'flex:1;font-size:11px;background:var(--color-hover);',
              'border:1px solid var(--color-accent);border-radius:3px;',
              'padding:0 4px;color:var(--color-text-primary);width:100%;'
            ].join('');
            span.replaceWith(input);
            input.focus();
            input.select();
            function commit() { renameLayer(lid, input.value || span.textContent); }
            input.onblur = commit;
            input.onkeydown = function(ev) {
              if (ev.key === 'Enter') { input.blur(); }
              if (ev.key === 'Escape') { input.value = span.textContent; input.blur(); }
            };
          };
        })(layer.id, nameSpan);
      }

      // ── Кнопка удаления ──
      item.appendChild(eyeBtn);
      item.appendChild(colorDot);
      item.appendChild(nameSpan);

      if (!layer.locked) {
        var delBtn = document.createElement('button');
        delBtn.className = 'toolbar-btn';
        delBtn.style.cssText = 'width:22px;height:22px;flex-shrink:0;color:var(--color-fire);';
        delBtn.title = 'Удалить слой';
        delBtn.innerHTML = '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3,5 15,5"/><path d="M6 5V3h6v2"/><path d="M14 5l-1 10H5L4 5"/></svg>';
        delBtn.onclick = (function(lid) { return function(e) { e.stopPropagation(); deleteLayer(lid); }; })(layer.id);
        item.appendChild(delBtn);
      }

      list.appendChild(item);
    });
  }

  // Заполнить select-ы выбора слоя во всех модалках
  function populateLayerSelects() {
    var selects = ['propertyLayer', 'objPropertyLayer'];
    selects.forEach(function(selId) {
      var sel = document.getElementById(selId);
      if (!sel) return;
      var current = sel.value;
      sel.innerHTML = '';
      layers.forEach(function(layer) {
        var opt = document.createElement('option');
        opt.value = layer.id;
        opt.textContent = layer.name;
        sel.appendChild(opt);
      });
      if (current && sel.querySelector('option[value="' + current + '"]')) {
        sel.value = current;
      }
    });
  }

  // ==================== СЕРИАЛИЗАЦИЯ ====================

  function getLayersData() {
    return JSON.parse(JSON.stringify(layers));
  }

  function setLayersData(data) {
    if (!Array.isArray(data) || !data.length) return;
    layers = data.map(function(l) {
      return {
        id:      l.id,
        name:    l.name,
        visible: l.visible !== false,
        locked:  !!l.locked,
        color:   l.color || null
      };
    });
    // Убедиться что default всегда есть первым
    var defIdx = layers.findIndex(function(l) { return l.id === 'default'; });
    if (defIdx === -1) {
      layers.unshift({ id: 'default', name: 'Основной', visible: true, locked: true, color: null });
    } else if (defIdx > 0) {
      var def = layers.splice(defIdx, 1)[0];
      layers.unshift(def);
    }
    layers[0].locked = true;
    renderLayersPanel();
    populateLayerSelects();
  }

  function getLayers() { return layers; }

  function isLayerVisible(layerId) {
    var layer = layers.find(function(l) { return l.id === layerId; });
    return !layer || layer.visible; // если слой не найден — считаем видимым
  }

  // ==================== ТОЧКИ СВЯЗИ СЛОЁВ ====================
  // crossLayerConnections: массив { x, y } — точки где все слои соединены в расчёте
  var crossLayerConnections = [];

  function getCrossLayerConnections() { return crossLayerConnections; }

  function setCrossLayerConnections(data) {
    crossLayerConnections = Array.isArray(data) ? data.map(function(p) { return { x: p.x, y: p.y }; }) : [];
    _renderCrossLayerMarkers();
  }

  function addCrossLayerConnection(x, y) {
    var snap = APP_CONFIG.SNAP_RADIUS || 10;
    // Если уже есть близкая точка — убрать (toggle)
    var existing = crossLayerConnections.findIndex(function(p) {
      return Math.hypot(p.x - x, p.y - y) < snap;
    });
    if (existing !== -1) {
      crossLayerConnections.splice(existing, 1);
    } else {
      crossLayerConnections.push({ x: x, y: y });
      // Автоматически разбиваем все линии всех слоёв, проходящие через эту точку,
      // чтобы в узле появился реальный endpoint — только тогда solver создаст общий узел
      _splitLinesAtCrossPoint(x, y);
    }
    _renderCrossLayerMarkers();
    if (typeof saveToUndoStack === 'function') saveToUndoStack();
  }

  // Разбивает все линии (любого слоя), проходящие через точку (x,y), если там нет конечной точки
  function _splitLinesAtCrossPoint(x, y) {
    if (typeof canvas === 'undefined' || !canvas) return;
    if (typeof splitLineAtPoint !== 'function') return;

    var allLines = canvas.getObjects().filter(function(obj) {
      return obj.type === 'line' && obj.id !== 'intersection-point';
    });

    var toProcess = allLines.filter(function(line) {
      if (typeof findClosestPointOnLine !== 'function') return false;
      var closest = findClosestPointOnLine({ x: x, y: y }, line);
      if (!closest || closest.distance > 10) return false;
      if (typeof getLineAbsoluteEndpoints !== 'function') return false;
      var ep = getLineAbsoluteEndpoints(line);
      var dStart = Math.hypot(x - ep.x1, y - ep.y1);
      var dEnd   = Math.hypot(x - ep.x2, y - ep.y2);
      return dStart >= 5 && dEnd >= 5; // не конечная точка
    });

    if (!toProcess.length) return;

    toProcess.forEach(function(line) {
      var result = splitLineAtPoint(line, { x: x, y: y });
      if (!result) return;
      canvas.remove(line);
      if (typeof removeAirVolumeText === 'function') removeAirVolumeText(line);
      canvas.add(result.line1);
      canvas.add(result.line2);
      if (typeof applyLayerColorToObject === 'function') {
        applyLayerColorToObject(result.line1);
        applyLayerColorToObject(result.line2);
      }
      if (typeof createOrUpdateAirVolumeText === 'function') {
        createOrUpdateAirVolumeText(result.line1);
        createOrUpdateAirVolumeText(result.line2);
      }
    });

    if (typeof invalidateCache === 'function') invalidateCache();
    if (typeof updateConnectionGraph === 'function') updateConnectionGraph();
  }

  function isCrossLayerPoint(x, y) {
    var snap = APP_CONFIG.SNAP_RADIUS || 10;
    return crossLayerConnections.some(function(p) {
      return Math.hypot(p.x - x, p.y - y) < snap;
    });
  }

  // Ключ узла для расчёта: в точках связи — общий (без суффикса), иначе — с @layerId
  function getCalcNodeKey(x, y, layerId) {
    var base = typeof getPointKey === 'function' ? getPointKey(x, y) : (Math.round(x * 100) / 100 + '_' + Math.round(y * 100) / 100);
    if (isCrossLayerPoint(x, y)) return base;
    return base + '@' + (layerId || 'default');
  }

  // Рисует зелёные маркеры точек связи на canvas
  function _renderCrossLayerMarkers() {
    if (typeof canvas === 'undefined' || !canvas) return;
    // Удалить старые
    var objs = canvas.getObjects();
    for (var i = objs.length - 1; i >= 0; i--) {
      if (objs[i].id === 'cross-layer-marker' || objs[i].id === 'cross-layer-label') {
        canvas.remove(objs[i]);
      }
    }
    // Добавить новые
    crossLayerConnections.forEach(function(p) {
      var r = 7;
      var circle = new fabric.Circle({
        left: p.x - r, top: p.y - r,
        radius: r, fill: 'rgba(46,213,115,0.85)', stroke: '#fff',
        strokeWidth: 1.5,
        selectable: false, evented: false,
        id: 'cross-layer-marker'
      });
      var label = new fabric.Text('\u2605', {   // ★
        left: p.x, top: p.y,
        fontSize: 9, fill: '#fff',
        originX: 'center', originY: 'center',
        selectable: false, evented: false,
        id: 'cross-layer-label'
      });
      canvas.add(circle);
      canvas.add(label);
      circle.bringToFront();
      label.bringToFront();
    });
    canvas.requestRenderAll();
  }

  // Перерисовать маркеры (вызывается после загрузки canvas)
  function refreshCrossLayerMarkers() { _renderCrossLayerMarkers(); }

  // ==================== ЭКСПОРТ ====================
  global.getActiveLayerId = getActiveLayerId;
  global.setActiveLayerId = setActiveLayerId;
  global.createLayer = createLayer;
  global.renameLayer = renameLayer;
  global.deleteLayer = deleteLayer;
  global.setLayerColor = setLayerColor;
  global.toggleLayerVisibility = toggleLayerVisibility;
  global.renderLayersPanel = renderLayersPanel;
  global.populateLayerSelects = populateLayerSelects;
  global.getLayersData = getLayersData;
  global.setLayersData = setLayersData;
  global.getLayers = getLayers;
  global.isLayerVisible = isLayerVisible;
  global.applyLayerColorToObject = applyLayerColorToObject;
  global.applyAllLayerColors = applyAllLayerColors;
  global.getCalcNodeKey = getCalcNodeKey;
  global.getCrossLayerConnections = getCrossLayerConnections;
  global.setCrossLayerConnections = setCrossLayerConnections;
  global.addCrossLayerConnection = addCrossLayerConnection;
  global.isCrossLayerPoint = isCrossLayerPoint;
  global.refreshCrossLayerMarkers = refreshCrossLayerMarkers;

})(window);
