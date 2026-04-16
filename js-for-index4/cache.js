// cache.js — Кэширование объектов и пространственная индексация
(function(global) {
  'use strict';

  function invalidateCache() {
    cacheDirty = true;
    spatialGridDirty = true;
  }

  function getCachedObjects() {
    if (!cacheDirty && cachedAllObjects) {
      return { lines: cachedLines, images: cachedImages, all: cachedAllObjects };
    }
    const allObjects = canvas.getObjects();
    cachedAllObjects = allObjects;
    cachedLines = [];
    cachedImages = [];
    for (let obj of allObjects) {
      if (obj.type === 'line' && obj.id !== 'grid-line' && !obj.isPreview) {
        cachedLines.push(obj);
      } else if (obj.type === 'image' && obj.properties) {
        cachedImages.push(obj);
      }
    }
    cacheDirty = false;
    performanceMetrics.objectCount = allObjects.length;
    return { lines: cachedLines, images: cachedImages, all: cachedAllObjects };
  }

  function getCachedLines() {
    if (!cacheDirty && cachedLines) return cachedLines;
    getCachedObjects();
    return cachedLines;
  }

  function getCachedImages() {
    if (!cacheDirty && cachedImages) return cachedImages;
    getCachedObjects();
    return cachedImages;
  }

  function updateSpatialGrid() {
    if (!spatialGridDirty) return;
    spatialGrid.clear();
    const lines = getCachedLines();
    lines.forEach(function(line, idx) {
      const endpoints = getLineAbsoluteEndpoints(line);
      const minX = Math.min(endpoints.x1, endpoints.x2);
      const maxX = Math.max(endpoints.x1, endpoints.x2);
      const minY = Math.min(endpoints.y1, endpoints.y2);
      const maxY = Math.max(endpoints.y1, endpoints.y2);
      const startX = Math.floor(minX / APP_CONFIG.SPATIAL_GRID_SIZE);
      const endX = Math.floor(maxX / APP_CONFIG.SPATIAL_GRID_SIZE);
      const startY = Math.floor(minY / APP_CONFIG.SPATIAL_GRID_SIZE);
      const endY = Math.floor(maxY / APP_CONFIG.SPATIAL_GRID_SIZE);
      for (let x = startX; x <= endX; x++) {
        for (let y = startY; y <= endY; y++) {
          const key = x + ',' + y;
          if (!spatialGrid.has(key)) spatialGrid.set(key, []);
          spatialGrid.get(key).push(idx);
        }
      }
    });
    spatialGridDirty = false;
  }

  function findLinesInArea(x, y, radius) {
    radius = radius || APP_CONFIG.SNAP_RADIUS;
    updateSpatialGrid();
    const cellX = Math.floor(x / APP_CONFIG.SPATIAL_GRID_SIZE);
    const cellY = Math.floor(y / APP_CONFIG.SPATIAL_GRID_SIZE);
    const lines = getCachedLines();
    const result = [];
    const checked = new Set();

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = (cellX + dx) + ',' + (cellY + dy);
        const cellIndices = spatialGrid.get(key);
        if (cellIndices) {
          for (let idx of cellIndices) {
            if (!checked.has(idx)) {
              checked.add(idx);
              const line = lines[idx];
              const closest = findClosestPointOnLine({ x: x, y: y }, line);
              const dist = Math.hypot(x - closest.x, y - closest.y);
              if (dist < radius) {
                result.push({
                  line: line,
                  point: closest,
                  param: closest.param,
                  distance: dist
                });
              }
            }
          }
        }
      }
    }
    result.sort(function(a, b) { return a.distance - b.distance; });
    return result;
  }

  function scheduleRender() {
    if (renderTimeout) cancelAnimationFrame(renderTimeout);
    renderTimeout = requestAnimationFrame(function() {
      canvas.renderAll();
      renderTimeout = null;
    });
  }

  // Экспорт
  global.invalidateCache = invalidateCache;
  global.getCachedObjects = getCachedObjects;
  global.getCachedLines = getCachedLines;
  global.getCachedImages = getCachedImages;
  global.updateSpatialGrid = updateSpatialGrid;
  global.findLinesInArea = findLinesInArea;
  global.scheduleRender = scheduleRender;
})(window);
