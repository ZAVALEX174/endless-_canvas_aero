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

  // ── Журнал уведомлений ────────────────────────────────────────────────
  // Хранит ВСЕ показанные уведомления с timestamp до явной очистки.
  // Доступ через global.getNotificationLog / global.clearNotificationLog
  // и UI — кнопка «Журнал» в тулбаре (см. modals.js / index.html).
  if (!global.notificationLog) global.notificationLog = [];
  const NOTIF_LOG_LIMIT = 500; // защита от взрывного роста — старые скидываем

  function showNotification(msg, type, duration) {
    type = type || 'info';
    // duration больше не используется для авто-скрытия — пользователь явно
    // попросил оставлять уведомления видимыми до ручного закрытия (×).
    // Параметр сохранён в сигнатуре для обратной совместимости.

    // 1) Логируем независимо от наличия контейнера
    try {
      global.notificationLog.push({ ts: Date.now(), msg: String(msg), type: String(type) });
      if (global.notificationLog.length > NOTIF_LOG_LIMIT) {
        global.notificationLog.splice(0, global.notificationLog.length - NOTIF_LOG_LIMIT);
      }
      // Инкрементируем счётчик-бейдж на кнопке журнала, если она есть
      const badge = document.getElementById('notificationLogBadge');
      if (badge) {
        const n = (parseInt(badge.textContent, 10) || 0) + 1;
        badge.textContent = String(n);
        badge.style.display = 'inline-block';
      }
    } catch (e) { /* ignore */ }

    const container = document.getElementById('notificationContainer');
    if (!container) return;

    // 2) Создаём блок: текст + крестик закрытия. БЕЗ таймера авто-скрытия —
    // удаление только по клику на ×.
    const notif = document.createElement('div');
    notif.className = 'notification ' + type;
    notif.style.cssText = 'display:flex; align-items:flex-start; gap:8px; opacity:1;';

    const text = document.createElement('div');
    text.className = 'notification-message';
    text.textContent = String(msg);
    text.style.flex = '1';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = [
      'background:none', 'border:none', 'cursor:pointer',
      'color:var(--color-text-secondary,#888)', 'font-size:18px',
      'line-height:1', 'padding:0 2px', 'margin-left:4px', 'flex-shrink:0'
    ].join(';');
    closeBtn.addEventListener('click', function() {
      notif.style.transition = 'opacity 0.2s';
      notif.style.opacity = '0';
      setTimeout(() => { if (notif.parentNode) notif.parentNode.removeChild(notif); }, 220);
    });

    notif.appendChild(text);
    notif.appendChild(closeBtn);
    container.appendChild(notif);
  }

  function getNotificationLog() {
    return (global.notificationLog || []).slice();
  }

  function clearNotificationLog() {
    global.notificationLog = [];
    const badge = document.getElementById('notificationLogBadge');
    if (badge) { badge.textContent = '0'; badge.style.display = 'none'; }
  }

  function dismissAllNotifications() {
    const container = document.getElementById('notificationContainer');
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  function getPointKey(x, y) {
    // Округляем до 2 знаков (0.01px) для ключа узла,
    // чтобы линии с минимальными расхождениями координат (из-за Fabric.js)
    // попадали в один узел
    var rx = Math.round(x * 100) / 100;
    var ry = Math.round(y * 100) / 100;
    return rx + '_' + ry;
  }

  // Экранирование HTML для безопасной вставки user-controlled данных в innerHTML.
  // Покрывает: < > & " ' — остальные символы безопасны в HTML-контексте.
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Фильтр URL для атрибута src: блокирует javascript:/vbscript:/data:text/html и т.п.
  // Возвращает пустую строку для опасных схем — браузер не сделает запрос.
  function safeAssetUrl(url) {
    if (!url) return '';
    var s = String(url).trim();
    if (/^javascript:/i.test(s)) return '';
    if (/^vbscript:/i.test(s)) return '';
    if (/^data:(?!image\/)/i.test(s)) return '';
    return s;
  }

  // Экспорт
  global.roundTo5 = roundTo5;
  global.formatTo5 = formatTo5;
  global.debounce = debounce;
  global.throttle = throttle;
  global.showNotification = showNotification;
  global.getNotificationLog = getNotificationLog;
  global.clearNotificationLog = clearNotificationLog;
  global.dismissAllNotifications = dismissAllNotifications;
  global.getPointKey = getPointKey;
  global.escapeHtml = escapeHtml;
  global.safeAssetUrl = safeAssetUrl;
})(window);
