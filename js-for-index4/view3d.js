// view3d.js — 3D-визуализация шахтной вентиляционной сети на Three.js
// Читает данные через window-функции (getCachedLines, getCachedImages, getLayers,
// getCrossLayerConnections, getExportRows, intersectionVisuals, AIR_MODEL_CONFIG)
// и строит Three.js-сцену в отдельном canvas-оверлее.
//
// Публичный API:
//   init3DView()      — подцепить UI (кнопки, ползунки), подписки на события
//   open3DView()      — показать оверлей, инициализировать рендерер (ленивая),
//                        собрать сцену из текущего состояния
//   close3DView()     — скрыть оверлей (рендерер не уничтожается — экономия GPU)
//   rebuild3DScene()  — dispose старого контента и пересобрать из текущего состояния

(function (global) {
  'use strict';

  // ============ СОСТОЯНИЕ ============
  var _scene = null;
  var _camera = null;
  var _renderer = null;
  var _controls = null;
  var _sceneRoot = null;          // Group — пересобирается при rebuild
  var _labelsRoot = null;         // Group для Sprite-лейблов узлов
  var _animId = null;
  var _resizeObserver = null;
  var _initialized = false;       // создан ли рендерер
  var _overlayVisible = false;

  var _state = {
    zExaggeration: 3,             // усиление перепада высот между горизонтами
    radiusScale: 1,               // множитель радиуса труб
    showNodeLabels: false,
    colorByFlow: true,
    pxPerMeter: 1                 // MVP: 1 пиксель холста = 1 метр
  };

  // Цвета объектов по типу
  var OBJECT_COLORS = {
    fan: 0xf0a500,
    valve: 0xe85454,
    atmosphere: 0x4f9aff,
    fire: 0xff6b2b,
    'default': 0x999999
  };

  var PIPE_COLOR_DEFAULT = 0x7b8aab;
  var SHAFT_COLOR = 0x2ed573;

  // ============ УТИЛИТЫ ============

  function _isTHREEReady() {
    return typeof THREE !== 'undefined' && typeof THREE.Scene === 'function';
  }

  function _getLayers() {
    return (typeof getLayers === 'function') ? getLayers() : [];
  }

  function _getLayerElevation(layerId) {
    if (typeof getLayerElevation === 'function') return getLayerElevation(layerId);
    var layers = _getLayers();
    var layer = layers.find(function (l) { return l.id === layerId; });
    return (layer && typeof layer.elevation === 'number') ? layer.elevation : 0;
  }

  // Y-координата горизонта (метры * zExaggeration). Отрицательный elevation (глубина) → низ.
  function _getLayerY(layerId) {
    return _getLayerElevation(layerId) * _state.zExaggeration;
  }

  // Радиус трубы по площади сечения (m²).
  // Простая модель: r = sqrt(S/π). Для формы сечения в MVP коррекция не применяется —
  // это задел на v2.
  function _pipeRadius(crossArea) {
    var s = parseFloat(crossArea) || 0;
    if (s <= 0) return 0.6 * _state.radiusScale; // фолбэк для линий без площади
    var r = Math.sqrt(s / Math.PI);
    return r * _state.radiusScale;
  }

  // Получить Map: lineId → { flow, velocity } из последнего расчёта (если был)
  function _getFlowMap() {
    var map = new Map();
    if (typeof getExportRows !== 'function') return map;
    try {
      var rows = getExportRows();
      rows.forEach(function (row) {
        if (row && row.id) map.set(row.id, { flow: row.flow || 0, velocity: row.velocity || 0 });
      });
    } catch (e) { /* ignore */ }
    return map;
  }

  // HSL-интерполяция: синий (240°) → красный (0°) по t∈[0..1]
  function _flowColor(t) {
    t = Math.max(0, Math.min(1, t));
    var hue = (1 - t) * 240; // 240 (син.) → 0 (кр.)
    var col = new THREE.Color();
    col.setHSL(hue / 360, 0.75, 0.5);
    return col;
  }

  // Sprite-лейбл из canvas-текстуры
  function _makeLabelSprite(text) {
    var pad = 4;
    var fontSize = 40;
    var cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 64;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(20,24,38,0.9)';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#4f9aff';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, cv.width - 2, cv.height - 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold ' + fontSize + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(text), cv.width / 2, cv.height / 2);

    var tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    var mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    var sp = new THREE.Sprite(mat);
    sp.userData.isNodeLabel = true;
    // Привязан к масштабу сцены, ~8 м в ширину
    sp.scale.set(8, 4, 1);
    return sp;
  }

  // ============ ЖЁСТКАЯ ОЧИСТКА ============

  function _disposeObject(obj) {
    if (!obj) return;
    obj.traverse(function (child) {
      if (child.geometry && typeof child.geometry.dispose === 'function') {
        child.geometry.dispose();
      }
      if (child.material) {
        var mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(function (m) {
          if (m.map && typeof m.map.dispose === 'function') m.map.dispose();
          if (typeof m.dispose === 'function') m.dispose();
        });
      }
    });
  }

  // ============ ИНИЦИАЛИЗАЦИЯ РЕНДЕРЕРА ============

  function _initRenderer() {
    if (_initialized) return true;
    if (!_isTHREEReady()) {
      console.error('[view3d] THREE.js не загружен');
      return false;
    }
    var canvas = document.getElementById('view3dCanvas');
    if (!canvas) {
      console.error('[view3d] canvas#view3dCanvas не найден');
      return false;
    }

    _renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    _renderer.setClearColor(0x0a0e1a, 1);

    _scene = new THREE.Scene();
    _scene.fog = new THREE.Fog(0x0a0e1a, 400, 1800);

    // Свет
    var ambient = new THREE.AmbientLight(0xffffff, 0.55);
    _scene.add(ambient);
    var dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(200, 400, 200);
    _scene.add(dir);
    var dir2 = new THREE.DirectionalLight(0x88aaff, 0.35);
    dir2.position.set(-200, -100, -200);
    _scene.add(dir2);

    // Камера — размеры подставим в resize()
    _camera = new THREE.PerspectiveCamera(55, 1, 0.5, 5000);
    _camera.position.set(120, 120, 220);

    // OrbitControls
    if (THREE.OrbitControls) {
      _controls = new THREE.OrbitControls(_camera, _renderer.domElement);
      _controls.enableDamping = true;
      _controls.dampingFactor = 0.08;
      _controls.screenSpacePanning = true;
      _controls.maxPolarAngle = Math.PI * 0.95;
      _controls.minDistance = 1;
      _controls.maxDistance = 3000;
    } else {
      console.warn('[view3d] THREE.OrbitControls не найден');
    }

    // Группы для контента
    _sceneRoot = new THREE.Group();
    _sceneRoot.name = 'sceneRoot';
    _scene.add(_sceneRoot);

    _labelsRoot = new THREE.Group();
    _labelsRoot.name = 'labelsRoot';
    _scene.add(_labelsRoot);

    // Вспомогательная сетка и оси (привязаны к сцене отдельно, не в sceneRoot)
    var grid = new THREE.GridHelper(500, 50, 0x303854, 0x1c2135);
    grid.position.y = 0;
    grid.name = 'grid';
    _scene.add(grid);

    var axes = new THREE.AxesHelper(40);
    axes.name = 'axes';
    _scene.add(axes);

    _resize();
    _startLoop();
    _observeResize();

    _initialized = true;
    return true;
  }

  function _resize() {
    if (!_renderer || !_camera) return;
    var canvas = _renderer.domElement;
    var parent = canvas.parentElement;
    var w = parent ? parent.clientWidth : window.innerWidth;
    var h = parent ? parent.clientHeight : window.innerHeight;
    _renderer.setSize(w, h, false);
    _camera.aspect = w / Math.max(1, h);
    _camera.updateProjectionMatrix();
  }

  function _observeResize() {
    if (_resizeObserver) return;
    var canvas = _renderer.domElement;
    var parent = canvas.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', _resize);
      return;
    }
    _resizeObserver = new ResizeObserver(_resize);
    _resizeObserver.observe(parent);
  }

  function _startLoop() {
    if (_animId !== null) return;
    var tick = function () {
      _animId = requestAnimationFrame(tick);
      if (!_overlayVisible) return; // не рендерим когда скрыто
      if (_controls) _controls.update();
      _renderer.render(_scene, _camera);
    };
    _animId = requestAnimationFrame(tick);
  }

  function _stopLoop() {
    if (_animId !== null) {
      cancelAnimationFrame(_animId);
      _animId = null;
    }
  }

  // ============ ПОСТРОЕНИЕ СЦЕНЫ ============

  function _clearSceneContent() {
    if (_sceneRoot) {
      // снять все потомки и освободить ресурсы
      while (_sceneRoot.children.length) {
        var ch = _sceneRoot.children[0];
        _sceneRoot.remove(ch);
        _disposeObject(ch);
      }
    }
    if (_labelsRoot) {
      while (_labelsRoot.children.length) {
        var lb = _labelsRoot.children[0];
        _labelsRoot.remove(lb);
        _disposeObject(lb);
      }
    }
  }

  // Создать cylinder между точками a=(x,y,z) и b=(x,y,z)
  function _makeCylinderBetween(a, b, radius, material) {
    var v = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    var len = v.length();
    if (len < 0.0001) return null;
    var geom = new THREE.CylinderGeometry(radius, radius, len, 14, 1, false);
    var mesh = new THREE.Mesh(geom, material);
    // CylinderGeometry ориентирован вдоль +Y. Поворачиваем его к направлению v.
    var up = new THREE.Vector3(0, 1, 0);
    var dir = v.clone().normalize();
    var quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    mesh.quaternion.copy(quat);
    // Центр — середина отрезка
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return mesh;
  }

  // Центр 2D-схемы — нужен для центрирования 3D-сцены
  function _computeSceneCenter(lines, images) {
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    (lines || []).forEach(function (line) {
      if (typeof getLineAbsoluteEndpoints !== 'function') return;
      var ep = getLineAbsoluteEndpoints(line);
      if (!ep) return;
      minX = Math.min(minX, ep.x1, ep.x2);
      maxX = Math.max(maxX, ep.x1, ep.x2);
      minZ = Math.min(minZ, ep.y1, ep.y2);
      maxZ = Math.max(maxZ, ep.y1, ep.y2);
    });
    (images || []).forEach(function (img) {
      if (typeof getObjectCenter !== 'function') return;
      var c = getObjectCenter(img);
      if (!c) return;
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minZ = Math.min(minZ, c.y);
      maxZ = Math.max(maxZ, c.y);
    });
    if (!isFinite(minX)) return { cx: 0, cz: 0, span: 100 };
    return {
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
      span: Math.max(maxX - minX, maxZ - minZ, 50)
    };
  }

  var _sceneCenter = { cx: 0, cz: 0, span: 100 };

  // 2D (x, y) → 3D (x, y_world, z) с центрированием
  function _toWorld(px, py, yWorld) {
    var x = (px - _sceneCenter.cx) * _state.pxPerMeter;
    var z = (py - _sceneCenter.cz) * _state.pxPerMeter;
    return new THREE.Vector3(x, yWorld, z);
  }

  // Трубы: каждая line → Cylinder между endpoints на высоте своего слоя
  function _buildPipes(flowMap) {
    if (typeof getCachedLines !== 'function') return;
    var lines = getCachedLines() || [];
    if (!lines.length) return;

    // max |Q| для нормализации цвета
    var maxQ = 0;
    if (_state.colorByFlow) {
      flowMap.forEach(function (v) { maxQ = Math.max(maxQ, Math.abs(v.flow || 0)); });
      if (maxQ < 1e-6) maxQ = 1; // деление на 0
    }

    lines.forEach(function (line) {
      if (typeof getLineAbsoluteEndpoints !== 'function') return;
      var ep = getLineAbsoluteEndpoints(line);
      if (!ep) return;
      var props = line.properties || {};
      var layerId = props.layerId || 'default';
      var yL = _getLayerY(layerId);
      var r = _pipeRadius(props.crossSectionalArea);
      if (r < 0.05) r = 0.05;

      var a = _toWorld(ep.x1, ep.y1, yL);
      var b = _toWorld(ep.x2, ep.y2, yL);

      var color = PIPE_COLOR_DEFAULT;
      if (_state.colorByFlow) {
        var fm = flowMap.get(line.id);
        if (fm && maxQ > 0) {
          var t = Math.min(1, Math.abs(fm.flow) / maxQ);
          color = _flowColor(t).getHex();
        }
      }

      var mat = new THREE.MeshPhongMaterial({
        color: color,
        shininess: 30,
        specular: 0x222233
      });
      var pipe = _makeCylinderBetween(a, b, r, mat);
      if (pipe) {
        pipe.userData.lineId = line.id;
        _sceneRoot.add(pipe);
      }

      // Шаровые заглушки в концах (красиво на стыках)
      var capGeom = new THREE.SphereGeometry(r * 1.02, 12, 10);
      var cap1 = new THREE.Mesh(capGeom, mat);
      cap1.position.copy(a);
      _sceneRoot.add(cap1);
      var cap2 = new THREE.Mesh(capGeom.clone(), mat);
      cap2.position.copy(b);
      _sceneRoot.add(cap2);
    });
  }

  // Вертикальные стволы: cross-layer-точки соединяют горизонты с min по max elevation
  function _buildCrossLayerShafts() {
    if (typeof getCrossLayerConnections !== 'function') return;
    var pts = getCrossLayerConnections() || [];
    if (!pts.length) return;
    var layers = _getLayers();
    if (!layers.length) return;

    var elevs = layers.map(function (l) { return _getLayerElevation(l.id); });
    var yMin = Math.min.apply(null, elevs) * _state.zExaggeration;
    var yMax = Math.max.apply(null, elevs) * _state.zExaggeration;
    if (Math.abs(yMax - yMin) < 0.0001) {
      // Все слои на одной высоте — стволы не нужны, но покажем короткий маркер
      yMin -= 5;
      yMax += 5;
    }

    var mat = new THREE.MeshPhongMaterial({
      color: SHAFT_COLOR,
      transparent: true,
      opacity: 0.55,
      shininess: 40
    });

    pts.forEach(function (p) {
      var a = _toWorld(p.x, p.y, yMin);
      var b = _toWorld(p.x, p.y, yMax);
      var shaft = _makeCylinderBetween(a, b, 1.6 * _state.radiusScale, mat);
      if (shaft) {
        shaft.userData.crossLayer = true;
        _sceneRoot.add(shaft);
      }
    });
  }

  // 3D-маркеры объектов
  function _buildObjects() {
    if (typeof getCachedImages !== 'function') return;
    var imgs = getCachedImages() || [];
    imgs.forEach(function (img) {
      if (typeof getObjectCenter !== 'function') return;
      var c = getObjectCenter(img);
      if (!c) return;
      var props = img.properties || {};
      var type = props.type || 'default';
      var layerId = props.layerId || 'default';
      var yL = _getLayerY(layerId);
      var color = OBJECT_COLORS[type] || OBJECT_COLORS['default'];

      var geom, size = 2.8 * _state.radiusScale;
      if (type === 'fan') {
        geom = new THREE.ConeGeometry(size, size * 2, 18);
      } else if (type === 'valve') {
        geom = new THREE.BoxGeometry(size * 1.6, size * 1.6, size * 1.6);
      } else if (type === 'atmosphere') {
        geom = new THREE.SphereGeometry(size * 1.2, 18, 14);
      } else if (type === 'fire') {
        geom = new THREE.IcosahedronGeometry(size * 1.3, 0);
      } else {
        geom = new THREE.BoxGeometry(size * 1.3, size * 1.3, size * 1.3);
      }

      var mat = new THREE.MeshPhongMaterial({
        color: color,
        emissive: new THREE.Color(color).multiplyScalar(0.15),
        shininess: 50
      });
      var mesh = new THREE.Mesh(geom, mat);
      var pos = _toWorld(c.x, c.y, yL);
      mesh.position.copy(pos);
      // Поднять маркер чуть над трубой
      mesh.position.y += size * 0.6;
      mesh.userData.objectType = type;
      _sceneRoot.add(mesh);
    });
  }

  // Лейблы узлов — Sprite с номерами из intersectionVisuals
  function _buildNodeLabels() {
    if (!_state.showNodeLabels) return;
    if (typeof intersectionVisuals === 'undefined' || !Array.isArray(intersectionVisuals)) return;
    if (!intersectionVisuals.length) return;

    intersectionVisuals.forEach(function (v, i) {
      if (!v || !v.circle) return;
      var radius = v.circle.radius || 6;
      var cx = (v.circle.left || 0) + radius;
      var cy = (v.circle.top || 0) + radius;
      var number = (typeof v.circle.pointIndex === 'number' ? v.circle.pointIndex : i) + 1;

      // Узел может принадлежать линиям разных слоёв — берём высоту 0 по умолчанию,
      // но если рядом есть линия — используем её layerId.
      var y = 0;
      try {
        if (typeof getCachedLines === 'function') {
          var lines = getCachedLines();
          var nearLine = lines.find(function (line) {
            if (typeof getLineAbsoluteEndpoints !== 'function') return false;
            var ep = getLineAbsoluteEndpoints(line);
            return Math.hypot(ep.x1 - cx, ep.y1 - cy) < 15
                || Math.hypot(ep.x2 - cx, ep.y2 - cy) < 15;
          });
          if (nearLine && nearLine.properties) {
            y = _getLayerY(nearLine.properties.layerId || 'default');
          }
        }
      } catch (e) { /* ignore */ }

      var sp = _makeLabelSprite(number);
      var pos = _toWorld(cx, cy, y);
      sp.position.copy(pos);
      sp.position.y += 6; // подняв над трубой
      _labelsRoot.add(sp);
    });
  }

  // Сообщение "Пустая схема"
  function _showEmptyHint(show) {
    var body = document.querySelector('.view3d-body');
    if (!body) return;
    var existing = body.querySelector('.view3d-empty');
    if (show) {
      if (!existing) {
        var el = document.createElement('div');
        el.className = 'view3d-empty';
        el.innerHTML = '<div class="view3d-empty-icon">⛏</div><div>Нарисуйте схему в 2D, затем откройте 3D-вид</div>';
        body.appendChild(el);
      }
    } else {
      if (existing) existing.remove();
    }
  }

  function rebuildScene() {
    if (!_initialized) {
      if (!_initRenderer()) return;
    }
    _clearSceneContent();

    var lines = (typeof getCachedLines === 'function') ? (getCachedLines() || []) : [];
    var imgs = (typeof getCachedImages === 'function') ? (getCachedImages() || []) : [];

    if (!lines.length && !imgs.length) {
      _showEmptyHint(true);
      return;
    }
    _showEmptyHint(false);

    _sceneCenter = _computeSceneCenter(lines, imgs);

    var flowMap = _getFlowMap();
    _buildPipes(flowMap);
    _buildCrossLayerShafts();
    _buildObjects();
    _buildNodeLabels();

    // Подстроить камеру на первое открытие сцены
    _fitCameraToScene();
  }

  function _fitCameraToScene() {
    if (!_scene || !_camera || !_sceneRoot) return;
    if (!_sceneRoot.children.length) return;
    var box = new THREE.Box3().setFromObject(_sceneRoot);
    if (box.isEmpty()) return;
    var size = new THREE.Vector3();
    var center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    var maxDim = Math.max(size.x, size.y, size.z, 20);
    var dist = maxDim * 1.6;
    _camera.position.set(center.x + dist * 0.6, center.y + dist * 0.7, center.z + dist * 0.9);
    if (_controls) {
      _controls.target.copy(center);
      _controls.update();
    } else {
      _camera.lookAt(center);
    }
  }

  // ============ ПУБЛИЧНЫЕ ФУНКЦИИ ============

  function open3DView() {
    var overlay = document.getElementById('view3dOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    _overlayVisible = true;

    // Ленивая инициализация Three.js — только при первом открытии
    if (!_initialized) {
      // Таймаут, чтобы браузер применил display:flex → размер родителя стал корректным
      setTimeout(function () {
        if (_initRenderer()) rebuildScene();
      }, 30);
    } else {
      _resize();
      rebuildScene();
    }
  }

  function close3DView() {
    var overlay = document.getElementById('view3dOverlay');
    if (overlay) overlay.style.display = 'none';
    _overlayVisible = false;
    // Рендерер не уничтожаем — повторное открытие будет мгновенным
  }

  function init3DView() {
    // Ползунки и чекбоксы
    var zExag = document.getElementById('v3d_zExag');
    var zExagVal = document.getElementById('v3d_zExagVal');
    if (zExag) {
      zExag.addEventListener('input', function () {
        _state.zExaggeration = parseFloat(zExag.value) || 1;
        if (zExagVal) zExagVal.textContent = zExag.value;
        if (_overlayVisible) rebuildScene();
      });
    }

    var radius = document.getElementById('v3d_radius');
    var radiusVal = document.getElementById('v3d_radiusVal');
    if (radius) {
      radius.addEventListener('input', function () {
        _state.radiusScale = parseFloat(radius.value) || 1;
        if (radiusVal) radiusVal.textContent = radius.value;
        if (_overlayVisible) rebuildScene();
      });
    }

    var labelsChk = document.getElementById('v3d_labels');
    if (labelsChk) {
      labelsChk.addEventListener('change', function () {
        _state.showNodeLabels = labelsChk.checked;
        if (_overlayVisible) rebuildScene();
      });
    }

    var colorChk = document.getElementById('v3d_colorByFlow');
    if (colorChk) {
      colorChk.addEventListener('change', function () {
        _state.colorByFlow = colorChk.checked;
        if (_overlayVisible) rebuildScene();
      });
    }

    var rebuildBtn = document.getElementById('view3dRebuildBtn');
    if (rebuildBtn) rebuildBtn.addEventListener('click', function () { rebuildScene(); });

    // Esc — закрыть
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _overlayVisible) {
        close3DView();
      }
    });

    // Перестройка при пересчёте воздуха (событие диспатчит main5.js / solver-обёртка)
    document.addEventListener('calc:done', function () {
      if (_overlayVisible) rebuildScene();
    });

    // Перестройка при изменении слоёв (elevation, порядок и т.д.)
    document.addEventListener('layers:changed', function () {
      if (_overlayVisible) rebuildScene();
    });
  }

  // ============ ЭКСПОРТ ============
  global.init3DView = init3DView;
  global.open3DView = open3DView;
  global.close3DView = close3DView;
  global.rebuild3DScene = rebuildScene;

  // Автоинициализация UI после DOM-ready (main5.js может стартовать раньше/позже нас)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init3DView);
  } else {
    init3DView();
  }

})(window);
