// uiTheme.js — Переключение светлой/тёмной темы
(function(global) {
  'use strict';

  var STORAGE_KEY = 'aero4_theme';

  function getTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'dark';
  }

  function getCSSVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function applyCanvasTheme() {
    if (typeof canvas === 'undefined' || !canvas) return;

    var bg = getCSSVar('--canvas-bg');
    var gridColor = getCSSVar('--canvas-grid');
    var selColor = getCSSVar('--canvas-selection');
    var selBorder = getCSSVar('--canvas-selection-border');
    var textFill = getCSSVar('--canvas-text-fill');
    var textBg = getCSSVar('--canvas-text-bg');
    var imgShadow = getCSSVar('--image-shadow-color');

    canvas.set('backgroundColor', bg);
    canvas.set('selectionColor', selColor);
    canvas.set('selectionBorderColor', selBorder);

    // Update grid lines
    canvas.getObjects().forEach(function(obj) {
      if (obj.id === 'grid-group') {
        var lines = obj.getObjects ? obj.getObjects() : [];
        lines.forEach(function(line) {
          line.set('stroke', gridColor);
        });
      }
      // Update air volume text labels
      if (obj.id === 'air-volume-text') {
        obj.set('fill', textFill);
        obj.set('textBackgroundColor', textBg);
      }
      // Update image shadows
      if (obj.type === 'image') {
        obj.set('shadow', new fabric.Shadow({
          color: imgShadow, blur: 6, offsetX: 0, offsetY: 0
        }));
      }
    });

    canvas.requestRenderAll();
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
    applyCanvasTheme();
    // Пересоздать все текстовые метки Q с новыми цветами
    if (typeof updateAllAirVolumeTexts === 'function') updateAllAirVolumeTexts();
    // Перерисовать сетку с новым цветом
    if (typeof drawGrid === 'function' && typeof gridVisible !== 'undefined' && gridVisible) {
      drawGrid(typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.GRID_SIZE : 20);
    }

    // Update toggle button icon
    var btn = document.getElementById('themeToggleBtn');
    if (btn) {
      var svg = btn.querySelector('svg');
      if (svg) {
        if (theme === 'light') {
          svg.innerHTML = '<circle cx="9" cy="9" r="4"/><path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.3 3.3l1.4 1.4M13.3 13.3l1.4 1.4M3.3 14.7l1.4-1.4M13.3 4.7l1.4-1.4"/>';
        } else {
          svg.innerHTML = '<path d="M15 10.5A6.5 6.5 0 0 1 7.5 3a6.5 6.5 0 1 0 7.5 7.5z"/>';
        }
      }
    }
  }

  function toggleTheme() {
    var current = getTheme();
    setTheme(current === 'dark' ? 'light' : 'dark');
  }

  function initTheme() {
    var theme = getTheme();
    document.documentElement.setAttribute('data-theme', theme);
    // Canvas will be updated after it's created via applyCanvasTheme
  }

  // Apply immediately (before DOMContentLoaded) to avoid flash
  initTheme();

  global.toggleTheme = toggleTheme;
  global.setTheme = setTheme;
  global.applyCanvasTheme = applyCanvasTheme;
  global.initTheme = initTheme;

})(window);
