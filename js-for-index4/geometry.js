// geometry.js — Геометрические функции
(function(global) {
  'use strict';

  function getObjectCenter(obj) {
    return {
      x: roundTo5(obj.left),
      y: roundTo5(obj.top),
      width: roundTo5(obj.width * obj.scaleX),
      height: roundTo5(obj.height * obj.scaleY)
    };
  }

  function getObjectRect(obj) {
    const w = obj.width * obj.scaleX;
    const h = obj.height * obj.scaleY;
    return {
      left: roundTo5(obj.left - w / 2),
      right: roundTo5(obj.left + w / 2),
      top: roundTo5(obj.top - h / 2),
      bottom: roundTo5(obj.top + h / 2)
    };
  }

  function getLineAbsoluteEndpoints(line) {
    const scaleX = parseFloat(line.scaleX) || 1;
    const scaleY = parseFloat(line.scaleY) || 1;
    const rawX1 = (parseFloat(line.x1) || 0) * scaleX;
    const rawY1 = (parseFloat(line.y1) || 0) * scaleY;
    const rawX2 = (parseFloat(line.x2) || 0) * scaleX;
    const rawY2 = (parseFloat(line.y2) || 0) * scaleY;
    const baseX = (parseFloat(line.left) || 0) - Math.min(rawX1, rawX2);
    const baseY = (parseFloat(line.top) || 0) - Math.min(rawY1, rawY2);
    return {
      x1: roundTo5(baseX + rawX1),
      y1: roundTo5(baseY + rawY1),
      x2: roundTo5(baseX + rawX2),
      y2: roundTo5(baseY + rawY2)
    };
  }

  function findClosestPointOnLine(point, line) {
    const { x1, y1, x2, y2 } = getLineAbsoluteEndpoints(line);
    const A = point.x - x1;
    const B = point.y - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = lenSq === 0 ? 0 : dot / lenSq;
    param = Math.max(0, Math.min(1, param));
    const xx = x1 + param * C;
    const yy = y1 + param * D;
    const dist = Math.hypot(xx - point.x, yy - point.y);
    return {
      x: roundTo5(xx),
      y: roundTo5(yy),
      param: roundTo5(param),
      distance: roundTo5(dist)
    };
  }

  function findClosestPointOnObjectEdge(obj, point) {
    const rect = getObjectRect(obj);
    const { left, right, top, bottom } = rect;
    const inside = point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
    if (inside) {
      const dl = Math.abs(point.x - left);
      const dr = Math.abs(point.x - right);
      const dt = Math.abs(point.y - top);
      const db = Math.abs(point.y - bottom);
      const min = Math.min(dl, dr, dt, db);
      if (min === dl) return { x: left, y: point.y, edge: 'left' };
      if (min === dr) return { x: right, y: point.y, edge: 'right' };
      if (min === dt) return { x: point.x, y: top, edge: 'top' };
      return { x: point.x, y: bottom, edge: 'bottom' };
    } else {
      let x = Math.max(left, Math.min(point.x, right));
      let y = Math.max(top, Math.min(point.y, bottom));
      const dl = Math.abs(point.x - left);
      const dr = Math.abs(point.x - right);
      const dt = Math.abs(point.y - top);
      const db = Math.abs(point.y - bottom);
      const min = Math.min(dl, dr, dt, db);
      if (min === dl || min === dr) y = point.y;
      else x = point.x;
      x = Math.max(left, Math.min(x, right));
      y = Math.max(top, Math.min(y, bottom));
      return { x: roundTo5(x), y: roundTo5(y), edge: 'nearest' };
    }
  }

  function findObjectsNearPoint(x, y, threshold) {
    threshold = threshold || 40;
    const images = getCachedImages();
    return images.filter(function(img) {
      const center = getObjectCenter(img);
      return Math.hypot(center.x - x, center.y - y) < threshold;
    });
  }

  function lineIntersection(l1, l2) {
    const e1 = getLineAbsoluteEndpoints(l1);
    const e2 = getLineAbsoluteEndpoints(l2);
    const x1 = e1.x1, y1 = e1.y1, x2 = e1.x2, y2 = e1.y2;
    const x3 = e2.x1, y3 = e2.y1, x4 = e2.x2, y4 = e2.y2;
    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (Math.abs(denom) < 1e-9) return null;
    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
    if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
      const x = x1 + ua * (x2 - x1);
      const y = y1 + ua * (y2 - y1);
      return {
        x: roundTo5(x),
        y: roundTo5(y),
        ua,
        ub,
        line1: l1,
        line2: l2,
        type: 'line-line'
      };
    }
    return null;
  }

  // Экспорт
  global.getObjectCenter = getObjectCenter;
  global.getObjectRect = getObjectRect;
  global.getLineAbsoluteEndpoints = getLineAbsoluteEndpoints;
  global.findClosestPointOnLine = findClosestPointOnLine;
  global.findClosestPointOnObjectEdge = findClosestPointOnObjectEdge;
  global.findObjectsNearPoint = findObjectsNearPoint;
  global.lineIntersection = lineIntersection;
})(window);
