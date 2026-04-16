// airDemandCalc.js — Расчёт потребного количества воздуха по вредным факторам
// Полная методика из PDF "Моделирование вентиляции рудника" (Аэросеть, 29.12.2025)
// Факторы: метан, взрывные работы, ДВС (CO, NO2, O2), мин. скорость, люди

(function(global) {
  'use strict';

  // ==================== КОНФИГУРАЦИЯ ====================

  var CONFIG = {
    // Коэффициент формы выработки kвыр
    SHAPE_COEFF: {
      'Арочное': 1.0,
      'Прямоугольное': 1.05,
      'Прямоугольное 3/4': 1.05,
      'Трапециевидное': 1.1,
      'Круглое': 1.0,
      'Квадратное': 1.05
    },
    // Мин. допустимая скорость воздуха, м/с
    MIN_SPEED: {
      'deadend': 0.25,      // тупиковая (подготовительный забой)
      'stoping': 0.15,      // очистной забой
      'throughput': 0.15,   // сквозная
      'maintained': 0.15,   // поддерживаемая
      'chamber': 0.15       // камера
    },
    // Норма подачи воздуха на одного человека, м³/с
    Q_PER_PERSON: 0.1,
    // Коэффициент для формулы тупикового забоя (п. стр.38)
    DEADEND_COEFF: 1.43,
    // Кратность воздухообмена в камерах (раз/час)
    CHAMBER_AIR_CHANGES: 4,
    // Расход воздуха для транспортного уклона по умолчанию, м³/с
    DEFAULT_QTU: 5.0
  };

  // ==================== 5 ВАРИАНТОВ ИСХОДНЫХ ДАННЫХ (PDF стр.30-34) ====================

  var VARIANTS = {
    1: {
      name: 'Вариант 1',
      // Метан
      gasEmissionDeadend: 1,       // м³/мин, подготовительный
      gasEmissionStoping: 3,       // м³/мин, очистной
      gasUnevenDeadend: 1,         // k_н подготовительный
      gasUnevenStoping: 1.07,      // k_н очистной
      gasCdop: 0.5,                // %, допустимая конц. метана
      gasC0: 0,                    // %, конц. в поступающем воздухе
      // Взрывы
      blastingTime: 1600,          // с, время проветривания забоя
      blastingMassDeadend: 100,    // кг, ВВ в подготовительной
      blastingMassStoping: 500,    // кг, ВВ в очистной
      blastingAreaDeadend: 22,     // м², сечение подготовительной
      blastingAreaStoping: 50,     // м², сечение очистной
      blastingLength: 100,         // м, длина выработок
      blastingGasRate: 35,         // л/кг, газовость ВВ по усл. CO
      blastingVentTime: 30,        // мин, время проветривания
      blastingWetness: 0.77,       // k_обв
      blastingLeakage: 1.05,       // k_ут
      // ДВС
      engineType: 'Дизельный',
      engineCycleTime: 25,         // мин
      // Погрузочно-доставочная машина
      lhdExhaustCO: 0.0128,        // % CO
      lhdExhaustNO2: 0.0156,       // % NO2
      lhdCylinderVolume: 0.0111,   // м³
      lhdRPM: 35,                  // об/с
      lhdPower: 243,               // кВт
      lhdFuelRate: 0.3,            // кг/кВт·ч
      // Кровлеоборочная машина
      scalerExhaustCO: 0.0090,     // % CO
      scalerExhaustNO2: 0.0182,    // % NO2
      scalerCylinderVolume: 0.00431, // м³
      scalerRPM: 42,               // об/с
      scalerPower: 64,             // кВт
      scalerFuelRate: 0.3,         // кг/кВт·ч
      // Общие для ДВС
      pdkCO: 0.0017,              // % ПДК CO
      pdkNO2: 0.00026,            // % ПДК NO2
      airPerKgFuel: 14.4,         // кг воздуха на кг топлива
      airDensity: 1.23,           // кг/м³
      oxygenContent: 20.7,        // %
      // Загазованные объёмы
      gasVolumeDeadend: 58.7,     // м³
      gasVolumeStoping: 46.8,     // м³
      // Скорости
      minSpeedDeadend: 0.25,      // м/с
      minSpeedStoping: 0.15,      // м/с
      // Люди
      qPerPerson: 0.1,            // м³/с на чел.
      peopleCount: 5,             // чел.
      // Камеры
      chamberVolumeGSHO: 1500,    // м³
      chamberVolumeVM: 2000,      // м³
      chamberVolumeGSM: 3800,     // м³
      // Блок
      kBlock: 1.3,                // утечки через выраб. пространство
      // Рудник
      kRud: 1.03,                 // утечки в откаточных выработках
      kNerav: 1.09,               // неравномерность распределения
      // Вентилятор
      fanRPM: 1000
    },
    2: {
      name: 'Вариант 2',
      gasEmissionDeadend: 1.5, gasEmissionStoping: 2.5,
      gasUnevenDeadend: 1, gasUnevenStoping: 1.07,
      gasCdop: 0.5, gasC0: 0,
      blastingTime: 1650, blastingMassDeadend: 200, blastingMassStoping: 400,
      blastingAreaDeadend: 22, blastingAreaStoping: 50,
      blastingLength: 110, blastingGasRate: 33, blastingVentTime: 30,
      blastingWetness: 0.75, blastingLeakage: 1.1,
      engineType: 'Дизельный', engineCycleTime: 25,
      lhdExhaustCO: 0.0128, lhdExhaustNO2: 0.0156,
      lhdCylinderVolume: 0.0111, lhdRPM: 40, lhdPower: 235, lhdFuelRate: 0.3,
      scalerExhaustCO: 0.0090, scalerExhaustNO2: 0.0182,
      scalerCylinderVolume: 0.00431, scalerRPM: 38, scalerPower: 78, scalerFuelRate: 0.3,
      pdkCO: 0.0017, pdkNO2: 0.00026, airPerKgFuel: 14.4,
      airDensity: 1.25, oxygenContent: 20.5,
      gasVolumeDeadend: 64.6, gasVolumeStoping: 51.5,
      minSpeedDeadend: 0.25, minSpeedStoping: 0.15,
      qPerPerson: 0.1, peopleCount: 10,
      chamberVolumeGSHO: 1600, chamberVolumeVM: 2200, chamberVolumeGSM: 3600,
      kBlock: 1.4, kRud: 1.05, kNerav: 1.13, fanRPM: 900
    },
    3: {
      name: 'Вариант 3',
      gasEmissionDeadend: 2, gasEmissionStoping: 1.5,
      gasUnevenDeadend: 1, gasUnevenStoping: 1.14,
      gasCdop: 0.5, gasC0: 0,
      blastingTime: 1700, blastingMassDeadend: 300, blastingMassStoping: 200,
      blastingAreaDeadend: 22, blastingAreaStoping: 50,
      blastingLength: 120, blastingGasRate: 35, blastingVentTime: 30,
      blastingWetness: 0.78, blastingLeakage: 1.15,
      engineType: 'Дизельный', engineCycleTime: 25,
      lhdExhaustCO: 0.0128, lhdExhaustNO2: 0.0156,
      lhdCylinderVolume: 0.0111, lhdRPM: 42, lhdPower: 223, lhdFuelRate: 0.3,
      scalerExhaustCO: 0.0090, scalerExhaustNO2: 0.0182,
      scalerCylinderVolume: 0.00431, scalerRPM: 41, scalerPower: 85, scalerFuelRate: 0.3,
      pdkCO: 0.0017, pdkNO2: 0.00026, airPerKgFuel: 14.4,
      airDensity: 1.24, oxygenContent: 20.9,
      gasVolumeDeadend: 70.5, gasVolumeStoping: 56.2,
      minSpeedDeadend: 0.25, minSpeedStoping: 0.15,
      qPerPerson: 0.1, peopleCount: 8,
      chamberVolumeGSHO: 1700, chamberVolumeVM: 2400, chamberVolumeGSM: 3400,
      kBlock: 1.5, kRud: 1.07, kNerav: 1.17, fanRPM: 900
    },
    4: {
      name: 'Вариант 4',
      gasEmissionDeadend: 2.5, gasEmissionStoping: 2,
      gasUnevenDeadend: 1, gasUnevenStoping: 1.08,
      gasCdop: 0.5, gasC0: 0,
      blastingTime: 1750, blastingMassDeadend: 400, blastingMassStoping: 300,
      blastingAreaDeadend: 22, blastingAreaStoping: 50,
      blastingLength: 130, blastingGasRate: 33, blastingVentTime: 30,
      blastingWetness: 0.76, blastingLeakage: 1.2,
      engineType: 'Дизельный', engineCycleTime: 25,
      lhdExhaustCO: 0.0128, lhdExhaustNO2: 0.0156,
      lhdCylinderVolume: 0.0111, lhdRPM: 38, lhdPower: 205, lhdFuelRate: 0.3,
      scalerExhaustCO: 0.0090, scalerExhaustNO2: 0.0182,
      scalerCylinderVolume: 0.00431, scalerRPM: 45, scalerPower: 87, scalerFuelRate: 0.3,
      pdkCO: 0.0017, pdkNO2: 0.00026, airPerKgFuel: 14.4,
      airDensity: 1.25, oxygenContent: 20.5,
      gasVolumeDeadend: 76.4, gasVolumeStoping: 60.9,
      minSpeedDeadend: 0.25, minSpeedStoping: 0.15,
      qPerPerson: 0.1, peopleCount: 7,
      chamberVolumeGSHO: 1800, chamberVolumeVM: 2600, chamberVolumeGSM: 3200,
      kBlock: 1.1, kRud: 1.09, kNerav: 1.21, fanRPM: 1000
    },
    5: {
      name: 'Вариант 5',
      gasEmissionDeadend: 3, gasEmissionStoping: 1,
      gasUnevenDeadend: 1, gasUnevenStoping: 1.3,
      gasCdop: 0.5, gasC0: 0,
      blastingTime: 1800, blastingMassDeadend: 500, blastingMassStoping: 100,
      blastingAreaDeadend: 22, blastingAreaStoping: 50,
      blastingLength: 140, blastingGasRate: 35, blastingVentTime: 30,
      blastingWetness: 0.79, blastingLeakage: 1.25,
      engineType: 'Дизельный', engineCycleTime: 25,
      lhdExhaustCO: 0.0128, lhdExhaustNO2: 0.0156,
      lhdCylinderVolume: 0.0111, lhdRPM: 37, lhdPower: 198, lhdFuelRate: 0.3,
      scalerExhaustCO: 0.0090, scalerExhaustNO2: 0.0182,
      scalerCylinderVolume: 0.00431, scalerRPM: 39, scalerPower: 95, scalerFuelRate: 0.3,
      pdkCO: 0.0017, pdkNO2: 0.00026, airPerKgFuel: 14.4,
      airDensity: 1.23, oxygenContent: 20.9,
      gasVolumeDeadend: 82.3, gasVolumeStoping: 65.6,
      minSpeedDeadend: 0.25, minSpeedStoping: 0.15,
      qPerPerson: 0.1, peopleCount: 4,
      chamberVolumeGSHO: 1900, chamberVolumeVM: 2800, chamberVolumeGSM: 3000,
      kBlock: 1.2, kRud: 1.11, kNerav: 1.25, fanRPM: 1000
    }
  };

  // ==================== ВСПОМОГАТЕЛЬНЫЕ ====================

  function round5(v) {
    return Math.round((v + Number.EPSILON) * 100000) / 100000;
  }

  function getSectionShapeCoeff(sectionType) {
    return CONFIG.SHAPE_COEFF[sectionType] || 1.0;
  }

  function getMinSpeed(excavationType) {
    return CONFIG.MIN_SPEED[excavationType] || 0.15;
  }

  // ==================== ФАКТОРЫ РАСЧЁТА ====================

  // ---------- 1. По газам из массива (метан) — PDF стр.35 ----------
  // Q_газ = 100 × J × k_н / (60 × (C_доп − C₀))
  // J — газовыделение, м³/мин
  // k_н — коэфф. неравномерности
  // C_доп — допустимая конц., %
  // C₀ — конц. в поступающем воздухе, %
  function calcQgas(J, kn, Cdop, C0) {
    J = parseFloat(J) || 0;
    kn = parseFloat(kn) || 1;
    Cdop = parseFloat(Cdop) || 0.5;
    C0 = parseFloat(C0) || 0;
    var denom = 60 * (Cdop - C0);
    if (denom <= 0) return 0;
    return round5((100 * J * kn) / denom);
  }

  // ---------- 2. По газам при взрывах — PDF стр.35 ----------
  // Q_вв = (2.25 / (60 × T)) × ∛( (A_вв × (S × L)² × b × k_обв) / k_ут² )
  // T — время проветривания, мин
  // A_вв — масса ВВ, кг
  // S — площадь сечения, м²
  // L — длина выработки, м
  // b — газовость ВВ, л/кг
  // k_обв — коэфф. обводнённости
  // k_ут — коэфф. утечек в трубопроводе
  function calcQblasting(T, Avv, S, L, b, kobv, kut) {
    T = parseFloat(T) || 30;
    Avv = parseFloat(Avv) || 0;
    S = parseFloat(S) || 0;
    L = parseFloat(L) || 0;
    b = parseFloat(b) || 35;
    kobv = parseFloat(kobv) || 0.8;
    kut = parseFloat(kut) || 1.0;
    if (T <= 0 || Avv <= 0 || S <= 0 || L <= 0 || kut <= 0) return 0;
    var innerValue = (Avv * Math.pow(S * L, 2) * b * kobv) / Math.pow(kut, 2);
    if (innerValue <= 0) return 0;
    return round5((2.25 / (60 * T)) * Math.pow(innerValue, 1 / 3));
  }

  // ---------- 3. По ДВС — токсичные компоненты (CO или NO₂) — PDF стр.36 ----------
  // Q_двиг = (C_вых / C_доп) × (V_двиг × n_двиг / 2)
  // C_вых — конц. ядовитых комп. в выхлопе, %
  // C_доп — ПДК, %
  // V_двиг — раб. объём цилиндров, м³
  // n_двиг — скорость вращения коленвала, об/с
  function calcQdieselToxic(Cvyh, Cdop, Vdvig, ndvig) {
    Cvyh = parseFloat(Cvyh) || 0;
    Cdop = parseFloat(Cdop) || 0;
    Vdvig = parseFloat(Vdvig) || 0;
    ndvig = parseFloat(ndvig) || 0;
    if (Cdop <= 0) return 0;
    return round5((Cvyh / Cdop) * (Vdvig * ndvig / 2));
  }

  // ---------- 4. По ДВС — кислород — PDF стр.37 ----------
  // Q_двиг = (21 × L₀ × N × q) / (3600 × ρ × (K₀ − 20))
  // L₀ — кол-во воздуха для сгорания 1 кг топлива, кг
  // N — мощность двигателя, кВт
  // q — удельный расход топлива, кг/кВт·ч
  // ρ — плотность воздуха, кг/м³
  // K₀ — содержание O₂ в поступающем воздухе, %
  function calcQdieselOxygen(L0, N, q, rho, K0) {
    L0 = parseFloat(L0) || 14.4;
    N = parseFloat(N) || 0;
    q = parseFloat(q) || 0.3;
    rho = parseFloat(rho) || 1.23;
    K0 = parseFloat(K0) || 20.7;
    var denom = 3600 * rho * (K0 - 20);
    if (denom <= 0) return 0;
    return round5((21 * L0 * N * q) / denom);
  }

  // ---------- 5. По минимально допустимой скорости — PDF стр.37 ----------
  // Q_мин = S × V_мин
  function calcQminSpeed(area, sectionType, excavationType) {
    var S = parseFloat(area) || 0;
    var v = getMinSpeed(excavationType);
    return round5(S * v);
  }

  // ---------- 6. По количеству людей — PDF стр.38 ----------
  // Q_раб = q_раб × n_раб
  function calcQpeople(people) {
    return round5(CONFIG.Q_PER_PERSON * (parseFloat(people) || 0));
  }

  // ==================== МАКСИМАЛЬНЫЙ Q ПО ФАКТОРАМ ДЛЯ ЗОНЫ ====================

  // Принимается наибольший расход по всем факторам
  function calcQaccepted(factors) {
    var values = [];
    if (factors.Qgas > 0) values.push(factors.Qgas);
    if (factors.Qvv > 0) values.push(factors.Qvv);
    if (factors.QdvsCO > 0) values.push(factors.QdvsCO);
    if (factors.QdvsNO2 > 0) values.push(factors.QdvsNO2);
    if (factors.QdvsO2 > 0) values.push(factors.QdvsO2);
    if (factors.Qv > 0) values.push(factors.Qv);
    if (factors.Ql > 0) values.push(factors.Ql);
    return values.length ? round5(Math.max.apply(null, values)) : 0;
  }

  // ==================== АГРЕГАЦИЯ ====================

  // Для тупикового забоя с вентилятором местного проветривания — PDF стр.38
  // Q_вент = 1.43 × k_у × Q
  function calcQventilator(Q, ky) {
    Q = parseFloat(Q) || 0;
    ky = parseFloat(ky) || 1.0;
    return round5(CONFIG.DEADEND_COEFF * ky * Q);
  }

  // Для блока (выемочного участка) — PDF стр.38-39
  // Q_блок = k_блок × (1.43 × k_у × ΣQ_зон)
  function calcQblock(kblock, ky, qZonesArray) {
    kblock = parseFloat(kblock) || 1.0;
    ky = parseFloat(ky) || 1.0;
    var sumQ = 0;
    for (var i = 0; i < qZonesArray.length; i++) {
      sumQ += parseFloat(qZonesArray[i]) || 0;
    }
    return round5(kblock * CONFIG.DEADEND_COEFF * ky * sumQ);
  }

  // Для технологической камеры — PDF стр.39
  // Q_тк = (4 / 3600) × V_тк
  function calcQchamber(volume) {
    volume = parseFloat(volume) || 0;
    return round5((CONFIG.CHAMBER_AIR_CHANGES / 3600) * volume);
  }

  // Для рудника в целом — PDF стр.40
  // Q_руд = k_руд × k_н × (Q_блок1 + Q_блок2) + Q_ту + ΣQ_тк
  function calcQmineTotal(krud, kn, Qblock1, Qblock2, Qtu, sumQtk) {
    krud = parseFloat(krud) || 1.0;
    kn = parseFloat(kn) || 1.0;
    Qblock1 = parseFloat(Qblock1) || 0;
    Qblock2 = parseFloat(Qblock2) || 0;
    Qtu = parseFloat(Qtu) || CONFIG.DEFAULT_QTU;
    sumQtk = parseFloat(sumQtk) || 0;
    return round5(krud * kn * (Qblock1 + Qblock2) + Qtu + sumQtk);
  }

  // ==================== ПЕРЕСЧЁТ ВЫРАБОТКИ ====================

  // Пересчитать все факторы для рабочей зоны
  function recalcExcavation(exc) {
    var factors = exc.factors || {};
    var excType = exc.type || 'deadend';
    var isDeadend = (excType === 'deadend');
    var isStoping = (excType === 'stoping');
    var isChamber = (excType === 'chamber');

    // 1. По газам из массива
    if (exc.gasEmission > 0) {
      factors.Qgas = calcQgas(exc.gasEmission, exc.gasUneven || 1, exc.gasCdop || 0.5, exc.gasC0 || 0);
    } else {
      factors.Qgas = 0;
    }

    // 2. По взрывным работам
    if (exc.blastingMass > 0) {
      factors.Qvv = calcQblasting(
        exc.blastingVentTime || 30,
        exc.blastingMass,
        exc.area || 0,
        exc.blastingLength || 100,
        exc.blastingGasRate || 35,
        exc.blastingWetness || 0.8,
        exc.blastingLeakage || 1.0
      );
    } else {
      factors.Qvv = 0;
    }

    // 3. По ДВС (CO)
    // В подготовительных: макс. из погрузочной и кровлеоборочной
    // В очистных: только погрузочная (кровлеоборочная не используется)
    var qLhdCO = 0, qLhdNO2 = 0, qScalerCO = 0, qScalerNO2 = 0;
    var qLhdO2 = 0, qScalerO2 = 0;

    if (exc.lhdCylinderVolume > 0 && exc.lhdRPM > 0) {
      qLhdCO = calcQdieselToxic(exc.lhdExhaustCO, exc.pdkCO, exc.lhdCylinderVolume, exc.lhdRPM);
      qLhdNO2 = calcQdieselToxic(exc.lhdExhaustNO2, exc.pdkNO2, exc.lhdCylinderVolume, exc.lhdRPM);
      qLhdO2 = calcQdieselOxygen(exc.airPerKgFuel, exc.lhdPower, exc.lhdFuelRate, exc.airDensity, exc.oxygenContent);
    }

    if (isDeadend && exc.scalerCylinderVolume > 0 && exc.scalerRPM > 0) {
      qScalerCO = calcQdieselToxic(exc.scalerExhaustCO, exc.pdkCO, exc.scalerCylinderVolume, exc.scalerRPM);
      qScalerNO2 = calcQdieselToxic(exc.scalerExhaustNO2, exc.pdkNO2, exc.scalerCylinderVolume, exc.scalerRPM);
      qScalerO2 = calcQdieselOxygen(exc.airPerKgFuel, exc.scalerPower, exc.scalerFuelRate, exc.airDensity, exc.oxygenContent);
    }

    factors.QdvsCO = round5(Math.max(qLhdCO, qScalerCO));
    factors.QdvsNO2 = round5(Math.max(qLhdNO2, qScalerNO2));
    factors.QdvsO2 = round5(Math.max(qLhdO2, qScalerO2));
    factors.Qdvs = round5(Math.max(factors.QdvsCO, factors.QdvsNO2, factors.QdvsO2));

    // Детали для отображения
    factors._lhdCO = qLhdCO;
    factors._lhdNO2 = qLhdNO2;
    factors._lhdO2 = qLhdO2;
    factors._scalerCO = qScalerCO;
    factors._scalerNO2 = qScalerNO2;
    factors._scalerO2 = qScalerO2;

    // 4. По минимальной скорости
    factors.Qv = calcQminSpeed(exc.area || 0, exc.sectionType || 'Арочное', excType);

    // 5. По людям
    factors.Ql = calcQpeople(exc.people || 0);

    // 6. Для камеры — по объёму
    if (isChamber && exc.chamberVolume > 0) {
      factors.Qchamber = calcQchamber(exc.chamberVolume);
    } else {
      factors.Qchamber = 0;
    }

    exc.factors = factors;

    // Принимаемый расход = макс. из всех факторов
    if (isChamber) {
      exc.Qaccepted = round5(Math.max(factors.Qchamber, factors.Qv, factors.Ql));
    } else {
      exc.Qaccepted = round5(calcQaccepted(factors));
    }

    return exc;
  }

  // ==================== ТИПЫ ВЫРАБОТОК ====================

  var EXCAVATION_TYPES = {
    'deadend':    'Тупиковая (подготовительный забой)',
    'stoping':    'Очистной забой',
    'throughput': 'Сквозная',
    'maintained': 'Поддерживаемая',
    'chamber':    'Камера (тех. назначение)'
  };

  var SECTION_TYPES = ['Арочное', 'Прямоугольное', 'Прямоугольное 3/4', 'Трапециевидное', 'Круглое', 'Квадратное'];

  // ==================== ЭКСПОРТ ====================

  global.AirDemandCalc = {
    CONFIG: CONFIG,
    VARIANTS: VARIANTS,
    EXCAVATION_TYPES: EXCAVATION_TYPES,
    SECTION_TYPES: SECTION_TYPES,
    // Индивидуальные факторы
    calcQgas: calcQgas,
    calcQblasting: calcQblasting,
    calcQdieselToxic: calcQdieselToxic,
    calcQdieselOxygen: calcQdieselOxygen,
    calcQminSpeed: calcQminSpeed,
    calcQpeople: calcQpeople,
    // Агрегация
    calcQaccepted: calcQaccepted,
    calcQventilator: calcQventilator,
    calcQblock: calcQblock,
    calcQchamber: calcQchamber,
    calcQmineTotal: calcQmineTotal,
    // Пересчёт
    recalcExcavation: recalcExcavation,
    // Вспомогательные
    getSectionShapeCoeff: getSectionShapeCoeff,
    getMinSpeed: getMinSpeed,
    round5: round5
  };

})(window);
