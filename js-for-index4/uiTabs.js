// uiTabs.js — Переключение табов правой панели + легенда
(function(global) {
  'use strict';

  // Заголовки drawer'а для каждого таба
  var TAB_TITLES = {
    fans: 'Вентиляторы',
    structures: 'Сооружения',
    objects: 'Объекты',
    layers: 'Слои'
  };

  function _getProperties() { return document.getElementById('appProperties'); }
  function _getTitleEl() { return document.getElementById('panelDrawerTitle'); }

  function showPanelContent(target) {
    document.querySelectorAll('.panel-content').forEach(function(p) {
      p.hidden = true;
    });
    var panel = document.getElementById(target + '-content');
    if (panel) panel.hidden = false;

    // Обновить заголовок drawer'а
    var titleEl = _getTitleEl();
    if (titleEl) titleEl.textContent = TAB_TITLES[target] || '—';

    // Обновить активную иконку
    document.querySelectorAll('.panel-rail__btn').forEach(function(b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === target);
    });
  }

  function openPanel(target) {
    var props = _getProperties();
    if (!props) return;
    showPanelContent(target);
    props.classList.add('open');
    props.setAttribute('data-active-tab', target);
  }

  function closePanel() {
    var props = _getProperties();
    if (!props) return;
    props.classList.remove('open');
    props.removeAttribute('data-active-tab');
    document.querySelectorAll('.panel-rail__btn').forEach(function(b) {
      b.classList.remove('active');
    });
  }

  function togglePanel(target) {
    var props = _getProperties();
    if (!props) return;
    var currentlyOpen = props.classList.contains('open');
    var currentTab = props.getAttribute('data-active-tab');
    if (currentlyOpen && currentTab === target) {
      // Клик по той же иконке — закрыть
      closePanel();
    } else {
      // Клик по другой (или panel закрыт) — открыть/переключить
      openPanel(target);
    }
  }

  function initTabs() {
    // Биндим клики по иконкам рейла
    document.querySelectorAll('.panel-rail__btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var target = this.getAttribute('data-tab');
        if (target) togglePanel(target);
      });
    });

    // Кнопка «×» в шапке drawer'а
    var closeBtn = document.getElementById('panelDrawerClose');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    // Esc закрывает drawer (только когда нет открытой модалки)
    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape') return;
      var props = _getProperties();
      if (!props || !props.classList.contains('open')) return;
      var openModal = document.querySelector('.modal[style*="display: flex"]') ||
                      document.querySelector('.modal[style*="display:flex"]');
      if (openModal) return;
      closePanel();
    });

    // Инициализация: скрываем все панели, drawer закрыт
    document.querySelectorAll('.panel-content').forEach(function(p) { p.hidden = true; });
  }

  // Экспорт для внешнего кода
  global.openPanelTab = openPanel;
  global.closePanelTab = closePanel;
  global.togglePanelTab = togglePanel;

  function initLegend() {
    var toggle = document.querySelector('.canvas-legend__toggle');
    if (toggle) {
      toggle.addEventListener('click', function() {
        var legend = this.closest('.canvas-legend');
        if (legend) legend.classList.toggle('collapsed');
      });
    }
  }

  // Обновление координат курсора в статус-баре
  function initStatusBarCoords() {
    var coordsEl = document.getElementById('statusbar-coords');
    var zoomEl = document.getElementById('statusbar-zoom');
    if (!coordsEl || !zoomEl) return;

    // Слушаем mouse:move на canvas (canvas ещё не создан, подождём)
    var checkCanvas = setInterval(function() {
      if (typeof canvas !== 'undefined' && canvas) {
        clearInterval(checkCanvas);
        canvas.on('mouse:move', function(opt) {
          var pointer = canvas.getPointer(opt.e);
          coordsEl.textContent = 'x: ' + Math.round(pointer.x) + ' · y: ' + Math.round(pointer.y);
        });
        // Слушаем зум
        canvas.on('mouse:wheel', function() {
          var z = canvas.getZoom ? canvas.getZoom() : 1;
          zoomEl.textContent = 'Zoom: ' + Math.round(z * 100) + '%';
        });
      }
    }, 200);
  }

  // Автоматически устанавливаем title из data-tooltip + data-hotkey для нативных тултипов
  function initTooltips() {
    document.querySelectorAll('[data-tooltip]').forEach(function(el) {
      var text = el.getAttribute('data-tooltip');
      var hotkey = el.getAttribute('data-hotkey');
      el.title = hotkey ? text + ' (' + hotkey + ')' : text;
    });
  }

  global.initTabs = initTabs;
  global.initLegend = initLegend;
  global.initStatusBarCoords = initStatusBarCoords;
  global.initTooltips = initTooltips;

})(window);
