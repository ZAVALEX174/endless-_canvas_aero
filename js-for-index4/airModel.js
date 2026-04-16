// airModel.js — Физические расчёты и свойства объектов
(function(global) {
  'use strict';

  function getSectionShapeCoefficient(sectionType) {
    sectionType = sectionType || AIR_MODEL_CONFIG.DEFAULT_SECTION;
    return AIR_MODEL_CONFIG.SECTION_SHAPE_COEFFICIENTS[sectionType] || AIR_MODEL_CONFIG.SECTION_SHAPE_COEFFICIENTS[AIR_MODEL_CONFIG.DEFAULT_SECTION];
  }

  function getDefaultSupportRoughness(supportType) {
    supportType = supportType || AIR_MODEL_CONFIG.DEFAULT_SUPPORT;
    return AIR_MODEL_CONFIG.SUPPORT_ROUGHNESS[supportType] || AIR_MODEL_CONFIG.SUPPORT_ROUGHNESS[AIR_MODEL_CONFIG.DEFAULT_SUPPORT];
  }

  function calculateAirVelocity(flow, area) {
    const safeArea = parseFloat(area) || 0;
    if (safeArea <= 0) return 0;
    return roundTo5((parseFloat(flow) || 0) / safeArea);
  }

  function calculateDepression(resistance, flow) {
    return roundTo5((parseFloat(resistance) || 0) * Math.pow(parseFloat(flow) || 0, 2));
  }

  function calculateAtmosphericNaturalDraftMm(height, temp1, temp2) {
    return roundTo5(0.0047 * (parseFloat(height) || 0) * ((parseFloat(temp1) || 0) - (parseFloat(temp2) || 0)));
  }

  function calculateAtmosphericNaturalDraftPa(height, temp1, temp2, sign) {
    sign = sign || 1;
    const heMm = calculateAtmosphericNaturalDraftMm(height, temp1, temp2);
    return roundTo5(9.81 * heMm * (parseFloat(sign) || 1));
  }

  function getDoorResistanceByMode(doorMode, windowArea) {
    doorMode = doorMode || 'open';
    windowArea = windowArea || '1';
    if (doorMode === 'closed') return AIR_MODEL_CONFIG.DOOR_RESISTANCE.closed;
    if (doorMode === 'open') return AIR_MODEL_CONFIG.DOOR_RESISTANCE.open;
    return AIR_MODEL_CONFIG.DOOR_RESISTANCE[String(windowArea || '1')] || 0;
  }

  function isAtmosphereObject(props) {
    props = props || {};
    return (props.type || '').toLowerCase() === 'atmosphere';
  }

  function isFireObject(props) {
    props = props || {};
    return (props.type || '').toLowerCase() === 'fire';
  }

  // Объект-загрязнитель для цветовой визуализации струи (#15-16):
  // - любой пожар (fire) — всегда загрязнитель;
  // - объект с явным флагом properties.isContaminant === true — для ручной
  //   пометки источников пыли, газа, метана и т.д. (будущее расширение UI);
  // - НЕ считаем загрязнителями двери, атмосферу, вентиляторы, потребителей.
  function isContaminantObject(props) {
    props = props || {};
    if (isFireObject(props)) return true;
    if (props.isContaminant === true) return true;
    return false;
  }

  function isFanObject(props) {
    props = props || {};
    return (props.type || '').toLowerCase() === 'fan';
  }

  function getObjectSupplyContribution(props) {
    props = props || {};
    if (isFanObject(props)) {
      const isSource = props.isFlowSource !== false;
      if (!isSource) return 0;
      const vol = roundTo5(parseFloat(props.airVolume) || 0);
      return (props.fanMode === 'reverse') ? -vol : vol;
    }
    return roundTo5(parseFloat(props.sourceAirVolume) || 0);
  }

  function synchronizeObjectDerivedProperties(props) {
    props = props || {};
    const p = { ...props };
    p.catalogKey = inferCatalogKey(p);

    if (p.catalogKey === 'doorClosedConcrete') {
      p.type = 'valve';
      p.doorMode = 'closed';
      p.airResistance = roundTo5(OBJECT_RESISTANCE_CATALOG.doorClosedConcrete);
    } else if (p.catalogKey === 'doorOpenMetal') {
      p.type = 'valve';
      p.doorMode = 'open';
      p.airResistance = roundTo5(OBJECT_RESISTANCE_CATALOG.doorOpenMetal);
    } else if (p.catalogKey === 'doorGratedBrick') {
      p.type = 'valve';
      p.doorMode = 'grated';
      p.airResistance = roundTo5(OBJECT_RESISTANCE_CATALOG.doorGratedBrick);
    } else if (p.catalogKey === 'doorVentWindowWood') {
      p.type = 'valve';
      p.doorMode = 'window';
      p.windowArea = String(p.windowArea || '1');
      p.airResistance = roundTo5(getDoorResistanceByMode('window', p.windowArea));
    } else if (p.catalogKey === 'jumperConcrete') {
      p.type = 'valve';
      p.airResistance = roundTo5(OBJECT_RESISTANCE_CATALOG.jumperConcrete);
    } else if (p.catalogKey === 'jumperWood') {
      p.type = 'valve';
      p.airResistance = roundTo5(OBJECT_RESISTANCE_CATALOG.jumperWood);
    } else if (p.catalogKey === 'jumperMetal') {
      p.type = 'valve';
      p.airResistance = roundTo5(OBJECT_RESISTANCE_CATALOG.jumperMetal);
    } else if (p.type === 'valve') {
      p.doorMode = p.doorMode || 'open';
      p.windowArea = String(p.windowArea || '1');
      p.airResistance = roundTo5(getDoorResistanceByMode(p.doorMode, p.windowArea));
    }

    if (p.catalogKey === 'mainFan' || p.catalogKey === 'localFan' || p.type === 'fan') {
      p.type = 'fan';
      p.fanMode = p.fanMode || 'supply';
      p.airResistance = roundTo5(parseFloat(p.airResistance) || 0);
      if (p.isFlowSource === undefined) p.isFlowSource = true;
    }

    if (p.catalogKey === 'fire' || p.type === 'fire') {
      p.type = 'fire';
      p.airResistance = roundTo5(parseFloat(p.airResistance) || 0);
    }

    if (p.catalogKey === 'atmosphereLink' || isAtmosphereObject(p)) {
      p.type = 'atmosphere';
      p.atmosphereHeight = roundTo5(parseFloat(p.atmosphereHeight) || 0);
      p.atmosphereTemp1 = roundTo5(parseFloat(p.atmosphereTemp1) || 0);
      p.atmosphereTemp2 = roundTo5(parseFloat(p.atmosphereTemp2) || 0);
      p.atmosphereSign = parseFloat(p.atmosphereSign) || 1;
      p.naturalDraftMm = calculateAtmosphericNaturalDraftMm(p.atmosphereHeight, p.atmosphereTemp1, p.atmosphereTemp2);
      p.naturalDraftPa = calculateAtmosphericNaturalDraftPa(p.atmosphereHeight, p.atmosphereTemp1, p.atmosphereTemp2, p.atmosphereSign);
      p.airResistance = 0;
    }

    if (!['valve', 'fan', 'fire', 'atmosphere'].includes(p.type || '')) {
      const catalogResistance = getCatalogResistance(p);
      p.airResistance = roundTo5(catalogResistance !== undefined && catalogResistance !== null ? catalogResistance : (parseFloat(p.airResistance) || 0));
    }
    if (p.type !== 'fan') {
      p.isFlowSource = false;
    }

    p.airVolume = roundTo5(parseFloat(p.airVolume) || 0);
    p.resistanceR = roundTo5(parseFloat(p.airResistance) || 0);
    if (p.windowArea !== undefined && p.windowArea !== null) {
      p.windowArea = String(p.windowArea);
    }
    return p;
  }

  function getObjectResistanceContribution(props) {
    props = props || {};
    const synced = synchronizeObjectDerivedProperties(props);
    if (isAtmosphereObject(synced) || isFireObject(synced) || isFanObject(synced)) return 0;
    return roundTo5(parseFloat(synced.airResistance) || 0);
  }

  // Экспорт
  global.getSectionShapeCoefficient = getSectionShapeCoefficient;
  global.getDefaultSupportRoughness = getDefaultSupportRoughness;
  global.calculateAirVelocity = calculateAirVelocity;
  global.calculateDepression = calculateDepression;
  global.calculateAtmosphericNaturalDraftMm = calculateAtmosphericNaturalDraftMm;
  global.calculateAtmosphericNaturalDraftPa = calculateAtmosphericNaturalDraftPa;
  global.getDoorResistanceByMode = getDoorResistanceByMode;
  global.isAtmosphereObject = isAtmosphereObject;
  global.isFireObject = isFireObject;
  global.isContaminantObject = isContaminantObject;
  global.isFanObject = isFanObject;
  global.getObjectSupplyContribution = getObjectSupplyContribution;
  global.synchronizeObjectDerivedProperties = synchronizeObjectDerivedProperties;
  global.getObjectResistanceContribution = getObjectResistanceContribution;
})(window);
