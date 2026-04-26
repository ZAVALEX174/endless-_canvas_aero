// modals.js — Модальные окна, извлечено из main5.js
(function() {

function createModal(id, title, content, footerButtons = []) {
  let modal = document.getElementById(id);
  if (modal) {
    const contentDiv = document.getElementById(id + 'Content');
    if (contentDiv) contentDiv.innerHTML = content;
    modal.style.display = 'flex';
    return;
  }

  const footerHtml = footerButtons.map(btn =>
    `<button class="btn ${btn.class}" onclick="${btn.onClick}">${btn.text}</button>`
  ).join('');

  const modalHtml = `
    <div id="${id}" class="modal">
      <div class="modal-content" style="max-width:600px;">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="close-btn" onclick="document.getElementById('${id}').style.display='none'">×</button>
        </div>
        <div id="${id}Content" class="modal-body">${content}</div>
        <div class="modal-footer">
          ${footerHtml}
          <button class="btn btn-secondary" onclick="document.getElementById('${id}').style.display='none'">Закрыть</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  document.getElementById(id).style.display = 'flex';
}

function showIntersectionPointInfoModal(pointData) {
  // Удаляем старый модал, чтобы обновился footer (createModal при существующем
  // элементе обновляет только тело — но нам нужен свежий набор кнопок).
  const oldModal = document.getElementById('intersectionPointModal');
  if (oldModal) oldModal.remove();

  let html = `<p><strong>Координаты:</strong> (${pointData.x.toFixed(1)}, ${pointData.y.toFixed(1)})</p>`;
  html += `<p><strong>Линий в точке:</strong> ${pointData.linesInPoint.length}</p>`;
  for (let i = 0; i < pointData.linesInPoint.length; i++) {
    const l = pointData.linesInPoint[i];
    html += `<p>${i + 1}. ${escapeHtml(l.name)} — ${l.isStart ? 'начало' : l.isEnd ? 'конец' : 'на линии'} (Q=${l.airVolume.toFixed(3)})</p>`;
  }
  html += `<p><strong>Объектов:</strong> ${pointData.objectsInPoint.length}</p>`;
  for (let o of pointData.objectsInPoint) {
    html += `<p>${escapeHtml(o.name)} (Q=${escapeHtml(o.airVolume)}, R=${escapeHtml(o.airResistance)})</p>`;
  }

  // п.5: Если точка — тупик (степень = 1, единственная линия заканчивается здесь),
  // добавляем кнопку запечатать/открыть. Раньше это было только через ПКМ-меню.
  const footerButtons = [];
  const degreeAtPoint = (pointData.linesStarting || 0) + (pointData.linesEnding || 0);
  if (degreeAtPoint === 1 && pointData.linesInPoint.length === 1) {
    const firstLine = pointData.linesInPoint[0].line;
    const lid = (firstLine && firstLine.properties && firstLine.properties.layerId) || 'default';
    const ck = typeof getCalcNodeKey === 'function' ? getCalcNodeKey : getPointKey;
    const nodeKey = (typeof getCalcNodeKey === 'function')
      ? ck(pointData.x, pointData.y, lid)
      : getPointKey(pointData.x, pointData.y);
    const isSealed = !!(window.sealedNodes && window.sealedNodes.has(nodeKey));
    html += `<p><em>Состояние тупика: ${isSealed ? 'запечатан (глухой)' : 'открыт (связь с атмосферой)'}</em></p>`;
    // Сохраняем nodeKey в глобальной переменной — иначе при инлайн-onClick
    // надо экранировать кавычки и спецсимволы; так проще и безопаснее.
    window._pendingSealNodeKeyFromModal = nodeKey;
    footerButtons.push({
      text: isSealed ? 'Открыть тупик (атмосфера)' : 'Запечатать тупик (глухой)',
      class: 'btn-primary',
      onClick: "toggleSealedNode(window._pendingSealNodeKeyFromModal); document.getElementById('intersectionPointModal').style.display='none';"
    });
  }

  createModal('intersectionPointModal', 'Информация о точке', html, footerButtons);
}

function updateLineModalDerivedValues() {
  const sectionType = document.getElementById('propertySectionType')?.value || AIR_MODEL_CONFIG.DEFAULT_SECTION;
  const area = parseFloat(document.getElementById('propertyCrossSectionalArea')?.value) || 0;
  const length = parseFloat(document.getElementById('propertyPassageLength')?.value) || 0;
  const perimeter = calculateLinePerimeter(area, sectionType);
  const xFactor = calculateGeometryFactor(perimeter, length, area);
  const perimeterInput = document.getElementById('propertyPerimeterPreview');
  if (perimeterInput) perimeterInput.value = formatTo5(perimeter);
  const xInput = document.getElementById('propertyXFactorPreview');
  if (xInput) xInput.value = formatTo5(xFactor);
}

function handleSupportTypeChange() {
  const supportType = document.getElementById('propertySupportType')?.value || AIR_MODEL_CONFIG.DEFAULT_SUPPORT;
  const roughnessInput = document.getElementById('propertyRoughnessCoefficient');
  if (roughnessInput && supportType !== 'Пользовательский') {
    roughnessInput.value = formatTo5(getDefaultSupportRoughness(supportType));
  }
}

function updateObjectPropertyVisibility() {
  const type = document.getElementById('objPropertyType')?.value || 'default';
  const fanRow = document.getElementById('objFanModeRow');
  const doorRow = document.getElementById('objDoorModeRow');
  const atmosphereCard = document.getElementById('objAtmosphereCard');
  const airResistanceInput = document.getElementById('objAirResistance');

  if (fanRow) fanRow.style.display = type === 'fan' ? 'flex' : 'none';
  const flowSourceRow = document.getElementById('objIsFlowSource');
  if (flowSourceRow) flowSourceRow.closest('.form-group').style.display = type === 'fan' ? 'flex' : 'none';
  if (doorRow) doorRow.style.display = type === 'valve' ? 'flex' : 'none';
  if (atmosphereCard) atmosphereCard.style.display = type === 'atmosphere' ? 'block' : 'none';

  // ВМП (местное проветривание): давление вентилятора, когда isFlowSource снят
  const localFanRow = document.getElementById('objLocalFanRow');
  if (localFanRow) {
    const isFlowSrc = document.getElementById('objIsFlowSource')?.checked !== false;
    localFanRow.style.display = (type === 'fan' && !isFlowSrc) ? 'flex' : 'none';
  }
  // Потребитель: показываем для всех типов кроме fan и atmosphere
  const consumerRow = document.getElementById('objConsumerRow');
  if (consumerRow) consumerRow.style.display = (type !== 'fan' && type !== 'atmosphere') ? 'flex' : 'none';
  const consumeFlowGroup = document.getElementById('objConsumeFlowGroup');
  if (consumeFlowGroup) {
    const isConsumer = document.getElementById('objIsConsumer')?.checked;
    consumeFlowGroup.style.display = isConsumer ? 'flex' : 'none';
  }
  if (airResistanceInput) {
    airResistanceInput.readOnly = type === 'valve' || type === 'atmosphere';
  }
  updateDoorResistancePreview();
  updateAtmosphereDerivedValues();
}

function updateDoorResistancePreview() {
  const type = document.getElementById('objPropertyType')?.value || 'default';
  if (type !== 'valve') return;
  const doorMode = document.getElementById('objDoorMode')?.value || 'open';
  const windowArea = document.getElementById('objWindowArea')?.value || '1';
  const resistance = getDoorResistanceByMode(doorMode, windowArea);
  const input = document.getElementById('objAirResistance');
  if (input) input.value = formatTo5(resistance);
  const row = document.getElementById('objWindowAreaRow');
  if (row) row.style.display = doorMode === 'window' ? 'block' : 'none';
}

function updateAtmosphereDerivedValues() {
  const type = document.getElementById('objPropertyType')?.value || 'default';
  if (type !== 'atmosphere') return;
  const height = parseFloat(document.getElementById('objAtmosphereHeight')?.value) || 0;
  const temp1 = parseFloat(document.getElementById('objAtmosphereTemp1')?.value) || 0;
  const temp2 = parseFloat(document.getElementById('objAtmosphereTemp2')?.value) || 0;
  const sign = parseFloat(document.getElementById('objAtmosphereSign')?.value) || 1;
  const heMm = calculateAtmosphericNaturalDraftMm(height, temp1, temp2);
  const hePa = calculateAtmosphericNaturalDraftPa(height, temp1, temp2, sign);
  const heMmInput = document.getElementById('objAtmosphereHeMm');
  const hePaInput = document.getElementById('objAtmosphereHePa');
  if (heMmInput) heMmInput.value = formatTo5(heMm);
  if (hePaInput) hePaInput.value = formatTo5(hePa);
}

function _setModelParamsLocked(fieldIds, locked) {
  fieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });
}

function toggleLineModelParamsEdit() {
  const fields = ['propertyResultFlow', 'propertyResultVelocity', 'propertyResultResistance'];
  const btn = document.getElementById('lineEditModelParamsBtn');
  const cancelBtn = document.getElementById('lineModelParamsCancelBtn');
  const resetBtn = document.getElementById('lineModelParamsResetBtn');
  const isEditing = fields.some(id => !document.getElementById(id)?.disabled);
  if (isEditing) {
    // Зафиксировать
    _setModelParamsLocked(fields, true);
    if (btn) btn.textContent = 'Редактировать';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (resetBtn) resetBtn.style.display = '';
    if (currentEditingLine) {
      const p = currentEditingLine.properties || {};
      const flow = parseFloat(document.getElementById('propertyResultFlow')?.value);
      const vel = parseFloat(document.getElementById('propertyResultVelocity')?.value);
      const res = parseFloat(document.getElementById('propertyResultResistance')?.value);
      if (!isNaN(flow)) { p.manualFlow = flow; p.airVolume = flow; }
      if (!isNaN(vel)) { p.manualVelocity = vel; }
      if (!isNaN(res)) { p.manualResistance = res; }
      p.manualOverride = true;
      currentEditingLine.set('properties', p);
    }
    showNotification('Значения зафиксированы вручную', 'info');
  } else {
    // Разблокировать для редактирования
    _setModelParamsLocked(fields, false);
    if (btn) btn.textContent = 'Зафиксировать';
    if (cancelBtn) cancelBtn.style.display = '';
    if (resetBtn) resetBtn.style.display = 'none';
  }
}

function cancelLineModelParamsEdit() {
  const fields = ['propertyResultFlow', 'propertyResultVelocity', 'propertyResultResistance'];
  const btn = document.getElementById('lineEditModelParamsBtn');
  const cancelBtn = document.getElementById('lineModelParamsCancelBtn');
  const resetBtn = document.getElementById('lineModelParamsResetBtn');
  _setModelParamsLocked(fields, true);
  if (btn) btn.textContent = 'Редактировать';
  if (cancelBtn) cancelBtn.style.display = 'none';
  // Восстановить значения из объекта
  if (currentEditingLine) {
    const p = currentEditingLine.properties || {};
    const flowEl = document.getElementById('propertyResultFlow');
    const velEl = document.getElementById('propertyResultVelocity');
    const resEl = document.getElementById('propertyResultResistance');
    if (flowEl) flowEl.value = formatTo5(p.airVolume || 0);
    if (velEl) velEl.value = formatTo5(p.velocity || 0);
    if (resEl) resEl.value = formatTo5(p.totalResistance || p.airResistance || 0);
    if (resetBtn) resetBtn.style.display = p.manualOverride ? '' : 'none';
  }
}

function resetLineModelParams() {
  if (!currentEditingLine) return;
  const p = currentEditingLine.properties || {};
  delete p.manualOverride;
  delete p.manualFlow;
  delete p.manualVelocity;
  delete p.manualResistance;
  currentEditingLine.set('properties', p);
  // Обновить поля в модалке
  const flowEl = document.getElementById('propertyResultFlow');
  const velEl = document.getElementById('propertyResultVelocity');
  const resEl = document.getElementById('propertyResultResistance');
  if (flowEl) { flowEl.value = formatTo5(p.airVolume || 0); flowEl.disabled = true; }
  if (velEl) { velEl.value = formatTo5(p.velocity || 0); velEl.disabled = true; }
  if (resEl) { resEl.value = formatTo5(p.totalResistance || p.airResistance || 0); resEl.disabled = true; }
  const btn = document.getElementById('lineEditModelParamsBtn');
  if (btn) btn.textContent = 'Редактировать';
  const resetBtn = document.getElementById('lineModelParamsResetBtn');
  if (resetBtn) resetBtn.style.display = 'none';
  showNotification('Ручные значения сброшены. Пересчитайте сеть.', 'info');
}

function toggleObjModelParamsEdit() {
  const fields = ['objResultFlow', 'objResultVelocity', 'objResultResistance'];
  const btn = document.getElementById('objEditModelParamsBtn');
  const cancelBtn = document.getElementById('objModelParamsCancelBtn');
  const resetBtn = document.getElementById('objModelParamsResetBtn');
  const isEditing = fields.some(id => !document.getElementById(id)?.disabled);
  if (isEditing) {
    _setModelParamsLocked(fields, true);
    if (btn) btn.textContent = 'Редактировать';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (resetBtn) resetBtn.style.display = '';
    if (currentEditingObject) {
      const p = currentEditingObject.properties || {};
      const flow = parseFloat(document.getElementById('objResultFlow')?.value);
      const vel = parseFloat(document.getElementById('objResultVelocity')?.value);
      const res = parseFloat(document.getElementById('objResultResistance')?.value);
      if (!isNaN(flow)) { p.manualFlow = flow; }
      if (!isNaN(vel)) { p.manualVelocity = vel; }
      if (!isNaN(res)) { p.manualResistance = res; }
      p.manualOverride = true;
      currentEditingObject.set('properties', p);
    }
    showNotification('Значения зафиксированы вручную', 'info');
  } else {
    _setModelParamsLocked(fields, false);
    if (btn) btn.textContent = 'Зафиксировать';
    if (cancelBtn) cancelBtn.style.display = '';
    if (resetBtn) resetBtn.style.display = 'none';
  }
}

function cancelObjModelParamsEdit() {
  const fields = ['objResultFlow', 'objResultVelocity', 'objResultResistance'];
  const btn = document.getElementById('objEditModelParamsBtn');
  const cancelBtn = document.getElementById('objModelParamsCancelBtn');
  const resetBtn = document.getElementById('objModelParamsResetBtn');
  _setModelParamsLocked(fields, true);
  if (btn) btn.textContent = 'Редактировать';
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (currentEditingObject) {
    const p = currentEditingObject.properties || {};
    const flowEl = document.getElementById('objResultFlow');
    const velEl = document.getElementById('objResultVelocity');
    const resEl = document.getElementById('objResultResistance');
    if (flowEl) flowEl.value = formatTo5(p.airVolume || 0);
    if (velEl) velEl.value = '';
    if (resEl) resEl.value = formatTo5(p.airResistance || 0);
    if (resetBtn) resetBtn.style.display = p.manualOverride ? '' : 'none';
  }
}

function resetObjModelParams() {
  if (!currentEditingObject) return;
  const p = currentEditingObject.properties || {};
  delete p.manualOverride;
  delete p.manualFlow;
  delete p.manualVelocity;
  delete p.manualResistance;
  currentEditingObject.set('properties', p);
  const flowEl = document.getElementById('objResultFlow');
  const velEl = document.getElementById('objResultVelocity');
  const resEl = document.getElementById('objResultResistance');
  if (flowEl) { flowEl.value = formatTo5(p.airVolume || 0); flowEl.disabled = true; }
  if (velEl) { velEl.value = ''; velEl.disabled = true; }
  if (resEl) { resEl.value = formatTo5(p.airResistance || 0); resEl.disabled = true; }
  const btn = document.getElementById('objEditModelParamsBtn');
  if (btn) btn.textContent = 'Редактировать';
  const resetBtn = document.getElementById('objModelParamsResetBtn');
  if (resetBtn) resetBtn.style.display = 'none';
  showNotification('Ручные значения сброшены. Пересчитайте сеть.', 'info');
}

function showLinePropertiesModal() {
  const line = canvas.getActiveObject();
  if (!line || line.type !== 'line') {
    showNotification('Выберите линию', 'error');
    return;
  }
  currentEditingLine = line;
  normalizeLineProperties(line);
  const p = line.properties || {};
  document.getElementById('propertyName').value = p.name || '';
  document.getElementById('propertyColor').value = line.stroke || APP_CONFIG.DEFAULT_LINE_COLOR;
  document.getElementById('propertyWidth').value = line.strokeWidth || APP_CONFIG.DEFAULT_LINE_WIDTH;
  document.getElementById('propertyPassageLength').value = formatTo5(p.passageLength || 0.5);
  document.getElementById('propertySectionType').value = p.sectionType || AIR_MODEL_CONFIG.DEFAULT_SECTION;
  document.getElementById('propertySupportType').value = p.supportType || AIR_MODEL_CONFIG.DEFAULT_SUPPORT;
  document.getElementById('propertyRoughnessCoefficient').value = formatTo5(p.roughnessCoefficient || getDefaultSupportRoughness(p.supportType));
  document.getElementById('propertyCrossSectionalArea').value = formatTo5(p.crossSectionalArea || 10);
  document.getElementById('propertyAirVolume').value = formatTo5(p.boundaryFlow || 0);
  const xPreviewInput = document.getElementById('propertyXFactorPreview');
  if (xPreviewInput) {
    xPreviewInput.value = formatTo5(p.xFactor || calculateGeometryFactor(p.perimeter, p.passageLength, p.crossSectionalArea));
  }
  const localResistanceInput = document.getElementById('propertyLocalObjectResistance');
  if (localResistanceInput) {
    localResistanceInput.value = formatTo5(getManualLineObjectResistance(p));
  }
  const airInput = document.getElementById('propertyAirVolume');
  airInput.readOnly = !!(line.lineStartsFromObject && line.startObject);

  // Новые поля
  const numEl = document.getElementById('propertyNumber');
  if (numEl) numEl.value = p.number || '';
  const statusEl = document.getElementById('propertyStatus');
  if (statusEl) statusEl.value = p.status || '';
  const displayEl = document.getElementById('propertyDisplay');
  if (displayEl) displayEl.value = p.display || 'normal';

  // Слой
  if (typeof populateLayerSelects === 'function') populateLayerSelects();
  const layerEl = document.getElementById('propertyLayer');
  if (layerEl) layerEl.value = p.layerId || 'default';

  // Модельные параметры
  const flowEl = document.getElementById('propertyResultFlow');
  const velEl = document.getElementById('propertyResultVelocity');
  const resEl = document.getElementById('propertyResultResistance');
  if (flowEl) { flowEl.value = formatTo5(p.airVolume || 0); flowEl.disabled = !p.manualOverride; }
  if (velEl) { velEl.value = formatTo5(p.velocity || 0); velEl.disabled = !p.manualOverride; }
  if (resEl) { resEl.value = formatTo5(p.totalResistance || p.airResistance || 0); resEl.disabled = !p.manualOverride; }
  const editBtn = document.getElementById('lineEditModelParamsBtn');
  if (editBtn) editBtn.textContent = p.manualOverride ? 'Зафиксировать' : 'Редактировать';
  const lineResetBtn = document.getElementById('lineModelParamsResetBtn');
  if (lineResetBtn) lineResetBtn.style.display = p.manualOverride ? '' : 'none';
  const lineCancelBtn = document.getElementById('lineModelParamsCancelBtn');
  if (lineCancelBtn) lineCancelBtn.style.display = 'none';

  updateLineModalDerivedValues();
  document.getElementById('linePropertiesModal').style.display = 'flex';
}

function closeLinePropertiesModal() {
  document.getElementById('linePropertiesModal').style.display = 'none';
  currentEditingLine = null;
}

function applyLineProperties() {
  if (!currentEditingLine) return;
  const sectionType = document.getElementById('propertySectionType').value || AIR_MODEL_CONFIG.DEFAULT_SECTION;
  const supportType = document.getElementById('propertySupportType').value || AIR_MODEL_CONFIG.DEFAULT_SUPPORT;
  const passage = parseFloat(document.getElementById('propertyPassageLength').value) || 0.5;
  const rough = parseFloat(document.getElementById('propertyRoughnessCoefficient').value) || getDefaultSupportRoughness(supportType);
  const area = parseFloat(document.getElementById('propertyCrossSectionalArea').value) || 10;
  const hydraulicBase = recalculateLineHydraulicBase({
    sectionType,
    supportType,
    roughnessCoefficient: rough,
    crossSectionalArea: area,
    passageLength: passage
  });
  const perim = hydraulicBase.perimeter;
  const resistance = hydraulicBase.baseResistance;
  const manualLocalObjectResistance = roundTo5(parseFloat(document.getElementById('propertyLocalObjectResistance')?.value) || 0);

  let boundaryFlow = parseFloat(document.getElementById('propertyAirVolume').value) || 0;
  if (currentEditingLine.lineStartsFromObject && currentEditingLine.startObject) {
    const startProps = synchronizeObjectDerivedProperties(currentEditingLine.startObject.properties || {});
    boundaryFlow = getObjectSupplyContribution(startProps);
  }

  const newProps = {
    ...(currentEditingLine.properties || {}),
    name: document.getElementById('propertyName').value,
    number: parseInt(document.getElementById('propertyNumber')?.value) || (currentEditingLine.properties || {}).number || undefined,
    layerId: document.getElementById('propertyLayer')?.value || 'default',
    status: document.getElementById('propertyStatus')?.value || '',
    display: document.getElementById('propertyDisplay')?.value || 'normal',
    passageLength: roundTo5(passage),
    sectionType,
    supportType,
    roughnessCoefficient: roundTo5(rough),
    crossSectionalArea: roundTo5(area),
    perimeter: roundTo5(perim),
    xFactor: hydraulicBase.xFactor,
    airResistance: roundTo5(resistance),
    baseResistance: roundTo5(resistance),
    manualLocalObjectResistance,
    localObjectResistance: manualLocalObjectResistance,
    objectResistance: manualLocalObjectResistance,
    totalResistance: roundTo5(resistance + manualLocalObjectResistance),
    branchTotalResistance: roundTo5(resistance + manualLocalObjectResistance),
    branchDepression: 0,
    boundaryFlow: roundTo5(boundaryFlow),
    airVolume: roundTo5(boundaryFlow)
  };

  saveToUndoStack();
  currentEditingLine.set({
    stroke: document.getElementById('propertyColor').value,
    strokeWidth: parseInt(document.getElementById('propertyWidth').value),
    properties: newProps
  });
  if (typeof applyLayerColorToObject === 'function') applyLayerColorToObject(currentEditingLine);
  updateDerivedLineFields(currentEditingLine);
  createOrUpdateAirVolumeText(currentEditingLine);
  canvas.renderAll();
  updatePropertiesPanel();
  closeLinePropertiesModal();
  showNotification('Свойства ветви обновлены', 'success');
}

function showObjectPropertiesModal() {
  const obj = canvas.getActiveObject();
  if (!obj) {
    showNotification('Выберите объект', 'error');
    return;
  }
  if (obj.type === 'line') {
    showLinePropertiesModal();
    return;
  }
  currentEditingObject = obj;
  currentEditingObjectType = obj.type;
  const p = synchronizeObjectDerivedProperties(obj.properties || {});
  document.getElementById('objPropertyName').value = p.name || '';
  document.getElementById('objPropertyType').value = p.type || 'default';
  document.getElementById('objPropertyX').value = roundTo5(obj.left);
  document.getElementById('objPropertyY').value = roundTo5(obj.top);
  document.getElementById('objPropertyWidth').value = roundTo5(obj.width * obj.scaleX);
  document.getElementById('objPropertyHeight').value = roundTo5(obj.height * obj.scaleY);
  document.getElementById('objAirVolume').value = formatTo5(p.airVolume || 0);
  document.getElementById('objAirResistance').value = formatTo5(p.airResistance || 0);
  document.getElementById('objFanMode').value = p.fanMode || 'supply';
  const flowSourceCheckbox = document.getElementById('objIsFlowSource');
  if (flowSourceCheckbox) flowSourceCheckbox.checked = p.isFlowSource !== false;
  const fanStaticPressureEl = document.getElementById('objFanStaticPressure');
  if (fanStaticPressureEl) fanStaticPressureEl.value = formatTo5(p.fanStaticPressure || 0);
  const localFanFlowEl = document.getElementById('objLocalFanFlow');
  if (localFanFlowEl) localFanFlowEl.value = formatTo5(p.localFanFlow || 0);
  const isConsumerEl = document.getElementById('objIsConsumer');
  if (isConsumerEl) isConsumerEl.checked = !!p.isConsumer;
  const consumeFlowEl = document.getElementById('objConsumeFlow');
  if (consumeFlowEl) consumeFlowEl.value = formatTo5(p.consumeFlow || 0);
  document.getElementById('objDoorMode').value = p.doorMode || 'open';
  document.getElementById('objWindowArea').value = String(p.windowArea || '1');
  document.getElementById('objAtmosphereHeight').value = formatTo5(p.atmosphereHeight || 0);
  document.getElementById('objAtmosphereTemp1').value = formatTo5(p.atmosphereTemp1 || 0);
  document.getElementById('objAtmosphereTemp2').value = formatTo5(p.atmosphereTemp2 || 0);
  document.getElementById('objAtmosphereSign').value = String(p.atmosphereSign || 1);
  // Скрыть X, Y, ширину и высоту — служебные поля, не нужны пользователю
  var xInput = document.getElementById('objPropertyX');
  var yInput = document.getElementById('objPropertyY');
  if (xInput) { var xRow = xInput.closest('.form-row') || xInput.closest('.form-group'); if (xRow) xRow.style.display = 'none'; }
  if (yInput) { var yRow = yInput.closest('.form-row') || yInput.closest('.form-group'); if (yRow) yRow.style.display = 'none'; }
  var widthRow = document.getElementById('objPropertyWidth');
  if (widthRow) { var wr = widthRow.closest('.form-row') || widthRow.closest('.form-group'); if (wr) wr.style.display = 'none'; }
  var heightRow = document.getElementById('objPropertyHeight');
  if (heightRow) { var hr = heightRow.closest('.form-row') || heightRow.closest('.form-group'); if (hr) hr.style.display = 'none'; }

  // Новые поля
  const numEl = document.getElementById('objPropertyNumber');
  if (numEl) numEl.value = p.number || '';
  const statusEl = document.getElementById('objPropertyStatus');
  if (statusEl) statusEl.value = p.status || '';

  // Слой
  if (typeof populateLayerSelects === 'function') populateLayerSelects();
  const layerEl = document.getElementById('objPropertyLayer');
  if (layerEl) layerEl.value = p.layerId || 'default';

  // Модельные параметры
  const flowEl = document.getElementById('objResultFlow');
  const velEl = document.getElementById('objResultVelocity');
  const resEl = document.getElementById('objResultResistance');
  if (flowEl) { flowEl.value = formatTo5(p.airVolume || 0); flowEl.disabled = !p.manualOverride; }
  if (velEl) { velEl.value = ''; velEl.disabled = !p.manualOverride; }
  if (resEl) { resEl.value = formatTo5(p.airResistance || 0); resEl.disabled = !p.manualOverride; }
  const editBtn = document.getElementById('objEditModelParamsBtn');
  if (editBtn) editBtn.textContent = p.manualOverride ? 'Зафиксировать' : 'Редактировать';
  const objResetBtn = document.getElementById('objModelParamsResetBtn');
  if (objResetBtn) objResetBtn.style.display = p.manualOverride ? '' : 'none';
  const objCancelBtn = document.getElementById('objModelParamsCancelBtn');
  if (objCancelBtn) objCancelBtn.style.display = 'none';

  updateObjectPropertyVisibility();
  document.getElementById('objectPropertiesModal').style.display = 'flex';
}

function closeObjectPropertiesModal() {
  document.getElementById('objectPropertiesModal').style.display = 'none';
  currentEditingObject = null;
}

function applyObjectProperties() {
  if (!currentEditingObject) return;
  saveToUndoStack();
  const objectType = document.getElementById('objPropertyType').value;
  const old = currentEditingObject.properties || {};
  const newProps = synchronizeObjectDerivedProperties({
    ...old,
    name: document.getElementById('objPropertyName').value.trim(),
    number: parseInt(document.getElementById('objPropertyNumber')?.value) || old.number || undefined,
    layerId: document.getElementById('objPropertyLayer')?.value || 'default',
    status: document.getElementById('objPropertyStatus')?.value || '',
    type: objectType,
    // п.17: для вентилятора airVolume — это МОДУЛЬ расхода. Знак берётся
    // из fanMode (supply=+, reverse=-) в getObjectSupplyContribution.
    // Math.abs страхует случаи вставки/импорта отрицательных значений.
    airVolume: (objectType === 'fan')
      ? Math.abs(roundTo5(parseFloat(document.getElementById('objAirVolume').value) || 0))
      : roundTo5(parseFloat(document.getElementById('objAirVolume').value) || 0),
    airResistance: roundTo5(parseFloat(document.getElementById('objAirResistance').value) || 0),
    fanMode: document.getElementById('objFanMode').value,
    isFlowSource: objectType === 'fan'
      ? (document.getElementById('objIsFlowSource')?.checked !== false)
      : false,
    fanStaticPressure: objectType === 'fan'
      ? roundTo5(parseFloat(document.getElementById('objFanStaticPressure')?.value) || 0)
      : 0,
    localFanFlow: objectType === 'fan'
      ? roundTo5(parseFloat(document.getElementById('objLocalFanFlow')?.value) || 0)
      : 0,
    isConsumer: document.getElementById('objIsConsumer')?.checked || false,
    consumeFlow: roundTo5(parseFloat(document.getElementById('objConsumeFlow')?.value) || 0),
    doorMode: document.getElementById('objDoorMode').value,
    windowArea: document.getElementById('objWindowArea').value,
    atmosphereHeight: roundTo5(parseFloat(document.getElementById('objAtmosphereHeight').value) || 0),
    atmosphereTemp1: roundTo5(parseFloat(document.getElementById('objAtmosphereTemp1').value) || 0),
    atmosphereTemp2: roundTo5(parseFloat(document.getElementById('objAtmosphereTemp2').value) || 0),
    atmosphereSign: parseFloat(document.getElementById('objAtmosphereSign').value) || 1
  });

  const left = parseFloat(document.getElementById('objPropertyX').value);
  const top = parseFloat(document.getElementById('objPropertyY').value);
  currentEditingObject.set({
    left: isNaN(left) ? currentEditingObject.left : roundTo5(left),
    top: isNaN(top) ? currentEditingObject.top : roundTo5(top),
    properties: newProps
  });
  if (typeof applyLayerColorToObject === 'function') applyLayerColorToObject(currentEditingObject);
  invalidateCache();

  // Если изменился вентилятор (fanMode/isFlowSource/airVolume) — пересчитать сеть
  // автоматически, чтобы стрелки и расходы соответствовали новому режиму.
  const _isFan = (newProps.type === 'fan');
  const _fanModeChanged = _isFan && (
    (old.fanMode || 'supply') !== (newProps.fanMode || 'supply') ||
    (old.isFlowSource !== newProps.isFlowSource) ||
    (parseFloat(old.airVolume) || 0) !== (parseFloat(newProps.airVolume) || 0)
  );

  canvas.renderAll();
  updatePropertiesPanel();
  closeObjectPropertiesModal();
  showNotification('Свойства объекта обновлены', 'success');

  if (_fanModeChanged && typeof calculateAirFlowsSafe === 'function') {
    setTimeout(() => calculateAirFlowsSafe(), 50);
  }
}

function deleteCurrentObject() {
  if (!currentEditingObject || !confirm('Удалить объект?')) return;
  if (currentEditingObject.type === 'line') {
    const _ep2c = getLineAbsoluteEndpoints(currentEditingObject);
    const startKey = getPointKey(_ep2c.x1, _ep2c.y1);
    const endKey = getPointKey(_ep2c.x2, _ep2c.y2);
    const startNode = window.connectionNodes ? window.connectionNodes.get(startKey) : null;
    const endNode = window.connectionNodes ? window.connectionNodes.get(endKey) : null;
    if ((startNode && startNode.locked && startNode.incomingEdges.length + startNode.outgoingEdges.length > 1) ||
      (endNode && endNode.locked && endNode.incomingEdges.length + endNode.outgoingEdges.length > 1)) {
      if (!confirm('Линия в заблокированном узле. Всё равно удалить?')) return;
    }
  }
  saveToUndoStack();
  canvas.remove(currentEditingObject);
  canvas.renderAll();
  closeObjectPropertiesModal();
  updatePropertiesPanel();
  showNotification('Объект удалён', 'info');
}

function showAddImageModal() {
  document.getElementById('addImageModal').style.display = 'flex';
  document.getElementById('addImageForm').reset();
}

function closeAddImageModal() {
  document.getElementById('addImageModal').style.display = 'none';
}

function addNewImage() {
  const name = document.getElementById('newImageName').value.trim();
  const type = document.getElementById('newImageType').value;
  const url = document.getElementById('newImageUrl').value.trim();
  if (!name || !url) {
    showNotification('Заполните все поля', 'error');
    return;
  }
  allImages.push({ id: 'custom_' + Date.now(), name, path: url, type });
  updateImageLibrary();
  closeAddImageModal();
  showNotification(`Изображение ${name} добавлено`, 'success');
}

function clearCanvas() {
  if (!confirm('Очистить холст?')) return;
  deactivateAllModes();
  clearIntersectionPoints();
  const objects = canvas.getObjects();
  for (let obj of objects) {
    if (obj.id !== 'grid-group' && obj.id !== 'grid-line') canvas.remove(obj);
  }
  if (window.connectionNodes) window.connectionNodes.clear();
  invalidateCache();
  canvas.renderAll();
  updatePropertiesPanel();
  if (typeof clearAutoSave === 'function') clearAutoSave();
  if (typeof setLayersData === 'function') {
    setLayersData([{ id: 'default', name: 'Основной', visible: true, locked: true, color: null }]);
  }
  if (typeof setCrossLayerConnections === 'function') setCrossLayerConnections([]);
  showNotification('Холст очищен', 'info');
}

function initializeModals() {
  const lineForm = document.getElementById('linePropertiesForm');
  if (lineForm) lineForm.addEventListener('submit', e => {
    e.preventDefault();
    applyLineProperties();
  });
  const addForm = document.getElementById('addImageForm');
  if (addForm) addForm.addEventListener('submit', e => {
    e.preventDefault();
    addNewImage();
  });
  const objForm = document.getElementById('objectPropertiesForm');
  if (objForm) objForm.addEventListener('submit', e => {
    e.preventDefault();
    applyObjectProperties();
  });

  const sectionInput = document.getElementById('propertySectionType');
  const areaInput = document.getElementById('propertyCrossSectionalArea');
  const supportInput = document.getElementById('propertySupportType');
  if (sectionInput) sectionInput.addEventListener('change', updateLineModalDerivedValues);
  if (areaInput) areaInput.addEventListener('input', updateLineModalDerivedValues);
  if (supportInput) supportInput.addEventListener('change', () => {
    handleSupportTypeChange();
    updateLineModalDerivedValues();
  });

  const objectTypeInput = document.getElementById('objPropertyType');
  const doorModeInput = document.getElementById('objDoorMode');
  const windowInput = document.getElementById('objWindowArea');
  const atmosphereInputs = ['objAtmosphereHeight', 'objAtmosphereTemp1', 'objAtmosphereTemp2', 'objAtmosphereSign']
    .map(id => document.getElementById(id))
    .filter(Boolean);

  if (objectTypeInput) objectTypeInput.addEventListener('change', updateObjectPropertyVisibility);
  if (doorModeInput) doorModeInput.addEventListener('change', updateDoorResistancePreview);
  if (windowInput) windowInput.addEventListener('change', updateDoorResistancePreview);
  atmosphereInputs.forEach(input => input.addEventListener('input', updateAtmosphereDerivedValues));
  atmosphereInputs.forEach(input => input.addEventListener('change', updateAtmosphereDerivedValues));

  const modals = document.querySelectorAll('.modal');
  for (let m of modals) {
    m.addEventListener('click', function (e) {
      if (e.target === this) this.style.display = 'none';
    });
  }
}

function addChainAnalysisButtons() {
  const bar = document.querySelector('.app-context-bar');
  if (!bar) return;
  const btn1 = document.createElement('button');
  btn1.textContent = 'Анализ цепочки';
  btn1.className = 'context-btn';
  btn1.onclick = analyzeSelectedChain;
  bar.appendChild(btn1);
  const btn2 = document.createElement('button');
  btn2.textContent = 'Все цепочки';
  btn2.className = 'context-btn';
  btn2.onclick = showAllChainsSummary;
  bar.appendChild(btn2);
}

// Экспорт в глобальную область
window.toggleLineModelParamsEdit = toggleLineModelParamsEdit;
window.cancelLineModelParamsEdit = cancelLineModelParamsEdit;
window.resetLineModelParams = resetLineModelParams;
window.toggleObjModelParamsEdit = toggleObjModelParamsEdit;
window.cancelObjModelParamsEdit = cancelObjModelParamsEdit;
window.resetObjModelParams = resetObjModelParams;
window.createModal = createModal;
window.showIntersectionPointInfoModal = showIntersectionPointInfoModal;
window.updateLineModalDerivedValues = updateLineModalDerivedValues;
window.handleSupportTypeChange = handleSupportTypeChange;
window.updateObjectPropertyVisibility = updateObjectPropertyVisibility;
window.updateDoorResistancePreview = updateDoorResistancePreview;
window.updateAtmosphereDerivedValues = updateAtmosphereDerivedValues;
window.showLinePropertiesModal = showLinePropertiesModal;
window.closeLinePropertiesModal = closeLinePropertiesModal;
window.applyLineProperties = applyLineProperties;
window.showObjectPropertiesModal = showObjectPropertiesModal;
window.closeObjectPropertiesModal = closeObjectPropertiesModal;
window.applyObjectProperties = applyObjectProperties;
window.deleteCurrentObject = deleteCurrentObject;
window.showAddImageModal = showAddImageModal;
window.closeAddImageModal = closeAddImageModal;
window.addNewImage = addNewImage;
window.clearCanvas = clearCanvas;
window.initializeModals = initializeModals;
window.addChainAnalysisButtons = addChainAnalysisButtons;

})();
