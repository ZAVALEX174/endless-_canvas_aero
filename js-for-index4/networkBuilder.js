(function(global) {

function buildNetworkGraph(options = {}) {
  const lines = getCachedLines();
  const images = options.includeObjects ? getCachedImages() : [];
  const nodes = new Map();
  const edges = new Map();

  lines.forEach(line => {
    const endpoints = getLineAbsoluteEndpoints(line);
    // ВАЖНО: ключи узлов формируются через getPointKey (utils.js), чтобы
    // совпадать со всеми остальными потребителями connectionNodes
    // (canvasSetup drag intersection-point, sealedNodes, splitLineAtPoint и др.).
    // Раньше использовался roundTo5 (5 знаков) → при дробных координатах
    // ключ в connectionNodes не совпадал с getPointKey (2 знака) — драг точки
    // пересечения переставал тащить за собой линии.
    const startKey = getPointKey(endpoints.x1, endpoints.y1);
    const endKey = getPointKey(endpoints.x2, endpoints.y2);

    if (!nodes.has(startKey)) {
      nodes.set(startKey, {
        id: startKey,
        x: roundTo5(endpoints.x1),
        y: roundTo5(endpoints.y1),
        incomingEdges: [],
        outgoingEdges: [],
        objects: []
      });
    }
    if (!nodes.has(endKey)) {
      nodes.set(endKey, {
        id: endKey,
        x: roundTo5(endpoints.x2),
        y: roundTo5(endpoints.y2),
        incomingEdges: [],
        outgoingEdges: [],
        objects: []
      });
    }

    const resistance = line.properties && line.properties.airResistance ? line.properties.airResistance : 0;
    const edge = {
      id: line.id,
      line,
      fromNode: startKey,
      toNode: endKey,
      resistance: resistance,
      flow: 0
    };
    edges.set(line.id, edge);

    nodes.get(startKey).outgoingEdges.push(edge);
    nodes.get(endKey).incomingEdges.push(edge);
  });

  if (options.includeObjects) {
    images.forEach(img => {
      const center = getObjectCenter(img);
      let bestNode = null;
      let minDist = 50;
      nodes.forEach(node => {
        const dist = Math.hypot(node.x - center.x, node.y - center.y);
        if (dist < minDist) {
          minDist = dist;
          bestNode = node;
        }
      });
      if (bestNode) {
        const airVolume = img.properties && img.properties.airVolume ? img.properties.airVolume : 0;
        const airResistance = img.properties && img.properties.airResistance ? img.properties.airResistance : 0;
        bestNode.objects.push({
          object: img,
          airVolume: airVolume,
          airResistance: airResistance
        });
      }
    });
  }

  if (options.includeLockedInfo) {
    nodes.forEach(node => {
      node.locked = nodeLockEnabled && (node.incomingEdges.length + node.outgoingEdges.length > 1);
    });
  }

  return { nodes, edges };
}

function updateConnectionGraph() {
  if (isUpdatingConnections) return;
  isUpdatingConnections = true;
  if (updateGraphTimeout) clearTimeout(updateGraphTimeout);
  updateGraphTimeout = setTimeout(() => {
    try {
      const { nodes } = buildNetworkGraph({ includeLockedInfo: true });
      window.connectionNodes = new Map();
      nodes.forEach((node, key) => {
        // Включаем ВСЕ узлы (вкл. степени 1) — drag синего endpoint-маркера
        // должен тащить линию. Раньше degree-1 были исключены из connectionNodes,
        // поэтому drag не находил узел и кружок отрывался от линии.
        // isPointInLockedNode/Delete-проверки фильтруют по node.locked отдельно,
        // так что добавление degree-1 нелоченных узлов их не задевает.
        if (node.incomingEdges.length + node.outgoingEdges.length >= 1) {
          window.connectionNodes.set(key, node);
        }
      });
      bringIntersectionPointsToFront();
      buildLineChains();
    } catch (e) {
      console.error('updateConnectionGraph error', e);
    } finally {
      isUpdatingConnections = false;
      updateGraphTimeout = null;
    }
  }, 100);
}

function collectNetworkAttachmentInfo() {
  // Исключить объекты и линии на скрытых слоях
  const lines = getCachedLines().filter(l => l.visible !== false);
  const images = getCachedImages().filter(img => img.visible !== false);
  const pointMap = new Map();
  const lineObjectMap = new Map();

  const _calcKey = typeof getCalcNodeKey === 'function' ? getCalcNodeKey : getPointKey;

  lines.forEach(line => {
    const endpoints = getLineAbsoluteEndpoints(line);
    const layerId = (line.properties && line.properties.layerId) || 'default';
    const startKey = _calcKey(endpoints.x1, endpoints.y1, layerId);
    const endKey   = _calcKey(endpoints.x2, endpoints.y2, layerId);

    if (!pointMap.has(startKey)) {
      pointMap.set(startKey, {
        x: roundTo5(endpoints.x1),
        y: roundTo5(endpoints.y1),
        layerId: layerId,
        objects: [],
        startLines: [],
        endLines: []
      });
    }
    if (!pointMap.has(endKey)) {
      pointMap.set(endKey, {
        x: roundTo5(endpoints.x2),
        y: roundTo5(endpoints.y2),
        layerId: layerId,
        objects: [],
        startLines: [],
        endLines: []
      });
    }

    pointMap.get(startKey).startLines.push(line);
    pointMap.get(endKey).endLines.push(line);
  });

  const NODE_ATTACH_THRESHOLD = 18;
  const LINE_ATTACH_THRESHOLD = 35;

  images.forEach(img => {
    const synced = synchronizeObjectDerivedProperties(img.properties || {});
    img.set('properties', synced);

    const center = getObjectCenter(img);

    let bestPoint = null;
    let bestPointDistance = Infinity;
    pointMap.forEach(point => {
      const dist = Math.hypot(point.x - center.x, point.y - center.y);
      if (dist < bestPointDistance) {
        bestPointDistance = dist;
        bestPoint = point;
      }
    });

    let bestLine = null;
    let bestClosest = null;
    let bestLineDistance = Infinity;
    lines.forEach(line => {
      const closest = findClosestPointOnLine(center, line);
      if (closest.distance < bestLineDistance) {
        bestLineDistance = closest.distance;
        bestLine = line;
        bestClosest = closest;
      }
    });

    const objectRecord = {
      object: img,
      airVolume: roundTo5(parseFloat(synced.airVolume) || 0),
      airResistance: roundTo5(parseFloat(synced.airResistance) || 0)
    };

    const catalogKey = inferCatalogKey(synced);
    // ВМП (isFlowSource=false) — ветвевой элемент, привязывается к линии, не к узлу
    const isLocalVentFan = synced.type === 'fan' && synced.isFlowSource === false;
    const preferNodeAttachment =
      (!isLocalVentFan && synced.type === 'fan') ||
      synced.type === 'atmosphere' ||
      (!isLocalVentFan && catalogKey === 'mainFan') ||
      (!isLocalVentFan && catalogKey === 'localFan') ||
      catalogKey === 'atmosphereLink';

    const attachToNode = !isLocalVentFan && !!bestPoint &&
      bestPointDistance <= NODE_ATTACH_THRESHOLD &&
      (
        preferNodeAttachment ||
        !bestClosest ||
        bestPointDistance <= bestClosest.distance + 2 ||
        bestClosest.param <= 0.05 ||
        bestClosest.param >= 0.95
      );

    // ВМП всегда привязывается к ветви (даже если стоит рядом с узлом)
    const attachToLine = !!bestLine && !!bestClosest && bestLineDistance <= LINE_ATTACH_THRESHOLD && (!preferNodeAttachment || isLocalVentFan);

    if (attachToLine) {
      if (!lineObjectMap.has(bestLine.id)) lineObjectMap.set(bestLine.id, []);
      lineObjectMap.get(bestLine.id).push({
        ...objectRecord,
        line: bestLine,
        point: {
          x: roundTo5(bestClosest.x),
          y: roundTo5(bestClosest.y),
          param: roundTo5(bestClosest.param),
          distance: roundTo5(bestClosest.distance)
        }
      });
      return;
    }

    if (attachToNode && bestPoint) {
      bestPoint.objects.push(objectRecord);
      return;
    }

    if (bestPoint) {
      bestPoint.objects.push(objectRecord);
    }
  });

  return { pointMap, lineObjectMap };
}

function collectPointInfoForChains() {
  return collectNetworkAttachmentInfo().pointMap;
}

function getStartingLinesFromPoint(point) {
  const { objects, startLines: sLines, endLines: eLines } = point;

  if (objects.length > 0) {
    return sLines.slice();
  }
  if (sLines.length >= 2) {
    return sLines.slice();
  }
  if (sLines.length === 1 && eLines.length === 0) {
    return [sLines[0]];
  }
  return [];
}

function buildLineChains(networkInfo = null) {
  const info = networkInfo || collectNetworkAttachmentInfo();
  const pointMap = info.pointMap;
  const lineObjectMap = info.lineObjectMap || new Map();
  const allLines = getCachedLines();
  const chains = [];
  let chainIdCounter = 0;

  const isDegenerateLine = (line) => {
    const endpoints = getLineAbsoluteEndpoints(line);
    return Math.hypot(endpoints.x2 - endpoints.x1, endpoints.y2 - endpoints.y1) < 0.5;
  };

  const buildAttachedObjectsForChain = (chainLines) => {
    const attached = [];
    chainLines.forEach(line => {
      const list = lineObjectMap.get(line.id) || [];
      list.forEach(obj => attached.push({
        ...obj,
        lineId: line.id
      }));
    });
    return attached;
  };

  const activeLines = allLines.filter(line => !isDegenerateLine(line));
  const lineEndpoints = new Map();
  const rawNodes = new Map();

  const ensureRawNode = (key, x, y) => {
    if (!rawNodes.has(key)) {
      const point = pointMap.get(key);
      rawNodes.set(key, {
        id: key,
        x: roundTo5(x),
        y: roundTo5(y),
        point,
        objects: point ? (point.objects || []).slice() : [],
        incident: []
      });
    }
    return rawNodes.get(key);
  };

  activeLines.forEach(line => {
    const endpoints = getLineAbsoluteEndpoints(line);
    const startKey = getPointKey(endpoints.x1, endpoints.y1);
    const endKey = getPointKey(endpoints.x2, endpoints.y2);
    lineEndpoints.set(line.id, {
      startKey,
      endKey,
      start: { x: roundTo5(endpoints.x1), y: roundTo5(endpoints.y1) },
      end: { x: roundTo5(endpoints.x2), y: roundTo5(endpoints.y2) }
    });

    ensureRawNode(startKey, endpoints.x1, endpoints.y1).incident.push({ line, otherKey: endKey });
    ensureRawNode(endKey, endpoints.x2, endpoints.y2).incident.push({ line, otherKey: startKey });
  });

  const specialNodes = new Set();
  rawNodes.forEach(node => {
    const hasObjects = (node.objects || []).length > 0;
    const hasSource = (node.objects || []).some(obj => getObjectSupplyContribution(obj.object?.properties || obj) > 0);
    if (node.incident.length !== 2 || hasObjects || hasSource) {
      specialNodes.add(node.id);
    }
  });

  if (specialNodes.size === 0 && rawNodes.size > 0) {
    const firstNode = rawNodes.keys().next().value;
    if (firstNode) specialNodes.add(firstNode);
  }

  const rawChains = [];
  const visitedLines = new Set();

  const pushRawChain = (segments, startSpecialKey, endSpecialKey) => {
    if (!segments.length) return;
    rawChains.push({
      id: `raw_chain_${rawChains.length}`,
      segments,
      startSpecialKey,
      endSpecialKey
    });
  };

  specialNodes.forEach(startSpecialKey => {
    const startNode = rawNodes.get(startSpecialKey);
    if (!startNode) return;

    startNode.incident.forEach(({ line, otherKey }) => {
      if (visitedLines.has(line.id)) return;

      const segments = [];
      let currentNodeKey = startSpecialKey;
      let nextNodeKey = otherKey;
      let currentLine = line;

      while (currentLine && !visitedLines.has(currentLine.id)) {
        visitedLines.add(currentLine.id);
        segments.push({
          line: currentLine,
          fromKey: currentNodeKey,
          toKey: nextNodeKey
        });

        if (specialNodes.has(nextNodeKey)) break;

        const nextNode = rawNodes.get(nextNodeKey);
        if (!nextNode) break;

        const nextCandidate = nextNode.incident.find(item => item.line.id !== currentLine.id && !visitedLines.has(item.line.id));
        if (!nextCandidate) break;

        currentNodeKey = nextNodeKey;
        nextNodeKey = nextCandidate.otherKey;
        currentLine = nextCandidate.line;
      }

      pushRawChain(segments, startSpecialKey, nextNodeKey);
    });
  });

  activeLines.forEach(line => {
    if (visitedLines.has(line.id)) return;
    const endpoints = lineEndpoints.get(line.id);
    if (!endpoints) return;
    pushRawChain([
      {
        line,
        fromKey: endpoints.startKey,
        toKey: endpoints.endKey
      }
    ], endpoints.startKey, endpoints.endKey);
    visitedLines.add(line.id);
  });

  const reducedAdjacency = new Map();
  const linkSpecialNodes = (fromKey, toKey, chainIndex) => {
    if (!reducedAdjacency.has(fromKey)) reducedAdjacency.set(fromKey, []);
    reducedAdjacency.get(fromKey).push({ chainIndex, otherKey: toKey });
  };

  rawChains.forEach((chain, index) => {
    linkSpecialNodes(chain.startSpecialKey, chain.endSpecialKey, index);
    linkSpecialNodes(chain.endSpecialKey, chain.startSpecialKey, index);
  });

  // ── Ориентация цепочек: по той же логике что в calculateAirFlows ───────
  // Источник = специальный узел с isFlowSource=true объектом.
  // Тупик (degree=1, нет объектов) = всегда конец цепочки.
  // BFS от источников по редуцированному графу спецузлов → ориентация.

  const isTrueDeadEndChain = (nodeId) => {
    const node = rawNodes.get(nodeId);
    if (!node) return false;
    return node.incident.length === 1 && (node.objects || []).length === 0;
  };

  // Источники среди спецузлов
  const sourceSpecialNodes = [];
  rawNodes.forEach(node => {
    if (!specialNodes.has(node.id)) return;
    const hasFlowSource = (node.objects || []).some(obj => {
      const p = obj.object?.properties || obj;
      return isFanObject(p) && p.isFlowSource !== false;
    });
    if (hasFlowSource) sourceSpecialNodes.push(node.id);
  });

  // BFS по редуцированному графу от источников
  const chainVisited = new Set();
  const chainBfsQueue = [];
  const chainFromMap = new Map(); // nodeId → приходит от какого узла

  if (sourceSpecialNodes.length > 0) {
    sourceSpecialNodes.forEach(id => { chainVisited.add(id); chainBfsQueue.push(id); });
  } else {
    // Нет явных источников → старт от НЕ-тупиков
    specialNodes.forEach(id => {
      if (!isTrueDeadEndChain(id)) { chainVisited.add(id); chainBfsQueue.push(id); }
    });
    if (chainBfsQueue.length === 0 && specialNodes.size > 0) {
      const fallback = specialNodes.values().next().value;
      chainVisited.add(fallback); chainBfsQueue.push(fallback);
    }
  }

  let cbi = 0;
  while (cbi < chainBfsQueue.length) {
    const cur = chainBfsQueue[cbi++];
    for (const { otherKey } of (reducedAdjacency.get(cur) || [])) {
      if (!chainVisited.has(otherKey)) {
        chainVisited.add(otherKey);
        chainFromMap.set(otherKey, cur);
        chainBfsQueue.push(otherKey);
      }
    }
  }

  // Для необнаруженных узлов — стартуем отдельно
  specialNodes.forEach(nodeId => {
    if (!chainVisited.has(nodeId)) {
      chainVisited.add(nodeId); chainBfsQueue.push(nodeId);
      let cbi2 = chainBfsQueue.indexOf(nodeId);
      while (cbi2 < chainBfsQueue.length) {
        const cur = chainBfsQueue[cbi2++];
        for (const { otherKey } of (reducedAdjacency.get(cur) || [])) {
          if (!chainVisited.has(otherKey)) {
            chainVisited.add(otherKey);
            chainFromMap.set(otherKey, cur);
            chainBfsQueue.push(otherKey);
          }
        }
      }
    }
  });

  // Определяем порядок BFS (индекс в очереди = «расстояние»)
  const chainBfsIndex = new Map();
  chainBfsQueue.forEach((id, idx) => chainBfsIndex.set(id, idx));

  rawChains.forEach(rawChain => {
    let segments = rawChain.segments.slice();
    let startKey = rawChain.startSpecialKey;
    let endKey = rawChain.endSpecialKey;

    const startIdx = chainBfsIndex.get(startKey) ?? Infinity;
    const endIdx   = chainBfsIndex.get(endKey)   ?? Infinity;

    // Разворачиваем цепочку если конец ближе к источнику чем начало
    if (endIdx < startIdx) {
      segments = segments.slice().reverse().map(segment => ({
        line: segment.line,
        fromKey: segment.toKey,
        toKey: segment.fromKey
      }));
      startKey = rawChain.endSpecialKey;
      endKey = rawChain.startSpecialKey;
    }

    const startNode = rawNodes.get(startKey);
    const endNode = rawNodes.get(endKey);
    const chainLines = segments.map(segment => segment.line);

    chains.push({
      id: `chain_${chainIdCounter++}`,
      lines: chainLines,
      directedSegments: segments,
      startNode: startNode ? { x: startNode.x, y: startNode.y } : { x: 0, y: 0 },
      endNode: endNode ? { x: endNode.x, y: endNode.y } : { x: 0, y: 0 },
      hasObjectAtStart: startNode ? (startNode.objects || []).length > 0 : false,
      hasObjectAtEnd: endNode ? (endNode.objects || []).length > 0 : false,
      attachedObjects: buildAttachedObjectsForChain(chainLines)
    });
  });

  lineChains = chains;
  window.lineChains = chains;
  window.lineToChainMap.clear();
  chains.forEach(chain => {
    chain.lines.forEach(line => {
      window.lineToChainMap.set(line.id, chain);
    });
  });

  return chains;
}

function buildLineToChainMap() {
  window.lineToChainMap.clear();
  for (let chain of lineChains) {
    for (let line of chain.lines) {
      window.lineToChainMap.set(line.id, chain);
    }
  }
}

// Export all functions to global scope
global.buildNetworkGraph = buildNetworkGraph;
global.updateConnectionGraph = updateConnectionGraph;
global.collectNetworkAttachmentInfo = collectNetworkAttachmentInfo;
global.collectPointInfoForChains = collectPointInfoForChains;
global.getStartingLinesFromPoint = getStartingLinesFromPoint;
global.buildLineChains = buildLineChains;
global.buildLineToChainMap = buildLineToChainMap;

})(window);
