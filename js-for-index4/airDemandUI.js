// airDemandUI.js — UI для страницы расчёта потребного количества воздуха
// Поддержка всех 6 факторов из PDF + 5 вариантов + блоки + камеры + формула рудника

(function(global) {
  'use strict';

  var STORAGE_KEY = 'airDemandData_v2';
  var Calc = null;

  // ==================== ДАННЫЕ ====================

  function getDefaultData() {
    return {
      excavations: [],
      variant: 0,
      kRud: 1.03,
      kNerav: 1.09,
      kBlock: 1.3,
      kUt: 1.05,
      qTransport: 5.0,
      chamberGSHO: 1500,
      chamberVM: 2000,
      chamberGSM: 3800,
      nextId: 1
    };
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (!data.nextId) data.nextId = (data.excavations.length ? Math.max.apply(null, data.excavations.map(function(e) { return e.id; })) + 1 : 1);
        return data;
      }
    } catch (e) { /* ignore */ }
    return getDefaultData();
  }

  function saveData(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  var appData = null;

  // ==================== ПЕРЕСЧЁТ ====================

  function recalcAll() {
    for (var i = 0; i < appData.excavations.length; i++) {
      Calc.recalcExcavation(appData.excavations[i]);
    }
    saveData(appData);
  }

  function getQchamberTotal() {
    var qGSHO = Calc.calcQchamber(appData.chamberGSHO || 0);
    var qVM = Calc.calcQchamber(appData.chamberVM || 0);
    var qGSM = Calc.calcQchamber(appData.chamberGSM || 0);
    return { qGSHO: qGSHO, qVM: qVM, qGSM: qGSM, total: Calc.round5(qGSHO + qVM + qGSM) };
  }

  // ==================== ТАБЛИЦА ====================

  function renderTable() {
    var tbody = document.getElementById('excTable');
    if (!tbody) return;
    tbody.innerHTML = '';

    for (var i = 0; i < appData.excavations.length; i++) {
      var exc = appData.excavations[i];
      var f = exc.factors || {};
      var tr = document.createElement('tr');
      tr.setAttribute('data-id', exc.id);
      tr.onclick = (function(id) { return function() { openExcModal(id); }; })(exc.id);

      tr.innerHTML =
        '<td>' + exc.id + '</td>' +
        '<td>' + (exc.name || '—') + '</td>' +
        '<td>' + (Calc.EXCAVATION_TYPES[exc.type] || exc.type || '—') + '</td>' +
        '<td>' + (exc.area || 0) + '</td>' +
        '<td>' + fmt(f.Qgas) + '</td>' +
        '<td>' + fmt(f.Qvv) + '</td>' +
        '<td>' + fmt(f.Qdvs) + '</td>' +
        '<td>' + fmt(f.Qv) + '</td>' +
        '<td>' + fmt(f.Ql) + '</td>' +
        '<td class="accepted-col">' + fmt(exc.Qaccepted) + '</td>' +
        '<td><button class="btn-del" onclick="event.stopPropagation(); AirDemandUI.removeExcavation(' + exc.id + ')">&#10005;</button></td>';
      tbody.appendChild(tr);
    }

    renderChambers();
    renderSummary();
  }

  function fmt(v) {
    v = parseFloat(v) || 0;
    return v > 0 ? v.toFixed(3) : '—';
  }

  // ==================== КАМЕРЫ ====================

  function renderChambers() {
    var ch = getQchamberTotal();
    setVal('qGSHO', ch.qGSHO.toFixed(3));
    setVal('qVM', ch.qVM.toFixed(3));
    setVal('qGSM', ch.qGSM.toFixed(3));
    setVal('qChamberTotal', ch.total.toFixed(3));
  }

  function onChamberChange() {
    appData.chamberGSHO = parseFloat(document.getElementById('chamberGSHO').value) || 0;
    appData.chamberVM = parseFloat(document.getElementById('chamberVM').value) || 0;
    appData.chamberGSM = parseFloat(document.getElementById('chamberGSM').value) || 0;
    saveData(appData);
    renderChambers();
    renderSummary();
  }

  // ==================== ИТОГИ ====================

  function renderSummary() {
    var el = document.getElementById('summaryBlock');
    if (!el) return;

    // Собрать Q рабочих зон по типам
    var deadendZones = [], stopingZones = [];
    for (var i = 0; i < appData.excavations.length; i++) {
      var exc = appData.excavations[i];
      if (exc.type === 'deadend') deadendZones.push(exc);
      else if (exc.type === 'stoping') stopingZones.push(exc);
    }

    // Блок 1: рабочие зоны очистных забоев (каждая отдельно с k_блок)
    var qBlock1Zones = [];
    for (var j = 0; j < stopingZones.length; j++) {
      qBlock1Zones.push(stopingZones[j].Qaccepted || 0);
    }
    // Блок 1 = k_блок × 1.43 × k_ут × ΣQ_очистных
    var qBlock1 = 0;
    if (qBlock1Zones.length > 0) {
      qBlock1 = Calc.calcQblock(appData.kBlock, appData.kUt, qBlock1Zones);
    }

    // Блок 2: тупиковые (подготовительные)
    var qBlock2Zones = [];
    for (var k = 0; k < deadendZones.length; k++) {
      qBlock2Zones.push(deadendZones[k].Qaccepted || 0);
    }
    var qBlock2 = 0;
    if (qBlock2Zones.length > 0) {
      qBlock2 = Calc.calcQblock(appData.kBlock, appData.kUt, qBlock2Zones);
    }

    var ch = getQchamberTotal();
    var qTu = appData.qTransport || 5;

    var qMine = Calc.calcQmineTotal(appData.kRud, appData.kNerav, qBlock1, qBlock2, qTu, ch.total);

    el.innerHTML =
      '<div class="summary-row"><span>Q<sub>блок1</sub> (очистные) = k<sub>бл</sub>·1.43·k<sub>ут</sub>·ΣQ<sub>оч</sub> = ' + appData.kBlock + '×1.43×' + appData.kUt + '×' + sumArr(qBlock1Zones).toFixed(3) + ':</span><b>' + qBlock1.toFixed(3) + ' м&sup3;/с</b></div>' +
      '<div class="summary-row"><span>Q<sub>блок2</sub> (подготовительные) = k<sub>бл</sub>·1.43·k<sub>ут</sub>·ΣQ<sub>подг</sub> = ' + appData.kBlock + '×1.43×' + appData.kUt + '×' + sumArr(qBlock2Zones).toFixed(3) + ':</span><b>' + qBlock2.toFixed(3) + ' м&sup3;/с</b></div>' +
      '<div class="summary-row"><span>Q<sub>ту</sub> (транспортный уклон):</span><b>' + qTu.toFixed(3) + ' м&sup3;/с</b></div>' +
      '<div class="summary-row"><span>ΣQ<sub>тк</sub> (камеры):</span><b>' + ch.total.toFixed(3) + ' м&sup3;/с</b></div>' +
      '<div class="summary-row" style="border-top:2px solid #4A00E0;padding-top:8px;margin-top:4px;">' +
        '<span><b>Q<sub>рудника</sub></b> = k<sub>руд</sub>·k<sub>н</sub>·(Q<sub>бл1</sub>+Q<sub>бл2</sub>) + Q<sub>ту</sub> + ΣQ<sub>тк</sub><br>' +
        '<small>= ' + appData.kRud + '×' + appData.kNerav + '×(' + qBlock1.toFixed(3) + '+' + qBlock2.toFixed(3) + ') + ' + qTu.toFixed(3) + ' + ' + ch.total.toFixed(3) + '</small></span>' +
        '<b class="q-mine">' + qMine.toFixed(3) + ' м&sup3;/с</b>' +
      '</div>';
  }

  function sumArr(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s;
  }

  // ==================== КОЭФФИЦИЕНТЫ ====================

  function renderCoeffs() {
    setInput('coeffKrud', appData.kRud);
    setInput('coeffKnerav', appData.kNerav);
    setInput('coeffKblock', appData.kBlock);
    setInput('coeffKut', appData.kUt);
    setInput('qTransport', appData.qTransport);
    setInput('chamberGSHO', appData.chamberGSHO);
    setInput('chamberVM', appData.chamberVM);
    setInput('chamberGSM', appData.chamberGSM);
  }

  function onCoeffChange() {
    appData.kRud = parseFloat(document.getElementById('coeffKrud').value) || 1.0;
    appData.kNerav = parseFloat(document.getElementById('coeffKnerav').value) || 1.0;
    appData.kBlock = parseFloat(document.getElementById('coeffKblock').value) || 1.0;
    appData.kUt = parseFloat(document.getElementById('coeffKut').value) || 1.0;
    appData.qTransport = parseFloat(document.getElementById('qTransport').value) || 5.0;
    recalcAll();
    renderTable();
  }

  // ==================== ВАРИАНТ ====================

  function onVariantChange() {
    var sel = document.getElementById('variantSelect');
    var varNum = parseInt(sel.value) || 0;
    appData.variant = varNum;
    if (varNum > 0 && Calc.VARIANTS[varNum]) {
      var v = Calc.VARIANTS[varNum];
      appData.kRud = v.kRud;
      appData.kNerav = v.kNerav;
      appData.kBlock = v.kBlock;
      appData.kUt = v.blastingLeakage;
      appData.chamberGSHO = v.chamberVolumeGSHO;
      appData.chamberVM = v.chamberVolumeVM;
      appData.chamberGSM = v.chamberVolumeGSM;
      renderCoeffs();
      recalcAll();
      renderTable();
    }
    saveData(appData);
  }

  // ==================== МОДАЛКА ====================

  function openExcModal(id) {
    var exc = null;
    var isNew = false;

    if (id === null || id === undefined) {
      isNew = true;
      var varNum = appData.variant || 0;
      var v = (varNum > 0 && Calc.VARIANTS[varNum]) ? Calc.VARIANTS[varNum] : null;
      exc = {
        id: appData.nextId++,
        name: 'Рабочая зона ' + appData.nextId,
        type: 'deadend',
        sectionType: 'Прямоугольное 3/4',
        area: v ? v.blastingAreaDeadend : 22,
        people: v ? v.peopleCount : 5,
        // Метан
        gasEmission: v ? v.gasEmissionDeadend : 0,
        gasUneven: v ? v.gasUnevenDeadend : 1,
        gasCdop: v ? v.gasCdop : 0.5,
        gasC0: v ? v.gasC0 : 0,
        // Взрывы
        blastingMass: v ? v.blastingMassDeadend : 0,
        blastingLength: v ? v.blastingLength : 100,
        blastingGasRate: v ? v.blastingGasRate : 35,
        blastingVentTime: v ? v.blastingVentTime : 30,
        blastingWetness: v ? v.blastingWetness : 0.8,
        blastingLeakage: v ? v.blastingLeakage : 1.0,
        // ДВС ПДМ
        lhdExhaustCO: v ? v.lhdExhaustCO : 0,
        lhdExhaustNO2: v ? v.lhdExhaustNO2 : 0,
        lhdCylinderVolume: v ? v.lhdCylinderVolume : 0,
        lhdRPM: v ? v.lhdRPM : 0,
        lhdPower: v ? v.lhdPower : 0,
        lhdFuelRate: v ? v.lhdFuelRate : 0.3,
        // ДВС КОМ
        scalerExhaustCO: v ? v.scalerExhaustCO : 0,
        scalerExhaustNO2: v ? v.scalerExhaustNO2 : 0,
        scalerCylinderVolume: v ? v.scalerCylinderVolume : 0,
        scalerRPM: v ? v.scalerRPM : 0,
        scalerPower: v ? v.scalerPower : 0,
        scalerFuelRate: v ? v.scalerFuelRate : 0.3,
        // Общие ДВС
        pdkCO: v ? v.pdkCO : 0.0017,
        pdkNO2: v ? v.pdkNO2 : 0.00026,
        airPerKgFuel: v ? v.airPerKgFuel : 14.4,
        airDensity: v ? v.airDensity : 1.23,
        oxygenContent: v ? v.oxygenContent : 20.7,
        // Камера
        chamberVolume: 0,
        factors: {},
        Qaccepted: 0
      };
    } else {
      for (var i = 0; i < appData.excavations.length; i++) {
        if (appData.excavations[i].id === id) { exc = appData.excavations[i]; break; }
      }
      if (!exc) return;
    }

    var modal = document.getElementById('excModal');
    if (!modal) return;

    document.getElementById('excModalTitle').textContent = isNew ? 'Новая рабочая зона' : exc.name || 'Рабочая зона';
    document.getElementById('excId').value = exc.id;
    document.getElementById('excIsNew').value = isNew ? '1' : '0';

    // Основные
    setInput('excName', exc.name || '');
    setInput('excArea', exc.area || 0);
    setInput('excPeople', exc.people || 0);

    // Типы
    populateSelect('excType', Calc.EXCAVATION_TYPES, exc.type || 'deadend');
    populateSelectArr('excSectionType', Calc.SECTION_TYPES, exc.sectionType || 'Арочное');

    // Метан
    setInput('excGasEmission', exc.gasEmission || 0);
    setInput('excGasUneven', exc.gasUneven || 1);
    setInput('excGasCdop', exc.gasCdop || 0.5);
    setInput('excGasC0', exc.gasC0 || 0);

    // Взрывы
    setInput('excBlastMass', exc.blastingMass || 0);
    setInput('excBlastLength', exc.blastingLength || 100);
    setInput('excBlastGasRate', exc.blastingGasRate || 35);
    setInput('excBlastVentTime', exc.blastingVentTime || 30);
    setInput('excBlastWetness', exc.blastingWetness || 0.8);
    setInput('excBlastLeakage', exc.blastingLeakage || 1.0);

    // ДВС ПДМ
    setInput('excLhdCO', exc.lhdExhaustCO || 0);
    setInput('excLhdNO2', exc.lhdExhaustNO2 || 0);
    setInput('excLhdVol', exc.lhdCylinderVolume || 0);
    setInput('excLhdRPM', exc.lhdRPM || 0);
    setInput('excLhdPower', exc.lhdPower || 0);
    setInput('excLhdFuel', exc.lhdFuelRate || 0.3);

    // ДВС КОМ
    setInput('excScalerCO', exc.scalerExhaustCO || 0);
    setInput('excScalerNO2', exc.scalerExhaustNO2 || 0);
    setInput('excScalerVol', exc.scalerCylinderVolume || 0);
    setInput('excScalerRPM', exc.scalerRPM || 0);
    setInput('excScalerPower', exc.scalerPower || 0);
    setInput('excScalerFuel', exc.scalerFuelRate || 0.3);

    // Общие ДВС
    setInput('excPdkCO', exc.pdkCO || 0.0017);
    setInput('excPdkNO2', exc.pdkNO2 || 0.00026);
    setInput('excAirFuel', exc.airPerKgFuel || 14.4);
    setInput('excDensity', exc.airDensity || 1.23);
    setInput('excO2', exc.oxygenContent || 20.7);

    // Камера
    setInput('excChamberVolume', exc.chamberVolume || 0);

    updateModalDerived();
    modal.style.display = 'flex';
  }

  function updateModalDerived() {
    var excType = getVal('excType');
    var area = parseFloat(getVal('excArea')) || 0;
    var people = parseInt(getVal('excPeople')) || 0;
    var isDeadend = (excType === 'deadend');
    var isChamber = (excType === 'chamber');

    // Показать/скрыть секцию кровлеоборочной
    toggleEl('scalerSection', isDeadend);
    toggleEl('scalerFields', isDeadend);
    toggleEl('scalerFields2', isDeadend);
    toggleEl('scalerResults1', isDeadend);
    toggleEl('scalerResults2', isDeadend);
    toggleEl('scalerResults3', isDeadend);
    toggleEl('chamberFactorGroup', isChamber);

    // Собрать временную выработку для пересчёта
    var tmpExc = {
      type: excType,
      sectionType: getVal('excSectionType'),
      area: area,
      people: people,
      gasEmission: parseFloat(getVal('excGasEmission')) || 0,
      gasUneven: parseFloat(getVal('excGasUneven')) || 1,
      gasCdop: parseFloat(getVal('excGasCdop')) || 0.5,
      gasC0: parseFloat(getVal('excGasC0')) || 0,
      blastingMass: parseFloat(getVal('excBlastMass')) || 0,
      blastingLength: parseFloat(getVal('excBlastLength')) || 100,
      blastingGasRate: parseFloat(getVal('excBlastGasRate')) || 35,
      blastingVentTime: parseFloat(getVal('excBlastVentTime')) || 30,
      blastingWetness: parseFloat(getVal('excBlastWetness')) || 0.8,
      blastingLeakage: parseFloat(getVal('excBlastLeakage')) || 1.0,
      lhdExhaustCO: parseFloat(getVal('excLhdCO')) || 0,
      lhdExhaustNO2: parseFloat(getVal('excLhdNO2')) || 0,
      lhdCylinderVolume: parseFloat(getVal('excLhdVol')) || 0,
      lhdRPM: parseFloat(getVal('excLhdRPM')) || 0,
      lhdPower: parseFloat(getVal('excLhdPower')) || 0,
      lhdFuelRate: parseFloat(getVal('excLhdFuel')) || 0.3,
      scalerExhaustCO: parseFloat(getVal('excScalerCO')) || 0,
      scalerExhaustNO2: parseFloat(getVal('excScalerNO2')) || 0,
      scalerCylinderVolume: parseFloat(getVal('excScalerVol')) || 0,
      scalerRPM: parseFloat(getVal('excScalerRPM')) || 0,
      scalerPower: parseFloat(getVal('excScalerPower')) || 0,
      scalerFuelRate: parseFloat(getVal('excScalerFuel')) || 0.3,
      pdkCO: parseFloat(getVal('excPdkCO')) || 0.0017,
      pdkNO2: parseFloat(getVal('excPdkNO2')) || 0.00026,
      airPerKgFuel: parseFloat(getVal('excAirFuel')) || 14.4,
      airDensity: parseFloat(getVal('excDensity')) || 1.23,
      oxygenContent: parseFloat(getVal('excO2')) || 20.7,
      chamberVolume: parseFloat(getVal('excChamberVolume')) || 0,
      factors: {}
    };

    Calc.recalcExcavation(tmpExc);
    var f = tmpExc.factors;

    // Отобразить результаты
    setVal('excQgas', fmt(f.Qgas));
    setVal('excQvv', fmt(f.Qvv));
    setVal('excVmin', Calc.getMinSpeed(excType));
    setVal('excQv', fmt(f.Qv));
    setVal('excQl', fmt(f.Ql));
    setVal('excQchamber', fmt(f.Qchamber));

    // ДВС
    setVal('excLhdQCO', fmt(f._lhdCO));
    setVal('excLhdQNO2', fmt(f._lhdNO2));
    setVal('excLhdQO2', fmt(f._lhdO2));
    setVal('excScalerQCO', fmt(f._scalerCO));
    setVal('excScalerQNO2', fmt(f._scalerNO2));
    setVal('excScalerQO2', fmt(f._scalerO2));
    setVal('excQdvs', fmt(f.Qdvs));

    setVal('excQaccepted', (tmpExc.Qaccepted || 0).toFixed(5));
  }

  function saveExcModal() {
    var id = parseInt(document.getElementById('excId').value);
    var isNew = document.getElementById('excIsNew').value === '1';

    var exc;
    if (isNew) {
      exc = { id: id, factors: {} };
      appData.excavations.push(exc);
    } else {
      for (var i = 0; i < appData.excavations.length; i++) {
        if (appData.excavations[i].id === id) { exc = appData.excavations[i]; break; }
      }
      if (!exc) return;
    }

    exc.name = getVal('excName') || 'Рабочая зона';
    exc.type = getVal('excType');
    exc.sectionType = getVal('excSectionType');
    exc.area = parseFloat(getVal('excArea')) || 0;
    exc.people = parseInt(getVal('excPeople')) || 0;

    exc.gasEmission = parseFloat(getVal('excGasEmission')) || 0;
    exc.gasUneven = parseFloat(getVal('excGasUneven')) || 1;
    exc.gasCdop = parseFloat(getVal('excGasCdop')) || 0.5;
    exc.gasC0 = parseFloat(getVal('excGasC0')) || 0;

    exc.blastingMass = parseFloat(getVal('excBlastMass')) || 0;
    exc.blastingLength = parseFloat(getVal('excBlastLength')) || 100;
    exc.blastingGasRate = parseFloat(getVal('excBlastGasRate')) || 35;
    exc.blastingVentTime = parseFloat(getVal('excBlastVentTime')) || 30;
    exc.blastingWetness = parseFloat(getVal('excBlastWetness')) || 0.8;
    exc.blastingLeakage = parseFloat(getVal('excBlastLeakage')) || 1.0;

    exc.lhdExhaustCO = parseFloat(getVal('excLhdCO')) || 0;
    exc.lhdExhaustNO2 = parseFloat(getVal('excLhdNO2')) || 0;
    exc.lhdCylinderVolume = parseFloat(getVal('excLhdVol')) || 0;
    exc.lhdRPM = parseFloat(getVal('excLhdRPM')) || 0;
    exc.lhdPower = parseFloat(getVal('excLhdPower')) || 0;
    exc.lhdFuelRate = parseFloat(getVal('excLhdFuel')) || 0.3;

    exc.scalerExhaustCO = parseFloat(getVal('excScalerCO')) || 0;
    exc.scalerExhaustNO2 = parseFloat(getVal('excScalerNO2')) || 0;
    exc.scalerCylinderVolume = parseFloat(getVal('excScalerVol')) || 0;
    exc.scalerRPM = parseFloat(getVal('excScalerRPM')) || 0;
    exc.scalerPower = parseFloat(getVal('excScalerPower')) || 0;
    exc.scalerFuelRate = parseFloat(getVal('excScalerFuel')) || 0.3;

    exc.pdkCO = parseFloat(getVal('excPdkCO')) || 0.0017;
    exc.pdkNO2 = parseFloat(getVal('excPdkNO2')) || 0.00026;
    exc.airPerKgFuel = parseFloat(getVal('excAirFuel')) || 14.4;
    exc.airDensity = parseFloat(getVal('excDensity')) || 1.23;
    exc.oxygenContent = parseFloat(getVal('excO2')) || 20.7;

    exc.chamberVolume = parseFloat(getVal('excChamberVolume')) || 0;

    Calc.recalcExcavation(exc);
    recalcAll();
    renderTable();
    closeExcModal();
  }

  function closeExcModal() {
    var modal = document.getElementById('excModal');
    if (modal) modal.style.display = 'none';
  }

  // ==================== CRUD ====================

  function addExcavation() { openExcModal(null); }

  function removeExcavation(id) {
    appData.excavations = appData.excavations.filter(function(e) { return e.id !== id; });
    recalcAll();
    renderTable();
  }

  // ==================== СВОРАЧИВАЕМЫЕ СЕКЦИИ ====================

  function toggleSection(headerEl) {
    var body = headerEl.nextElementSibling;
    if (body) {
      body.classList.toggle('open');
      var arrow = body.classList.contains('open') ? '\u25BC' : '\u25B6';
      headerEl.innerHTML = arrow + ' ' + headerEl.textContent.substring(2);
    }
  }

  // ==================== CSV ЭКСПОРТ ====================

  function exportCSV() {
    var header = 'ID;Название;Тип;S м2;Qгаз;Qвв;Qдвс;Qv;Qлюд;Qприн.';
    var rows = [header];
    for (var i = 0; i < appData.excavations.length; i++) {
      var e = appData.excavations[i];
      var f = e.factors || {};
      rows.push([
        e.id, e.name, Calc.EXCAVATION_TYPES[e.type] || e.type, e.area,
        fmt(f.Qgas), fmt(f.Qvv), fmt(f.Qdvs), fmt(f.Qv), fmt(f.Ql),
        fmt(e.Qaccepted)
      ].join(';'));
    }
    rows.push('');

    var ch = getQchamberTotal();
    rows.push('Камера ГШО;' + appData.chamberGSHO + ' м3;' + ch.qGSHO.toFixed(3) + ' м3/с');
    rows.push('Склад ВМ;' + appData.chamberVM + ' м3;' + ch.qVM.toFixed(3) + ' м3/с');
    rows.push('Склад ГСМ;' + appData.chamberGSM + ' м3;' + ch.qGSM.toFixed(3) + ' м3/с');
    rows.push('');
    rows.push('kруд;' + appData.kRud);
    rows.push('kн;' + appData.kNerav);
    rows.push('kблок;' + appData.kBlock);

    var blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'расчет-воздуха-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==================== УТИЛИТЫ ====================

  function setVal(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  function setInput(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = v;
  }

  function getVal(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  function toggleEl(id, show) {
    var el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  }

  function populateSelect(id, obj, selectedKey) {
    var sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    for (var key in obj) {
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = obj[key];
      if (key === selectedKey) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function populateSelectArr(id, arr, selectedVal) {
    var sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    for (var i = 0; i < arr.length; i++) {
      var opt = document.createElement('option');
      opt.value = arr[i];
      opt.textContent = arr[i];
      if (arr[i] === selectedVal) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  // ==================== ИНИЦИАЛИЗАЦИЯ ====================

  function init() {
    Calc = global.AirDemandCalc;
    if (!Calc) { console.error('AirDemandCalc не загружен'); return; }

    appData = loadData();
    recalcAll();
    renderCoeffs();
    renderTable();

    // Варианты
    var varSel = document.getElementById('variantSelect');
    if (varSel && appData.variant) varSel.value = appData.variant;

    // Навешиваем события на поля модалки
    var modalInputs = [
      'excType', 'excSectionType', 'excArea', 'excPeople',
      'excGasEmission', 'excGasUneven', 'excGasCdop', 'excGasC0',
      'excBlastMass', 'excBlastLength', 'excBlastGasRate', 'excBlastVentTime', 'excBlastWetness', 'excBlastLeakage',
      'excLhdCO', 'excLhdNO2', 'excLhdVol', 'excLhdRPM', 'excLhdPower', 'excLhdFuel',
      'excScalerCO', 'excScalerNO2', 'excScalerVol', 'excScalerRPM', 'excScalerPower', 'excScalerFuel',
      'excPdkCO', 'excPdkNO2', 'excAirFuel', 'excDensity', 'excO2',
      'excChamberVolume'
    ];
    for (var i = 0; i < modalInputs.length; i++) {
      var el = document.getElementById(modalInputs[i]);
      if (el) {
        el.addEventListener('input', updateModalDerived);
        el.addEventListener('change', updateModalDerived);
      }
    }

    // Коэффициенты
    var coeffIds = ['coeffKrud', 'coeffKnerav', 'coeffKblock', 'coeffKut', 'qTransport'];
    for (var j = 0; j < coeffIds.length; j++) {
      var el2 = document.getElementById(coeffIds[j]);
      if (el2) el2.addEventListener('change', onCoeffChange);
    }

    // Камеры
    var chamberIds = ['chamberGSHO', 'chamberVM', 'chamberGSM'];
    for (var k = 0; k < chamberIds.length; k++) {
      var el3 = document.getElementById(chamberIds[k]);
      if (el3) el3.addEventListener('change', onChamberChange);
    }
  }

  // ==================== ЭКСПОРТ ====================

  global.AirDemandUI = {
    init: init,
    addExcavation: addExcavation,
    removeExcavation: removeExcavation,
    saveExcModal: saveExcModal,
    closeExcModal: closeExcModal,
    openExcModal: openExcModal,
    onVariantChange: onVariantChange,
    toggleSection: toggleSection,
    exportCSV: exportCSV
  };

})(window);
