// config.js — Константы и конфигурация приложения
(function(global) {
  'use strict';

  const APP_CONFIG = {
    GRID_SIZE: 20,
    SNAP_RADIUS: 15,
    MAX_UNDO_STEPS: 50,
    DEFAULT_LINE_COLOR: '#6A7FDB',
    DEFAULT_LINE_WIDTH: 5,
    MAX_IMAGE_SIZE: 40,
    NODE_THRESHOLD: 5,
    NODE_LOCK_DEFAULT: true,
    MAX_OBJECTS: 1000,
    SPATIAL_GRID_SIZE: 100
  };

  const AIR_MODEL_CONFIG = {
    SECTION_SHAPE_COEFFICIENTS: {
      'Круглое': 3.54,
      'Арочное': 3.8,
      'Трапециевидное': 3.8,
      'Прямоугольное': 4.16,
      'Прямоугольное 3/4': 4.0,
      'Квадратное': 4.16
    },
    SUPPORT_ROUGHNESS: {
      'бетон': 0.001,
      'торкрет': 0.0019,
      'СВП': 0.003,
      'без крепи': 0.006,
      'ГИ, Арочная мет. крепь': 0.007,
      'ГИ, Комбайновая проходка': 0.004,
      'ГИ, Ствол – 1 сосуд': 0.04,
      'ГИ, Ствол – 3 сосуда': 0.07,
      'ГИ, БВР без крепи': 0.025,
      'ГИ, Монолитный бетон': 0.005,
      'ГИ, Гибкий трубопровод': 0.005
    },
    DOOR_RESISTANCE: {
      '1': 0.144,
      '1.5': 0.06,
      '2': 0.031,
      '2.5': 0.018,
      '3': 0.012,
      '3.5': 0.0078,
      '4': 0.0054,
      '4.5': 0.0038,
      '5': 0.0027,
      'open': 0,
      'closed': 10000
    },
    DEFAULT_SUPPORT: 'торкрет',
    DEFAULT_SECTION: 'Арочное',
    SOLVER_MAX_ITERATIONS: 50000,
    SOLVER_TOLERANCE: 1e-8,
    SOLVER_RELAXATION_OMEGA: 1.5,
    MIN_RESISTANCE: 1e-9
  };

  const OBJECT_RESISTANCE_CATALOG = {
    doorClosedConcrete: 1,
    doorOpenMetal: 0,
    doorGratedBrick: 0.0005,
    doorVentWindowWood: null,
    jumperConcrete: 1.5,
    jumperWood: 0.1,
    jumperMetal: 0.9
  };

  function inferCatalogKey(props) {
    props = props || {};
    if (props.catalogKey) return props.catalogKey;
    const imageId = (props.imageId || '').toLowerCase();
    const name = (props.name || '').toLowerCase();

    if (imageId === 'fan1') return 'mainFan';
    if (imageId === 'fan2') return 'localFan';
    if (imageId === 'valve') return 'doorClosedConcrete';
    if (imageId === 'valve2') return 'doorOpenMetal';
    if (imageId === 'valve3' || imageId === 'valve6') return 'doorGratedBrick';
    if (imageId === 'valve4') return 'doorVentWindowWood';
    if (imageId === 'valve5') return 'jumperConcrete';
    if (imageId === 'valve7') return 'jumperMetal';
    if (imageId === 'valve8') return 'jumperWood';
    if (imageId === 'valve9') return 'passage';
    if (imageId === 'valve10') return 'emergencyExit';
    if (imageId === 'atmosphere1') return 'atmosphereLink';
    if (imageId === 'pump') return 'submersiblePump';
    if (imageId === 'pump2') return 'pumpStation';
    if (imageId === 'sensor') return 'selfPropelledEquipment';
    if (imageId === 'sensor2') return 'people';
    if (imageId === 'sensor3') return 'telephone';
    if (imageId === 'sensor4') return 'blasting';
    if (imageId === 'sensor5') return 'massBlasting';
    if (imageId === 'sensor6') return 'medicalPoint';
    if (imageId === 'sensor7') return 'surfaceBuilding';
    if (imageId === 'fire') return 'fire';
    if (imageId === 'fire2') return 'fireHydrant';
    if (imageId === 'fire3') return 'fireMaterialStorage';

    if (name.includes('вентокн')) return 'doorVentWindowWood';
    if (name.includes('двер') && name.includes('закры')) return 'doorClosedConcrete';
    if (name.includes('двер') && name.includes('откры')) return 'doorOpenMetal';
    if (name.includes('решет')) return 'doorGratedBrick';
    if (name.includes('перемычк') && name.includes('бетон')) return 'jumperConcrete';
    if (name.includes('перемычк') && name.includes('дерев')) return 'jumperWood';
    if (name.includes('перемычк') && name.includes('металл')) return 'jumperMetal';
    if (name.includes('вентилятор') && name.includes('глав')) return 'mainFan';
    if (name.includes('вентилятор')) return 'localFan';
    if (name.includes('атмосфер')) return 'atmosphereLink';
    if (name.includes('насосн')) return 'pumpStation';
    if (name.includes('насос')) return 'submersiblePump';
    if (name.includes('самоход')) return 'selfPropelledEquipment';
    if (name.includes('люди')) return 'people';
    if (name.includes('телефон')) return 'telephone';
    if (name.includes('взрыв')) return 'blasting';
    if (name.includes('мед')) return 'medicalPoint';
    if (name.includes('надшахт')) return 'surfaceBuilding';
    if (name.includes('запас')) return 'emergencyExit';
    return '';
  }

  function getCatalogResistance(props) {
    props = props || {};
    const catalogKey = inferCatalogKey(props);
    if (catalogKey === 'doorVentWindowWood') {
      return roundTo5(getDoorResistanceByMode('window', props.windowArea || '1'));
    }
    return OBJECT_RESISTANCE_CATALOG[catalogKey];
  }

  // Экспорт
  global.APP_CONFIG = APP_CONFIG;
  global.AIR_MODEL_CONFIG = AIR_MODEL_CONFIG;
  global.OBJECT_RESISTANCE_CATALOG = OBJECT_RESISTANCE_CATALOG;
  global.inferCatalogKey = inferCatalogKey;
  global.getCatalogResistance = getCatalogResistance;
})(window);
