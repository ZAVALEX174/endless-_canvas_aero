/**
 * airSolver.js — CORE calculation engine for the ventilation network.
 *
 * Extracted from main5.js without any logic modifications.
 * All functions rely on globals already present on `window`.
 */
(function(global) {

function calculateChainIntrinsicResistance(chain) {
  return roundTo5(chain.lines.reduce((sum, line) => {
    normalizeLineProperties(line);
    const r = parseFloat(line.properties?.airResistance) || 0;
    return sum + r;
  }, 0));
}

function calculateChainGeometryFactor(chain) {
  return roundTo5(chain.lines.reduce((sum, line) => {
    normalizeLineProperties(line);
    return sum + getLineGeometryFactor(line);
  }, 0));
}

// Пропагация дельта-коэффициентов объектов вниз по сети
function propagateDeltas(edges, nodes) {
  const deltaMemo = new Map();
  const computeEdgeDelta = (edge, stack = new Set()) => {
    if (deltaMemo.has(edge.id)) return deltaMemo.get(edge.id);
    if (stack.has(edge.id)) return (parseFloat(edge.localDeltaCoefficient) || 0);

    stack.add(edge.id);
    const endNode = nodes.get(edge.to);
    let delta = (parseFloat(edge.localDeltaCoefficient) || 0) + (parseFloat(endNode?.localDeltaCoefficient) || 0);

    for (const childEdge of (endNode?.outEdges || [])) {
      delta += computeEdgeDelta(childEdge, stack);
    }

    edge.propagatedDeltaCoefficient = delta;
    edge.totalResistance = (parseFloat(edge.baseResistance) || 0) + (parseFloat(edge.geometryFactor) || 0) * delta;
    edge.attachedObjects = edge.lineObjects
      .filter(obj => getObjectResistanceContribution(obj.object?.properties || obj) > 0)
      .map(obj => obj.object?.properties?.name || 'Объект');
    if ((parseFloat(edge.manualLocalObjectResistance) || 0) > 0) {
      edge.attachedObjects.unshift(`Ручной Robj ${formatTo5(edge.manualLocalObjectResistance)}`);
    }

    deltaMemo.set(edge.id, edge.propagatedDeltaCoefficient);
    stack.delete(edge.id);
    return edge.propagatedDeltaCoefficient;
  };

  edges.forEach(edge => computeEdgeDelta(edge));
}

// Топологическая сортировка узлов
function performTopologicalSort(nodes) {
  const inDegree = new Map();
  nodes.forEach((node, id) => inDegree.set(id, node.inEdges.length));

  const queue = [];
  nodes.forEach((node, id) => {
    if (inDegree.get(id) === 0) queue.push(id);
  });

  const topoOrder = [];
  while (queue.length) {
    const id = queue.shift();
    topoOrder.push(id);
    for (const edge of nodes.get(id).outEdges) {
      const childId = edge.to;
      inDegree.set(childId, inDegree.get(childId) - 1);
      if (inDegree.get(childId) === 0) queue.push(childId);
    }
  }

  if (topoOrder.length !== nodes.size) {
    showNotification('В сети есть цикл. Расчёт выполнен по максимально возможному ациклическому маршруту.', 'warning');
    const topoSet = new Set(topoOrder);
    nodes.forEach((_, id) => {
      if (!topoSet.has(id)) topoOrder.push(id);
    });
  }

  return topoOrder;
}

// Решение методом узловых потенциалов (Гаусс-Зейдель)
function solveNodePotentials(nodes, edges) {
  const allNodeIds = [...nodes.keys()];
  const nodeDegree = new Map();
  allNodeIds.forEach(id => nodeDegree.set(id, 0));
  edges.forEach(edge => {
    nodeDegree.set(edge.from, (nodeDegree.get(edge.from) || 0) + 1);
    nodeDegree.set(edge.to,   (nodeDegree.get(edge.to)   || 0) + 1);
  });

  const isSinkNode = (id) => {
    const node = nodes.get(id);
    if ((nodeDegree.get(id) || 0) !== 1 || (parseFloat(node?.sourceFlow) || 0) !== 0) return false;
    // Запечатанный тупик — не является свободным отверстием (не sink)
    if (window.sealedNodes && window.sealedNodes.has(id)) return false;
    return true;
  };

  const nodeEdgeMap = new Map();
  allNodeIds.forEach(id => nodeEdgeMap.set(id, []));
  edges.forEach(edge => {
    nodeEdgeMap.get(edge.from).push(edge);
    nodeEdgeMap.get(edge.to).push(edge);
  });

  const pressure = new Map();
  allNodeIds.forEach(id => {
    if (isSinkNode(id)) {
      pressure.set(id, 0);
    } else {
      const node = nodes.get(id);
      const srcQ = parseFloat(node?.sourceFlow) || 0;
      if (srcQ < 0) {
        pressure.set(id, -1.0);  // реверс (всасывание) — отрицательное давление
      } else if (srcQ > 0) {
        pressure.set(id, 1.0);   // подача — положительное давление
      } else {
        pressure.set(id, 0.0);   // промежуточный узел
      }
    }
  });

  const omega = AIR_MODEL_CONFIG.SOLVER_RELAXATION_OMEGA || 1.0;
  let solverIterations = 0;
  let solverConverged = false;
  let prevMaxChange = Infinity;
  const STAGNATION_WINDOW = 100;
  const STAGNATION_RATIO = 0.99;
  let stagnationCounter = 0;

  for (let gsIter = 0; gsIter < AIR_MODEL_CONFIG.SOLVER_MAX_ITERATIONS; gsIter++) {
    let maxChange = 0;
    for (const nodeId of allNodeIds) {
      if (isSinkNode(nodeId)) { pressure.set(nodeId, 0); continue; }
      const node = nodes.get(nodeId);
      const srcQ = parseFloat(node?.sourceFlow) || 0;
      const edgeList = nodeEdgeMap.get(nodeId) || [];
      if (!edgeList.length) continue;

      let sumCond = 0, rhs = srcQ;
      for (const edge of edgeList) {
        const R = Math.max(parseFloat(edge.totalResistance) || 0, AIR_MODEL_CONFIG.MIN_RESISTANCE);
        const cond = 1 / R;
        sumCond += cond;
        const neighborId = (nodeId === edge.from) ? edge.to : edge.from;
        rhs += cond * (pressure.get(neighborId) || 0);
      }
      if (sumCond <= 0) continue;
      const oldP = pressure.get(nodeId) || 0;
      const gaussSeidelP = rhs / sumCond;
      const newP = omega * gaussSeidelP + (1 - omega) * oldP;
      const change = Math.abs(newP - oldP);
      if (change > maxChange) maxChange = change;
      pressure.set(nodeId, newP);
    }
    solverIterations = gsIter + 1;
    if (maxChange < AIR_MODEL_CONFIG.SOLVER_TOLERANCE) {
      solverConverged = true;
      break;
    }
    // Раннее прерывание при стагнации: если за STAGNATION_WINDOW итераций
    // прогресс < 1%, солвер застрял (некорректная сеть или цикл)
    if (maxChange >= prevMaxChange * STAGNATION_RATIO) {
      stagnationCounter++;
      if (stagnationCounter >= STAGNATION_WINDOW) {
        showNotification(`Решатель остановлен: стагнация на итерации ${solverIterations} (maxChange=${maxChange.toExponential(2)}). Проверьте схему.`, 'warning');
        break;
      }
    } else {
      stagnationCounter = 0;
    }
    prevMaxChange = maxChange;
  }
  if (!solverConverged && stagnationCounter < STAGNATION_WINDOW) {
    showNotification(`Решатель не сошёлся за ${AIR_MODEL_CONFIG.SOLVER_MAX_ITERATIONS} итераций. Результат приближённый.`, 'warning');
  }

  // Вычисляем потоки из перепадов давления и переориентируем рёбра
  edges.forEach(edge => {
    const pFrom = pressure.get(edge.from) || 0;
    const pTo   = pressure.get(edge.to)   || 0;
    const R     = Math.max(parseFloat(edge.totalResistance) || 0, AIR_MODEL_CONFIG.MIN_RESISTANCE);
    const signedQ = (pFrom - pTo) / R;

    if (signedQ < 0) {
      const tmpId = edge.from; edge.from = edge.to; edge.to = tmpId;
      const tmpNode = edge.startNode; edge.startNode = edge.endNode; edge.endNode = tmpNode;
    }
    edge.flow = roundTo5(Math.abs(signedQ));
  });

  // Пересчитываем in/out списки узлов после переориентации
  nodes.forEach(node => { node.inEdges = []; node.outEdges = []; });
  edges.forEach(edge => {
    const fromNode = nodes.get(edge.from);
    const toNode   = nodes.get(edge.to);
    if (fromNode) fromNode.outEdges.push(edge);
    if (toNode)   toNode.inEdges.push(edge);
  });

  // Пост-обработка Кирхгофа УДАЛЕНА: масштабирование исходящих потоков в произвольном
  // порядке обхода узлов вызывало каскадное усиление ошибок (каждый следующий узел
  // наследовал уже искажённые потоки). Гаусс-Зейдель при сходимости сам обеспечивает
  // баланс; при расходимости принудительная коррекция ухудшала результат.

  nodes.forEach((node) => {
    node.totalInflow = roundTo5(
      (parseFloat(node.sourceFlow) || 0) +
      node.inEdges.reduce((sum, e) => sum + (parseFloat(e.flow) || 0), 0)
    );
  });

  return { solverIterations, solverConverged };
}

// Запись результатов расчёта в свойства линий
function writeFlowResults(edges) {
  edges.forEach(edge => {
    const flow = parseFloat(edge.flow) || 0;
    edge.depression = roundTo5((parseFloat(edge.totalResistance) || 0) * flow * flow);

    const p = edge.line.properties || {};
    const ownObjects = (edge.lineObjects || [])
      .filter(obj => getObjectResistanceContribution(obj.object?.properties || obj) > 0)
      .map(obj => {
        const name = obj.object?.properties?.name || 'Объект';
        const delta = getObjectResistanceContribution(obj.object?.properties || obj);
        return delta > 0 ? `${name} (Δ=${formatTo5(delta)})` : name;
      });

    p.sectionType = edge.hydraulicBase.sectionType;
    p.supportType = edge.hydraulicBase.supportType;
    p.roughnessCoefficient = edge.hydraulicBase.roughnessCoefficient;
    p.crossSectionalArea = edge.hydraulicBase.crossSectionalArea;
    p.passageLength = edge.hydraulicBase.passageLength;
    p.perimeter = edge.hydraulicBase.perimeter;
    p.xFactor = roundTo5(edge.hydraulicBase.xFactor);
    p.baseResistance = roundTo5(parseFloat(edge.baseResistance) || 0);
    p.airResistance = roundTo5(parseFloat(edge.baseResistance) || 0);
    p.deltaCoefficient = roundTo5(edge.propagatedDeltaCoefficient);
    p.localObjectResistance = roundTo5(edge.localDeltaCoefficient);
    p.objectResistance = roundTo5(edge.localDeltaCoefficient);
    p.totalResistance = roundTo5(edge.totalResistance);
    // Не перезаписывать значения зафиксированные вручную пользователем
    if (!p.manualOverride) {
      p.airVolume = roundTo5(flow);
      p.velocity = calculateAirVelocity(flow, p.crossSectionalArea);
    } else {
      if (p.manualFlow !== undefined) p.airVolume = roundTo5(p.manualFlow);
      if (p.manualVelocity !== undefined) p.velocity = roundTo5(p.manualVelocity);
      if (p.manualResistance !== undefined) p.totalResistance = roundTo5(p.manualResistance);
    }
    p.depression = calculateDepression(p.totalResistance, flow);
    p.branchTotalResistance = roundTo5(edge.totalResistance);
    p.branchDepression = roundTo5(edge.depression);
    p.startNode = edge.from;
    p.endNode = edge.to;
    p.attachedObjects = ownObjects.join(', ');
    edge.line.set('properties', p);
  });
}

// Расчёт итоговых метрик сети (Hсети, He, Hвент,тр)
function computeNetworkMetrics(nodes, edges, topoOrder) {
  const routeLoss = new Map();
  nodes.forEach((node, id) => {
    routeLoss.set(id, node.sourceFlow !== 0 || node.inEdges.length === 0 ? 0 : -Infinity);
  });

  for (const nodeId of topoOrder) {
    const currentLoss = routeLoss.get(nodeId);
    if (!Number.isFinite(currentLoss)) continue;
    const node = nodes.get(nodeId);
    for (const edge of node.outEdges) {
      if ((parseFloat(edge.flow) || 0) <= 0) continue;
      const candidate = currentLoss + edge.depression;
      if (candidate > (routeLoss.get(edge.to) || -Infinity)) {
        routeLoss.set(edge.to, candidate);
      }
    }
  }

  const sinkLosses = [];
  nodes.forEach((node, id) => {
    if (node.outEdges.every(edge => (parseFloat(edge.flow) || 0) <= 0)) {
      if (Number.isFinite(routeLoss.get(id))) sinkLosses.push(routeLoss.get(id));
    }
  });

  const networkDepressionPa = roundTo5(sinkLosses.length ? Math.max(...sinkLosses) : 0);
  const naturalDraftPa = roundTo5(
    Array.from(nodes.values()).reduce((sum, node) => sum + (parseFloat(node.naturalDraftPa) || 0), 0) +
    edges.reduce((sum, edge) => sum + (parseFloat(edge.directNaturalDraftPa) || 0), 0)
  );
  const requiredFanPressurePa = roundTo5(networkDepressionPa - naturalDraftPa);
  const totalSourceFlow = roundTo5(Array.from(nodes.values()).reduce((sum, node) => sum + (parseFloat(node.sourceFlow) || 0), 0));

  return { networkDepressionPa, naturalDraftPa, requiredFanPressurePa, totalSourceFlow };
}

// ==================== РАСЧЁТ ВОЗДУХА ПО ЛОГИКЕ EXCEL ====================
// Логика из файлов пользователя:
// 1) R ветви считается по собственной геометрии ветви.
// 2) В ветвь добавляется только ДЕЛЬТА от объектов, расположенных ниже по сети.
// 3) Для деления потока в точке используются только исходящие ветви из этой точки.
// 4) При объединении потоков входящие расходы суммируются.
function calculateAirFlows() {
  if (isCalculatingAirVolumes) {
    showNotification('Расчёт уже выполняется', 'warning');
    return false;
  }
  isCalculatingAirVolumes = true;

  try {
    clearSmokeVisualization();

    // Исключить линии на скрытых слоях (visible === false задаётся layersManager)
    const lines = getCachedLines().filter(l => l.visible !== false);
    if (!lines.length) {
      showNotification('Нет ветвей для расчёта', 'error');
      return false;
    }

    // Валидация входных данных
    const invalidLines = lines.filter(l => {
      const p = l.properties || {};
      return (parseFloat(p.crossSectionalArea) || 0) <= 0 || (parseFloat(p.passageLength) || 0) <= 0;
    });
    if (invalidLines.length > 0) {
      showNotification(`Внимание: ${invalidLines.length} ветвей с нулевой площадью или длиной. Результат может быть неточным.`, 'warning');
    }

    const networkInfo = collectNetworkAttachmentInfo();
    const pointMap = networkInfo.pointMap;
    const lineObjectMap = networkInfo.lineObjectMap || new Map();
    const nodes = new Map();
    const edges = [];

    // ── Построение узлов ─────────────────────────────────────────────
    const _ck = typeof getCalcNodeKey === 'function' ? getCalcNodeKey : getPointKey;

    const getNode = (x, y, layerId) => {
      const key = _ck(x, y, layerId);
      if (!nodes.has(key)) {
        nodes.set(key, {
          id: key,
          x: roundTo5(x),
          y: roundTo5(y),
          objects: [],
          inEdges: [],
          outEdges: [],
          totalInflow: 0,
          sourceFlow: 0,
          naturalDraftPa: 0,
          localDeltaCoefficient: 0
        });
      }
      return nodes.get(key);
    };

    pointMap.forEach((point, key) => {
      // Используем ключ pointMap напрямую — он уже layer-aware
      if (!nodes.has(key)) {
        nodes.set(key, {
          id: key,
          x: roundTo5(point.x),
          y: roundTo5(point.y),
          objects: [],
          inEdges: [],
          outEdges: [],
          totalInflow: 0,
          sourceFlow: 0,
          naturalDraftPa: 0,
          localDeltaCoefficient: 0
        });
      }
      const node = nodes.get(key);
      node.objects = (point.objects || []).map(obj => ({
        ...obj,
        object: obj.object,
        airVolume: parseFloat(obj.airVolume) || 0,
        airResistance: parseFloat(obj.airResistance) || 0
      }));
      node.sourceFlow = node.objects.reduce((sum, obj) => sum + getObjectSupplyContribution(obj.object?.properties || obj), 0);
      node.naturalDraftPa = node.objects.reduce((sum, obj) => {
        const props = obj.object?.properties || obj;
        if (!isAtmosphereObject(props)) return sum;
        const synced = synchronizeObjectDerivedProperties(props);
        return sum + (parseFloat(synced.naturalDraftPa) || 0);
      }, 0);
      node.localDeltaCoefficient = node.objects.reduce((sum, obj) => {
        return sum + getObjectResistanceContribution(obj.object?.properties || obj);
      }, 0);
      // Потребитель воздуха (пожар/утечка): уменьшает поток в узле
      node.objects.forEach(obj => {
        const props = obj.object?.properties || obj;
        if (props.isConsumer && parseFloat(props.consumeFlow) > 0) {
          node.sourceFlow -= parseFloat(props.consumeFlow);
        }
      });
    });

    // Проверяем наличие источника воздуха (или реверсного вентилятора)
    let hasFlowSource = false;
    let hasReverseFlow = false;
    nodes.forEach(node => {
      if (node.sourceFlow > 0) hasFlowSource = true;
      if (node.sourceFlow < 0) hasReverseFlow = true;
    });
    if (!hasFlowSource && !hasReverseFlow) {
      showNotification('Нет источника воздуха (вентилятора с чекбоксом "Начало подачи")', 'warning');
    }

    // ══════════════════════════════════════════════════════════════════
    // АЛГОРИТМ ОПРЕДЕЛЕНИЯ НАПРАВЛЕНИЯ РЁБЕР
    //
    // Правила (согласно логике вентиляционной сети):
    //   1. НАЧАЛО ветви — конец, который соединён с другими линиями/объектами
    //      (находится в точке пересечения).
    //   2. КОНЕЦ ветви — конец, который НЕ приходит в точку пересечения
    //      (тупик, к которому ничего больше не присоединено).
    //   3. Если оба конца в точках пересечения — направление определяется
    //      по цепочке вверх до первого объекта с isFlowSource=true.
    //      Этот объект задаёт начало подачи; от него строится направление BFS.
    // ══════════════════════════════════════════════════════════════════
    {
      // ── Шаг 1: строим ненаправленный граф смежности ─────────────────
      // undirAdj[nodeKey] = Set из ключей соседних узлов
      const undirAdj = new Map(); // key -> Set<neighborKey>
      const undirEdges = new Map(); // key -> [{neighborKey, lineId}]

      lines.forEach(line => {
        normalizeLineProperties(line);
        const ep = getLineAbsoluteEndpoints(line);
        const _lid = (line.properties && line.properties.layerId) || 'default';
        const k1 = _ck(ep.x1, ep.y1, _lid);
        const k2 = _ck(ep.x2, ep.y2, _lid);
        getNode(ep.x1, ep.y1, _lid);
        getNode(ep.x2, ep.y2, _lid);
        if (!undirAdj.has(k1)) undirAdj.set(k1, new Set());
        if (!undirAdj.has(k2)) undirAdj.set(k2, new Set());
        undirAdj.get(k1).add(k2);
        undirAdj.get(k2).add(k1);
        if (!undirEdges.has(k1)) undirEdges.set(k1, []);
        if (!undirEdges.has(k2)) undirEdges.set(k2, []);
        undirEdges.get(k1).push({ neighborKey: k2, lineId: line.id });
        undirEdges.get(k2).push({ neighborKey: k1, lineId: line.id });
      });

      // Учитываем объекты как часть узлов (объект в точке = узел НЕ тупик)
      // Узел «тупик» — у которого ровно 1 сосед по линиям И нет объекта в точке
      const isTrueDeadEnd = (key) => {
        const degree = (undirAdj.get(key) || new Set()).size;
        if (degree !== 1) return false;
        // Запечатанный тупик — не открытый вход
        if (window.sealedNodes && window.sealedNodes.has(key)) return false;
        // Нет ли объекта в этом узле?
        const pt = pointMap.get(key);
        return !(pt && (pt.objects || []).length > 0);
      };

      // ── Шаг 2: определяем узлы-источники ────────────────────────────
      // Источник = узел где стоит объект с isFlowSource=true (вентилятор с чекбоксом)
      const sourceNodeKeys = new Set();
      nodes.forEach((node, key) => {
        if (node.sourceFlow > 0) sourceNodeKeys.add(key);
        // Также проверяем объекты в pointMap (они ещё не занесены в node.objects на этом шаге)
        const pt = pointMap.get(key);
        if (pt) {
          for (const obj of (pt.objects || [])) {
            const props = obj.object?.properties || obj;
            if (isFanObject(props) && props.isFlowSource !== false) {
              sourceNodeKeys.add(key);
            }
          }
        }
      });

      // ══════════════════════════════════════════════════════════════════
      // АЛГОРИТМ ОРИЕНТАЦИИ РЁБЕР (3 шага):
      //
      // Шаг A. Берём нарисованное направление x1,y1 → x2,y2 как базовое.
      //
      // Шаг B. Итеративно исправляем только «перевёрнутые» линии:
      //   если fromKey недостижим из источника, а toKey достижим —
      //   переворачиваем (эта линия нарисована против потока).
      //
      // Шаг C. Если после Б остались циклы (оба конца ребра достижимы
      //   но узел с нулевым in-degree внутри цикла) — разрываем цикл,
      //   используя spanning tree BFS только для рёбер внутри цикла:
      //   ребро дерева cur→nb, обратное ребро nb→cur.
      // ══════════════════════════════════════════════════════════════════
      const lineDir = new Map(); // lineId -> {fromKey, toKey}

      // Шаг A: нарисованное направление
      lines.forEach(line => {
        normalizeLineProperties(line);
        const ep = getLineAbsoluteEndpoints(line);
        const _lid = (line.properties && line.properties.layerId) || 'default';
        const k1 = _ck(ep.x1, ep.y1, _lid);
        const k2 = _ck(ep.x2, ep.y2, _lid);
        getNode(ep.x1, ep.y1, _lid);
        getNode(ep.x2, ep.y2, _lid);
        lineDir.set(line.id, { fromKey: k1, toKey: k2 });
      });

      // Шаг B: итеративный flip перевёрнутых линий
      const MAX_FLIP = lines.length + 1;
      for (let iter = 0; iter < MAX_FLIP; iter++) {
        const inDegB = new Map();
        nodes.forEach((_, key) => inDegB.set(key, 0));
        lineDir.forEach(({ toKey }) => inDegB.set(toKey, (inDegB.get(toKey) || 0) + 1));

        const outEdgesB = new Map();
        nodes.forEach((_, key) => outEdgesB.set(key, []));
        lineDir.forEach(({ fromKey, toKey }, lid) => {
          if (!outEdgesB.has(fromKey)) outEdgesB.set(fromKey, []);
          outEdgesB.get(fromKey).push(toKey);
        });

        // BFS от источников
        const reachableB = new Set();
        const bfsB = [];
        nodes.forEach((node, key) => {
          if (node.sourceFlow !== 0 || inDegB.get(key) === 0) {
            reachableB.add(key); bfsB.push(key);
          }
        });
        let biBi = 0;
        while (biBi < bfsB.length) {
          const cur = bfsB[biBi++];
          for (const nb of (outEdgesB.get(cur) || [])) {
            if (!reachableB.has(nb)) { reachableB.add(nb); bfsB.push(nb); }
          }
        }

        let flipped = false;
        lineDir.forEach((dir, lid) => {
          if (!reachableB.has(dir.fromKey) && reachableB.has(dir.toKey)) {
            lineDir.set(lid, { fromKey: dir.toKey, toKey: dir.fromKey });
            flipped = true;
          }
        });
        if (!flipped) break;
      }

      // Шаг C: для сетей с замкнутыми контурами spanning tree не применяем —
      // нарисованные направления корректны. Циклы обрабатываются в расчёте
      // через итерацию по узлам с учётом всех входящих рёбер.

      // Несвязные подграфы — ориентируем от НЕ-тупика
      lines.forEach(line => {
        if (!lineDir.has(line.id)) {
          const ep = getLineAbsoluteEndpoints(line);
          const _lid = (line.properties && line.properties.layerId) || 'default';
          const k1 = _ck(ep.x1, ep.y1, _lid);
          const k2 = _ck(ep.x2, ep.y2, _lid);
          const deg1 = (undirAdj.get(k1) || new Set()).size;
          const deg2 = (undirAdj.get(k2) || new Set()).size;
          lineDir.set(line.id, deg1 >= deg2
            ? { fromKey: k1, toKey: k2 }
            : { fromKey: k2, toKey: k1 });
        }
      });

      // Строим рёбра с откорректированными направлениями
      lines.forEach(line => {
        const ep = getLineAbsoluteEndpoints(line);
        const _lid = (line.properties && line.properties.layerId) || 'default';
        const dir = lineDir.get(line.id);
        const k1 = _ck(ep.x1, ep.y1, _lid);
        const fromNode = dir.fromKey === k1 ? getNode(ep.x1, ep.y1, _lid) : getNode(ep.x2, ep.y2, _lid);
        const toNode   = dir.fromKey === k1 ? getNode(ep.x2, ep.y2, _lid) : getNode(ep.x1, ep.y1, _lid);

        const lineObjects = (lineObjectMap.get(line.id) || []).map(obj => ({
          ...obj,
          object: obj.object
        }));
        const hydraulicBase = recalculateLineHydraulicBase(line.properties || {});
        const baseResistance = hydraulicBase.baseResistance;
        const geometryFactor = hydraulicBase.xFactor;

        const manualLocalObjectResistance = getManualLineObjectResistance(line.properties || {});
        const edge = {
          id: line.id,
          line,
          from: fromNode.id,
          to: toNode.id,
          startNode: fromNode,
          endNode: toNode,
          lineObjects,
          hydraulicBase,
          baseResistance,
          geometryFactor,
          manualLocalObjectResistance,
          localDeltaCoefficient: (parseFloat(manualLocalObjectResistance) || 0) + lineObjects.reduce((sum, obj) => sum + getObjectResistanceContribution(obj.object?.properties || obj), 0),
          // ВМП: заданный расход (м³/с), создаёт циркуляцию в тупиковом кольце
          localFanFlow: lineObjects.reduce((sum, obj) => {
            const props = obj.object?.properties || obj;
            if (isFanObject(props) && props.isFlowSource === false) {
              return sum + (parseFloat(props.localFanFlow) || 0);
            }
            return sum;
          }, 0),
          propagatedDeltaCoefficient: 0,
          totalResistance: baseResistance,
          flow: 0,
          depression: 0,
          directSupply: lineObjects.reduce((sum, obj) => sum + getObjectSupplyContribution(obj.object?.properties || obj), 0),
          directNaturalDraftPa: lineObjects.reduce((sum, obj) => {
            const props = obj.object?.properties || obj;
            if (!isAtmosphereObject(props)) return sum;
            const synced = synchronizeObjectDerivedProperties(props);
            return sum + (parseFloat(synced.naturalDraftPa) || 0);
          }, 0),
          attachedObjects: []
        };

        edges.push(edge);
        fromNode.outEdges.push(edge);
        toNode.inEdges.push(edge);
      });
    }
    // ── конец BFS-ориентации ────────────────────────────────────────────

    // ── Пропагация дельт ────────────────────────────────────────────────
    propagateDeltas(edges, nodes);

    // ── Топологическая сортировка ───────────────────────────────────────
    const topoOrder = performTopologicalSort(nodes);

    // ── Сброс и подготовка к солверу ────────────────────────────────────
    edges.forEach(edge => {
      edge.flow = 0;
      edge.depression = 0;
    });

    nodes.forEach((node) => {
      node.totalInflow = parseFloat(node.sourceFlow) || 0;
      if (node.sourceFlow > 0) return;
      if (node.inEdges.length === 0) {
        node.totalInflow += node.outEdges.reduce((sum, edge) => sum + (parseFloat(edge.line?.properties?.boundaryFlow) || 0), 0);
      }
    });

    edges.forEach(edge => {
      if ((parseFloat(edge.directSupply) || 0) > 0) {
        edge.flow += edge.directSupply;
      }
    });

    // ── Решение методом узловых потенциалов ─────────────────────────────
    const { solverIterations, solverConverged } = solveNodePotentials(nodes, edges);

    // ── Запись результатов ──────────────────────────────────────────────
    writeFlowResults(edges);

    // ── ВМП: постобработка циркуляции в кольце ──────────────────────────
    // Логика: после основного расчёта все рёбра изолированного кольца имеют Q=0.
    // Находим ВМП-рёбра, BFS-обходом собираем нулевые рёбра кольца,
    // проставляем им расход localFanFlow.
    edges.forEach(fanEdge => {
      const q = parseFloat(fanEdge.localFanFlow) || 0;
      if (q <= 0) return;
      // BFS от обоих концов ВМП-ребра, собираем рёбра с нулевым потоком (кольцо)
      const ringEdgeIds = new Set();
      const visited = new Set([fanEdge.from, fanEdge.to]);
      const queue = [fanEdge.from, fanEdge.to];
      while (queue.length) {
        const nodeId = queue.shift();
        const node = nodes.get(nodeId);
        if (!node) continue;
        [...(node.inEdges || []), ...(node.outEdges || [])].forEach(e => {
          if (e.id === fanEdge.id) return;
          if (Math.abs(parseFloat(e.flow) || 0) > 1e-4) return; // пропускаем рёбра главной сети
          if (ringEdgeIds.has(e.id)) return;
          ringEdgeIds.add(e.id);
          const nb = e.from === nodeId ? e.to : e.from;
          if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
        });
      }
      // Проставляем расход ВМП всем рёбрам кольца
      fanEdge.flow = roundTo5((parseFloat(fanEdge.flow) || 0) + q);
      if (fanEdge.line && fanEdge.line.properties) fanEdge.line.properties.airVolume = fanEdge.flow;
      edges.forEach(e => {
        if (!ringEdgeIds.has(e.id)) return;
        e.flow = roundTo5((parseFloat(e.flow) || 0) + q);
        if (e.line && e.line.properties) e.line.properties.airVolume = e.flow;
      });
    });

    // ── Диагностика: проверка закона Кирхгофа (KCL) ──────────────────────
    // Пропускаем тупиковые узлы без объектов — они являются открытыми входами/выходами
    nodes.forEach((node, key) => {
      const degree = node.inEdges.length + node.outEdges.length;
      const hasObjects = (node.objects || []).length > 0;
      if (degree <= 1 && !hasObjects && parseFloat(node.sourceFlow) === 0) return;
      const inFlow = node.inEdges.reduce((s, e) => s + (parseFloat(e.flow) || 0), 0);
      const outFlow = node.outEdges.reduce((s, e) => s + (parseFloat(e.flow) || 0), 0);
      const src = parseFloat(node.sourceFlow) || 0;
      const balance = src + inFlow - outFlow;
      if (Math.abs(balance) > 0.01) {
        console.warn(`KCL: узел ${key} | src=${src.toFixed(3)}, in=${inFlow.toFixed(3)}, out=${outFlow.toFixed(3)}, баланс=${balance.toFixed(3)}`);
      }
    });

    // ── Расчёт итоговых метрик ──────────────────────────────────────────
    // Пересчитываем topoOrder после солвера — он переориентирует рёбра
    const finalTopoOrder = performTopologicalSort(nodes);
    const { networkDepressionPa, naturalDraftPa, requiredFanPressurePa, totalSourceFlow } = computeNetworkMetrics(nodes, edges, finalTopoOrder);

    lastCalculationResult = {
      nodes,
      edges,
      pointMap,
      chains: [],
      networkDepressionPa,
      naturalDraftPa,
      requiredFanPressurePa,
      totalSourceFlow
    };

    updateAllAirVolumeTexts();
    updateAllNodeLabels();
    applySmokeVisualization(lastCalculationResult);
    canvas.renderAll();
    updatePropertiesPanel();

    const reverseLabel = hasReverseFlow ? ' [РЕВЕРС]' : '';
    showNotification(
      `Расчёт завершён${reverseLabel}. Подача: ${formatTo5(totalSourceFlow)} м³/с | Ветвей: ${edges.length} | Hсети: ${formatTo5(networkDepressionPa)} Па` +
      (solverConverged ? ` | Итераций: ${solverIterations}` : ' | ВНИМАНИЕ: солвер не сошёлся'),
      'success'
    );
    return true;
  } catch (e) {
    console.error('Ошибка расчёта воздуха:', e);
    showNotification('Ошибка расчёта', 'error');
    return false;
  } finally {
    isCalculatingAirVolumes = false;
  }
}

// Export all functions to global scope
global.calculateChainIntrinsicResistance = calculateChainIntrinsicResistance;
global.calculateChainGeometryFactor = calculateChainGeometryFactor;
global.propagateDeltas = propagateDeltas;
global.performTopologicalSort = performTopologicalSort;
global.solveNodePotentials = solveNodePotentials;
global.writeFlowResults = writeFlowResults;
global.computeNetworkMetrics = computeNetworkMetrics;
global.calculateAirFlows = calculateAirFlows;

})(window);
