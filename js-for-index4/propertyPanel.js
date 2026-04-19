// propertyPanel.js — Панель свойств и статус, извлечено из main5.js
(function() {

function updatePropertiesPanel() {
  const active = canvas.getActiveObject();
  const content = document.getElementById('properties-content');
  if (!active) {
    if (content) content.innerHTML = '<p style="text-align:center;padding:20px;">Выберите ветвь или объект</p>';
    return;
  }

  let html = `<div class="property-group"><h4>Основные</h4><div class="property-row"><div class="property-label">Тип:</div><div class="property-value">${escapeHtml(active.type)}</div></div>`;

  if (active.type === 'line') {
    normalizeLineProperties(active);
    const p = active.properties || {};
    html += `<div class="property-row"><div class="property-label">Название:</div><div class="property-value">${escapeHtml(p.name || '—')}</div></div>`;
    html += `<div class="property-row"><div class="property-label">L:</div><div class="property-value">${formatTo5(p.passageLength || 0)} м</div></div>`;
    html += `<div class="property-row"><div class="property-label">S:</div><div class="property-value">${formatTo5(p.crossSectionalArea || 0)} м²</div></div>`;
    html += `<div class="property-row"><div class="property-label">Тип сечения:</div><div class="property-value">${escapeHtml(p.sectionType || AIR_MODEL_CONFIG.DEFAULT_SECTION)}</div></div>`;
    html += `<div class="property-row"><div class="property-label">Тип крепи:</div><div class="property-value">${escapeHtml(p.supportType || AIR_MODEL_CONFIG.DEFAULT_SUPPORT)}</div></div>`;
    html += `<div class="property-row"><div class="property-label">k:</div><div class="property-value">${formatTo5(p.roughnessCoefficient || 0)} Н·с²/м⁴</div></div>`;
    html += `<div class="property-row"><div class="property-label">P:</div><div class="property-value">${formatTo5(p.perimeter || 0)} м</div></div>`;
    html += `<div class="property-row"><div class="property-label">x = L×P/S:</div><div class="property-value">${formatTo5(p.xFactor || 0)}</div></div>`;
    html += `<div class="property-row"><div class="property-label">Rбаз:</div><div class="property-value">${formatTo5(p.airResistance || 0)}</div></div>`;
    html += `<div class="property-row"><div class="property-label">Obj на ветви:</div><div class="property-value">${formatTo5(p.localObjectResistance || 0)}</div></div>`;
    html += `<div class="property-row"><div class="property-label">Δ маршрута:</div><div class="property-value">${formatTo5(p.deltaCoefficient || 0)}</div></div>`;
    html += `<div class="property-row"><div class="property-label">R(i-j):</div><div class="property-value">${formatTo5(p.totalResistance || 0)}</div></div>`;
    html += `<div class="property-row"><div class="property-label">Q:</div><div class="property-value">${formatTo5(p.airVolume || 0)} м³/с</div></div>`;
    html += `<div class="property-row"><div class="property-label">v:</div><div class="property-value">${formatTo5(p.velocity || 0)} м/с</div></div>`;
    html += `<div class="property-row"><div class="property-label">h:</div><div class="property-value">${formatTo5(p.depression || 0)} Па</div></div>`;
    html += `<div class="property-row"><div class="property-label">Узел начала:</div><div class="property-value">${escapeHtml(p.startNode || '—')}</div></div>`;
    html += `<div class="property-row"><div class="property-label">Узел конца:</div><div class="property-value">${escapeHtml(p.endNode || '—')}</div></div>`;
    if (p.attachedObjects) {
      html += `<div class="property-row"><div class="property-label">Объекты на ветви:</div><div class="property-value">${escapeHtml(p.attachedObjects)}</div></div>`;
    }
    if (p.branchTotalResistance !== undefined) {
      html += `<div class="property-row"><div class="property-label">R ветви:</div><div class="property-value">${formatTo5(p.branchTotalResistance || 0)}</div></div>`;
      html += `<div class="property-row"><div class="property-label">h ветви:</div><div class="property-value">${formatTo5(p.branchDepression || 0)} Па</div></div>`;
    }
  } else if (active.type === 'image') {
    const p = synchronizeObjectDerivedProperties(active.properties || {});
    html += `<div class="property-row"><div class="property-label">Название:</div><div class="property-value">${escapeHtml(p.name || 'Объект')}</div></div>`;
    html += `<div class="property-row"><div class="property-label">Тип объекта:</div><div class="property-value">${escapeHtml(p.type || 'default')}</div></div>`;
    if (p.type === 'fan') {
      html += `<div class="property-row"><div class="property-label">Режим:</div><div class="property-value">Подача</div></div>`;
      html += `<div class="property-row"><div class="property-label">Q0:</div><div class="property-value">${formatTo5(p.airVolume || 0)} м³/с</div></div>`;
      html += `<div class="property-row"><div class="property-label">Начало подачи:</div><div class="property-value">${p.isFlowSource !== false ? '✦ Да (источник)' : '— Нет'}</div></div>`;
    } else if (p.type === 'valve') {
      const modeText = p.doorMode === 'closed' ? 'Дверь закрыта' : p.doorMode === 'window' ? `Дверь с вентокном ${p.windowArea} м²` : 'Дверь открыта';
      html += `<div class="property-row"><div class="property-label">Режим:</div><div class="property-value">${escapeHtml(modeText)}</div></div>`;
      html += `<div class="property-row"><div class="property-label">Robj:</div><div class="property-value">${formatTo5(p.airResistance || 0)}</div></div>`;
    } else if (isAtmosphereObject(p)) {
      html += `<div class="property-row"><div class="property-label">H:</div><div class="property-value">${formatTo5(p.atmosphereHeight || 0)} м</div></div>`;
      html += `<div class="property-row"><div class="property-label">t1, ср:</div><div class="property-value">${formatTo5(p.atmosphereTemp1 || 0)} °C</div></div>`;
      html += `<div class="property-row"><div class="property-label">t2, ср:</div><div class="property-value">${formatTo5(p.atmosphereTemp2 || 0)} °C</div></div>`;
      html += `<div class="property-row"><div class="property-label">he:</div><div class="property-value">${formatTo5(p.naturalDraftMm || 0)} мм вод. ст.</div></div>`;
      html += `<div class="property-row"><div class="property-label">He:</div><div class="property-value">${formatTo5(p.naturalDraftPa || 0)} Па</div></div>`;
    } else if (p.type === 'fire') {
      html += `<div class="property-row"><div class="property-label">Влияние на R:</div><div class="property-value">Не изменяет автоматически</div></div>`;
    } else {
      html += `<div class="property-row"><div class="property-label">Robj:</div><div class="property-value">${formatTo5(p.airResistance || 0)}</div></div>`;
    }
  }

  if (lastCalculationResult) {
    html += `<div class="property-group"><h4>Итог сети</h4>`;
    html += `<div class="property-row"><div class="property-label">Hсети:</div><div class="property-value">${formatTo5(lastCalculationResult.networkDepressionPa || 0)} Па</div></div>`;
    html += `<div class="property-row"><div class="property-label">He:</div><div class="property-value">${formatTo5(lastCalculationResult.naturalDraftPa || 0)} Па</div></div>`;
    html += `<div class="property-row"><div class="property-label">Hвент,тр:</div><div class="property-value">${formatTo5(lastCalculationResult.requiredFanPressurePa || 0)} Па</div></div>`;
    html += `</div>`;
  }

  html += '</div>';
  if (content) content.innerHTML = html;
}

function updateStatus() {
  const objs = getCachedObjects();
  const count = objs.all.filter(o => o.id !== 'grid-group' && !o.isPreview).length;
  let status = `<strong>Объектов:</strong> ${count}`;
  const active = canvas.getActiveObject();
  if (active) {
    status += ` | <strong>Выбран:</strong> ${active.type}`;
    if (active.type === 'line' && active.properties) {
      const q = active.properties.airVolume || 0;
      status += ` | Q: ${formatTo5(q)}`;
    }
  }
  if (isCalculatingAirVolumes) status += ' | 🔄 Расчёт...';
  if (lineSplitMode === 'MANUAL') status += ' | 🎯 Ручной режим';
  if (altKeyPressed) status += ' | Alt: привязка';
  if (nodeLockEnabled) status += ' | 🔒 Узлы заблокированы';
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.innerHTML = status;
}

// Экспорт в глобальную область
window.updatePropertiesPanel = updatePropertiesPanel;
window.updateStatus = updateStatus;

})();
