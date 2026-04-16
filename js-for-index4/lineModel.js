// lineModel.js — Свойства и расчёты для линий (ветвей)
(function(global) {
  'use strict';

  function calculateLinePerimeter(area, sectionType) {
    sectionType = sectionType || AIR_MODEL_CONFIG.DEFAULT_SECTION;
    const safeArea = parseFloat(area) || 0;
    if (safeArea <= 0) return 0;
    return roundTo5(getSectionShapeCoefficient(sectionType) * Math.sqrt(safeArea));
  }

  function calculateAirResistance(roughness, perimeter, length, area) {
    const safeArea = parseFloat(area) || 0;
    if (safeArea <= 0) return 0;
    return roundTo5(((parseFloat(roughness) || 0) * (parseFloat(perimeter) || 0) * (parseFloat(length) || 0)) / safeArea);
  }

  function calculateAirResistanceWithDelta(baseRoughness, deltaCoefficient, perimeter, length, area) {
    return calculateAirResistance((parseFloat(baseRoughness) || 0) + (parseFloat(deltaCoefficient) || 0), perimeter, length, area);
  }

  function calculateGeometryFactor(perimeter, length, area) {
    const safeArea = parseFloat(area) || 0;
    if (safeArea <= 0) return 0;
    return roundTo5(((parseFloat(perimeter) || 0) * (parseFloat(length) || 0)) / safeArea);
  }

  function recalculateLineHydraulicBase(properties) {
    const p = properties || {};
    const sectionType = p.sectionType || AIR_MODEL_CONFIG.DEFAULT_SECTION;
    const supportType = p.supportType || AIR_MODEL_CONFIG.DEFAULT_SUPPORT;
    const roughnessCoefficient = roundTo5(
      parseFloat(p.roughnessCoefficient) || getDefaultSupportRoughness(supportType)
    );
    const crossSectionalArea = roundTo5(parseFloat(p.crossSectionalArea) || 0);
    const passageLength = roundTo5(parseFloat(p.passageLength) || 0);
    const perimeter = calculateLinePerimeter(crossSectionalArea, sectionType);
    const xFactor = calculateGeometryFactor(perimeter, passageLength, crossSectionalArea);
    const baseResistance = roundTo5(roughnessCoefficient * xFactor);
    return {
      sectionType,
      supportType,
      roughnessCoefficient,
      crossSectionalArea,
      passageLength,
      perimeter,
      xFactor,
      baseResistance
    };
  }

  function getManualLineObjectResistance(properties) {
    if (!properties || typeof properties !== 'object') return 0;
    const explicitValue = properties.manualLocalObjectResistance;
    if (explicitValue !== undefined && explicitValue !== null && explicitValue !== '') {
      return roundTo5(parseFloat(explicitValue) || 0);
    }
    return 0;
  }

  function calculateAllLineProperties(line) {
    if (!line.properties) return;
    const p = line.properties;
    const hydraulicBase = recalculateLineHydraulicBase(p);
    p.sectionType = hydraulicBase.sectionType;
    p.supportType = hydraulicBase.supportType;
    p.roughnessCoefficient = hydraulicBase.roughnessCoefficient;
    p.crossSectionalArea = hydraulicBase.crossSectionalArea;
    p.passageLength = hydraulicBase.passageLength;
    p.perimeter = hydraulicBase.perimeter;
    p.xFactor = hydraulicBase.xFactor;
    p.airResistance = hydraulicBase.baseResistance;
    p.baseResistance = hydraulicBase.baseResistance;
    if (p.boundaryFlow === undefined) p.boundaryFlow = roundTo5(parseFloat(p.airVolume) || 0);
    const manualLocalResistance = getManualLineObjectResistance(p);
    if (p.localObjectResistance === undefined || p.localObjectResistance === null || p.localObjectResistance === '') {
      p.localObjectResistance = manualLocalResistance;
    }
    p.objectResistance = roundTo5(parseFloat(p.localObjectResistance) || 0);
    p.totalResistance = roundTo5((parseFloat(p.airResistance) || 0) + (parseFloat(p.localObjectResistance) || 0));
    p.branchTotalResistance = roundTo5(parseFloat(p.branchTotalResistance) || p.totalResistance);
    p.velocity = calculateAirVelocity(p.airVolume, p.crossSectionalArea);
    p.depression = calculateDepression(p.totalResistance, p.airVolume);
    p.branchDepression = roundTo5(parseFloat(p.branchDepression) || p.depression);
    return p;
  }

  function createDefaultLineProperties(name, boundaryFlow) {
    name = name || 'Линия';
    boundaryFlow = boundaryFlow || 0;
    const hydraulicBase = recalculateLineHydraulicBase({
      sectionType: AIR_MODEL_CONFIG.DEFAULT_SECTION,
      supportType: AIR_MODEL_CONFIG.DEFAULT_SUPPORT,
      roughnessCoefficient: getDefaultSupportRoughness(AIR_MODEL_CONFIG.DEFAULT_SUPPORT),
      crossSectionalArea: 10,
      passageLength: 0.5
    });
    return {
      name,
      passageLength: hydraulicBase.passageLength,
      sectionType: hydraulicBase.sectionType,
      supportType: hydraulicBase.supportType,
      roughnessCoefficient: hydraulicBase.roughnessCoefficient,
      crossSectionalArea: hydraulicBase.crossSectionalArea,
      perimeter: hydraulicBase.perimeter,
      xFactor: hydraulicBase.xFactor,
      airResistance: hydraulicBase.baseResistance,
      baseResistance: hydraulicBase.baseResistance,
      localObjectResistance: 0,
      objectResistance: 0,
      deltaCoefficient: 0,
      totalResistance: hydraulicBase.baseResistance,
      branchTotalResistance: hydraulicBase.baseResistance,
      branchDepression: 0,
      attachedObjects: '',
      startNode: '',
      endNode: '',
      boundaryFlow: roundTo5(boundaryFlow),
      airVolume: roundTo5(boundaryFlow),
      velocity: 0,
      depression: 0
    };
  }

  function updateDerivedLineFields(line) {
    if (!line || !line.properties) return;
    calculateAllLineProperties(line);
    const p = line.properties;
    p.objectResistance = roundTo5(parseFloat(p.localObjectResistance) || 0);
    p.totalResistance = roundTo5((parseFloat(p.airResistance) || 0) + (parseFloat(p.localObjectResistance) || 0));
    p.branchTotalResistance = roundTo5(parseFloat(p.branchTotalResistance) || p.totalResistance);
    p.velocity = calculateAirVelocity(p.airVolume, p.crossSectionalArea);
    p.depression = calculateDepression(p.totalResistance, p.airVolume);
    p.branchDepression = roundTo5(parseFloat(p.branchDepression) || p.depression);
    line.set('properties', p);
  }

  function normalizeLineProperties(line) {
    if (!line.properties) {
      line.properties = createDefaultLineProperties('Линия');
      return;
    }
    const p = line.properties;
    if (p.L !== undefined) {
      p.passageLength = roundTo5(p.L);
      delete p.L;
    }
    if (p.K !== undefined) {
      p.crossSectionalArea = roundTo5(p.K);
      delete p.K;
    }
    if (p.I !== undefined) {
      p.roughnessCoefficient = roundTo5(p.I);
      delete p.I;
    }
    p.sectionType = p.sectionType || AIR_MODEL_CONFIG.DEFAULT_SECTION;
    p.supportType = p.supportType || AIR_MODEL_CONFIG.DEFAULT_SUPPORT;
    if (p.roughnessCoefficient === undefined || p.roughnessCoefficient === null) {
      p.roughnessCoefficient = getDefaultSupportRoughness(p.supportType);
    }
    if (p.passageLength === undefined) p.passageLength = 0.5;
    if (p.crossSectionalArea === undefined) p.crossSectionalArea = 10;
    if (p.boundaryFlow === undefined) p.boundaryFlow = roundTo5(parseFloat(p.airVolume) || 0);
    calculateAllLineProperties(line);
    line.set('properties', p);
  }

  function getLineGeometryFactor(line) {
    if (!line || !line.properties) return 0;
    const p = line.properties;
    const area = parseFloat(p.crossSectionalArea) || 0;
    const length = parseFloat(p.passageLength) || 0;
    if (!area || !length) return 0;

    let perimeter = parseFloat(p.perimeter);
    if (!perimeter && area) {
      perimeter = calculateLinePerimeter(area);
    }
    if (!perimeter) return 0;

    return roundTo5((perimeter * length) / area);
  }

  function generateLineId() {
    return 'line_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // Экспорт
  global.calculateLinePerimeter = calculateLinePerimeter;
  global.calculateAirResistance = calculateAirResistance;
  global.calculateAirResistanceWithDelta = calculateAirResistanceWithDelta;
  global.calculateGeometryFactor = calculateGeometryFactor;
  global.recalculateLineHydraulicBase = recalculateLineHydraulicBase;
  global.getManualLineObjectResistance = getManualLineObjectResistance;
  global.calculateAllLineProperties = calculateAllLineProperties;
  global.createDefaultLineProperties = createDefaultLineProperties;
  global.updateDerivedLineFields = updateDerivedLineFields;
  global.normalizeLineProperties = normalizeLineProperties;
  global.getLineGeometryFactor = getLineGeometryFactor;
  global.generateLineId = generateLineId;
})(window);
