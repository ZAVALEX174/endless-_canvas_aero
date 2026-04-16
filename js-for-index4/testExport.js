// testExport.js – облегчённый экспорт схемы для тестирования/отладки
// Сохраняет только данные линий, объектов и результатов расчёта (без сетки и Fabric.js мусора)

(function(global) {
  'use strict';

  /**
   * Собирает данные всех линий (ветвей) с их свойствами и координатами
   */
  function collectLineData() {
    const lines = typeof getCachedLines === 'function' ? getCachedLines() : [];
    return lines.map(line => {
      const p = line.properties || {};
      const endpoints = typeof getLineAbsoluteEndpoints === 'function'
        ? getLineAbsoluteEndpoints(line)
        : null;

      return {
        id: line.id || '',
        name: p.name || '',
        // Координаты концов
        x1: endpoints ? roundTo5(endpoints.x1) : null,
        y1: endpoints ? roundTo5(endpoints.y1) : null,
        x2: endpoints ? roundTo5(endpoints.x2) : null,
        y2: endpoints ? roundTo5(endpoints.y2) : null,
        // Входные параметры
        input: {
          passageLength: roundTo5(parseFloat(p.passageLength) || 0),
          crossSectionalArea: roundTo5(parseFloat(p.crossSectionalArea) || 0),
          sectionType: p.sectionType || '',
          supportType: p.supportType || '',
          roughnessCoefficient: roundTo5(parseFloat(p.roughnessCoefficient) || 0)
        },
        // Расчётные промежуточные
        calculated: {
          perimeter: roundTo5(parseFloat(p.perimeter) || 0),
          xFactor: roundTo5(parseFloat(p.xFactor) || 0),
          baseResistance: roundTo5(parseFloat(p.baseResistance) || 0),
          localObjectResistance: roundTo5(parseFloat(p.localObjectResistance) || 0),
          deltaCoefficient: roundTo5(parseFloat(p.deltaCoefficient) || 0),
          totalResistance: roundTo5(parseFloat(p.totalResistance) || 0)
        },
        // Результаты расчёта воздуха
        results: {
          airVolume: roundTo5(parseFloat(p.airVolume) || 0),
          velocity: roundTo5(parseFloat(p.velocity) || 0),
          depression: roundTo5(parseFloat(p.depression) || 0)
        },
        // Привязанные объекты
        attachedObjects: p.attachedObjects || ''
      };
    });
  }

  /**
   * Собирает данные всех объектов (изображений) с их свойствами и позицией
   */
  function collectObjectData() {
    const images = typeof getCachedImages === 'function' ? getCachedImages() : [];
    return images.map(img => {
      const p = img.properties || {};
      const center = typeof getObjectCenter === 'function'
        ? getObjectCenter(img)
        : { x: img.left || 0, y: img.top || 0 };

      const data = {
        id: img.id || '',
        name: p.name || '',
        type: p.type || 'default',
        // Позиция на канвасе
        x: roundTo5(center.x),
        y: roundTo5(center.y),
        // Общие параметры
        airVolume: roundTo5(parseFloat(p.airVolume) || 0),
        airResistance: roundTo5(parseFloat(p.airResistance) || 0)
      };

      // Тип-специфичные поля
      if (p.type === 'fan') {
        data.fanMode = p.fanMode || 'supply';
        data.isFlowSource = !!p.isFlowSource;
      }
      if (p.type === 'valve') {
        data.doorMode = p.doorMode || 'open';
        data.windowArea = p.windowArea || '';
      }
      if (p.type === 'atmosphere') {
        data.atmosphereHeight = parseFloat(p.atmosphereHeight) || 0;
        data.atmosphereTemp1 = parseFloat(p.atmosphereTemp1) || 0;
        data.atmosphereTemp2 = parseFloat(p.atmosphereTemp2) || 0;
        data.atmosphereSign = parseFloat(p.atmosphereSign) || 1;
        data.naturalDraftPa = roundTo5(parseFloat(p.naturalDraftPa) || 0);
      }

      return data;
    });
  }

  /**
   * Собирает топологию сети (какие линии к каким узлам подключены)
   */
  function collectTopology() {
    const lines = typeof getCachedLines === 'function' ? getCachedLines() : [];
    const nodes = {};

    lines.forEach(line => {
      const endpoints = typeof getLineAbsoluteEndpoints === 'function'
        ? getLineAbsoluteEndpoints(line)
        : null;
      if (!endpoints) return;

      const key1 = typeof getPointKey === 'function'
        ? getPointKey(endpoints.x1, endpoints.y1)
        : `${Math.round(endpoints.x1)}_${Math.round(endpoints.y1)}`;
      const key2 = typeof getPointKey === 'function'
        ? getPointKey(endpoints.x2, endpoints.y2)
        : `${Math.round(endpoints.x2)}_${Math.round(endpoints.y2)}`;

      if (!nodes[key1]) nodes[key1] = { x: endpoints.x1, y: endpoints.y1, lines: [] };
      if (!nodes[key2]) nodes[key2] = { x: endpoints.x2, y: endpoints.y2, lines: [] };

      nodes[key1].lines.push(line.properties?.name || line.id);
      nodes[key2].lines.push(line.properties?.name || line.id);
    });

    return Object.entries(nodes).map(([key, node]) => ({
      nodeKey: key,
      x: roundTo5(node.x),
      y: roundTo5(node.y),
      degree: node.lines.length,
      connectedLines: node.lines
    }));
  }

  /**
   * Главная функция — экспорт тестовых данных
   */
  global.exportTestData = function() {
    const lines = collectLineData();
    const objects = collectObjectData();
    const topology = collectTopology();

    // Результаты расчёта (если был запущен)
    const calc = typeof global.getLastCalculationResult === 'function'
      ? global.getLastCalculationResult()
      : null;

    const testData = {
      _format: 'test-export-v1',
      _exportDate: new Date().toISOString(),
      _description: 'Облегчённый экспорт для тестирования расчёта вентсети',

      // Сводка
      summary: {
        totalLines: lines.length,
        totalObjects: objects.length,
        totalNodes: topology.length,
        calculationDone: !!calc
      },

      // Метрики расчёта (если есть)
      metrics: calc ? {
        totalSourceFlow: roundTo5(calc.totalSourceFlow || 0),
        networkDepressionPa: roundTo5(calc.networkDepressionPa || 0),
        naturalDraftPa: roundTo5(calc.naturalDraftPa || 0),
        requiredFanPressurePa: roundTo5(calc.requiredFanPressurePa || 0)
      } : null,

      // Данные
      lines: lines,
      objects: objects,
      topology: topology
    };

    // Скачать JSON
    const json = JSON.stringify(testData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-data_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Также копировать в буфер обмена (удобно для вставки в чат)
    if (navigator.clipboard) {
      navigator.clipboard.writeText(json).then(() => {
        showNotification(`Тестовые данные экспортированы (${lines.length} ветвей, ${objects.length} объектов) + скопированы в буфер`, 'success');
      }).catch(() => {
        showNotification(`Тестовые данные экспортированы (${lines.length} ветвей, ${objects.length} объектов)`, 'success');
      });
    } else {
      showNotification(`Тестовые данные экспортированы (${lines.length} ветвей, ${objects.length} объектов)`, 'success');
    }
  };

})(window);
