// csvExport.js – экспорт данных в CSV

(function(global) {
  'use strict';

  function buildCsvContent() {
    const rows = typeof global.getExportRows === 'function' ? global.getExportRows() : [];
    const calc = typeof global.getLastCalculationResult === 'function' ? global.getLastCalculationResult() : null;
    let csvContent = '\uFEFF';

    csvContent += 'ТАБЛИЦА ВЕТВЕЙ\n';
    if (calc) {
      csvContent += `Подача,${formatTo5(calc.totalSourceFlow || 0)} м³/с\n`;
      csvContent += `Hсети,${formatTo5(calc.networkDepressionPa || 0)} Па\n`;
      csvContent += `He,${formatTo5(calc.naturalDraftPa || 0)} Па\n`;
      csvContent += `Hвент,тр,${formatTo5(calc.requiredFanPressurePa || 0)} Па\n`;
    }
    csvContent += '\n';
    csvContent += 'Название,№ начала,№ конца,Длина L (м),Площадь S (м²),Тип сечения,Тип крепи,α,Периметр P (м),Собственное сопротивление R,Локальное сопротивление Robj,Полное сопротивление Rполн,Расход Q (м³/с),Скорость v (м/с),Депрессия h (Па),Объекты\n';

    rows.forEach(row => {
      const line = [
        `"${row.name}"`,
        `"${row.startNodeNumber || ''}"`,
        `"${row.endNodeNumber || ''}"`,
        formatTo5(row.length),
        formatTo5(row.area),
        `"${row.sectionType}"`,
        `"${row.supportType}"`,
        formatTo5(row.alpha),
        formatTo5(row.perimeter),
        formatTo5(row.resistance),
        formatTo5(row.objectResistance),
        formatTo5(row.totalResistance),
        formatTo5(row.flow),
        formatTo5(row.velocity),
        formatTo5(row.depression),
        `"${row.attachedObjects || ''}"`
      ].join(',');
      csvContent += line + '\n';
    });

    return csvContent;
  }

  function downloadCsv(fileName, content) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  global.exportLinePropertiesToCSV = function() {
    const rows = typeof global.getExportRows === 'function' ? global.getExportRows() : [];
    if (!rows.length) {
      showNotification('Нет ветвей для экспорта!', 'error');
      return;
    }
    downloadCsv(`ветви_${new Date().toISOString().slice(0, 10)}.csv`, buildCsvContent());
    showNotification(`Экспортировано ${rows.length} ветвей в CSV`, 'success');
  };

  global.exportAirVolumeReportToCSV = function() {
    const rows = typeof global.getExportRows === 'function' ? global.getExportRows() : [];
    if (!rows.length) {
      showNotification('Нет данных для экспорта!', 'error');
      return;
    }
    downloadCsv(`отчет_вентсеть_${new Date().toISOString().slice(0, 10)}.csv`, buildCsvContent());
    showNotification('Отчёт экспортирован в CSV', 'success');
  };

})(window);
