// utils.js — Утилиты общего назначения
(function(global) {
  'use strict';

  function roundTo5(value) {
    if (value === null || value === undefined) return value;
    return Math.round((value + Number.EPSILON) * 100000) / 100000;
  }

  function formatTo5(value) {
    if (value === null || value === undefined) return '0.00000';
    return roundTo5(value).toFixed(5);
  }

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  function showNotification(msg, type, duration) {
    type = type || 'info';
    duration = duration || 3000;
    const container = document.getElementById('notificationContainer');
    if (!container) return;
    const notif = document.createElement('div');
    notif.textContent = msg;
    notif.className = 'notification ' + type;
    notif.style.cssText = 'display:block; opacity:1; margin-bottom:6px;';
    container.appendChild(notif);
    setTimeout(() => {
      notif.style.transition = 'opacity 0.3s';
      notif.style.opacity = '0';
      setTimeout(() => {
        if (notif.parentNode) notif.parentNode.removeChild(notif);
      }, 320);
    }, duration);
  }

  function getPointKey(x, y) {
    // Округляем до 2 знаков (0.01px) для ключа узла,
    // чтобы линии с минимальными расхождениями координат (из-за Fabric.js)
    // попадали в один узел
    var rx = Math.round(x * 100) / 100;
    var ry = Math.round(y * 100) / 100;
    return rx + '_' + ry;
  }

  // Экспорт
  global.roundTo5 = roundTo5;
  global.formatTo5 = formatTo5;
  global.debounce = debounce;
  global.throttle = throttle;
  global.showNotification = showNotification;
  global.getPointKey = getPointKey;
})(window);
