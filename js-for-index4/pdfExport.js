// pdfExport.js – экспорт схемы и таблицы ветвей в PDF

(function(global) {
  'use strict';

  function getPdfRows() {
    return typeof global.getExportRows === 'function' ? global.getExportRows() : [];
  }

  function addRowsTable(pdf, rows, startY, pageWidth, pageHeight, margin) {
    const rowHeight = 6;
    const fontSize = 8;
    const colX = [margin, margin + 50, margin + 58, margin + 66, margin + 80, margin + 94, margin + 108, margin + 122, margin + 136, margin + 150, margin + 164, margin + 178];
    const headers = ['Название', '№нач', '№кон', 'L', 'S', 'R', 'Robj', 'Rполн', 'Q', 'v', 'h', 'Объекты'];

    pdf.setFontSize(fontSize);
    let y = startY;

    const drawHeader = () => {
      pdf.setFontSize(fontSize);
      headers.forEach((header, idx) => pdf.text(String(header), colX[idx], y));
      y += rowHeight;
    };

    drawHeader();

    rows.forEach(row => {
      if (y > pageHeight - margin) {
        pdf.addPage();
        y = margin;
        drawHeader();
      }
      const vals = [
        row.name,
        row.startNodeNumber || '',
        row.endNodeNumber || '',
        formatTo5(row.length),
        formatTo5(row.area),
        formatTo5(row.resistance),
        formatTo5(row.objectResistance),
        formatTo5(row.totalResistance),
        formatTo5(row.flow),
        formatTo5(row.velocity),
        formatTo5(row.depression),
        row.attachedObjects || ''
      ];
      vals.forEach((val, idx) => {
        const maxLen = idx === 0 ? 22 : (idx === 11 ? 20 : 8);
        const text = String(val).length > maxLen ? String(val).slice(0, maxLen - 1) + '…' : String(val);
        pdf.text(text, colX[idx], y);
      });
      y += rowHeight;
    });
  }

  function exportInternal(withDialogOptions) {
    if (!canvas) {
      showNotification('Холст не инициализирован', 'error');
      return;
    }
    if (typeof global.jspdf === 'undefined') {
      showNotification('Библиотека jsPDF не загружена', 'error');
      return;
    }

    try {
      const fileName = withDialogOptions ? (document.getElementById('pdfFileName')?.value || 'вентсеть') : `вентсеть_${new Date().toISOString().slice(0, 10)}`;
      const format = withDialogOptions ? (document.getElementById('pdfFormat')?.value || 'a4') : 'a4';
      const orientation = withDialogOptions ? (document.getElementById('pdfOrientation')?.value || 'landscape') : 'landscape';
      const quality = withDialogOptions ? (parseInt(document.getElementById('pdfQuality')?.value) || 2) : 2;
      const includeGrid = withDialogOptions ? (document.getElementById('includeGrid')?.checked !== false) : true;
      // Поддерживаем оба варианта ID чекбоксов (динамический модал и статический в HTML)
      const includeAirVolumes = withDialogOptions ? (
        (document.getElementById('includeAirVolumes') || document.getElementById('includeAirVolumeText'))?.checked !== false
      ) : true;
      const includeIntersections = withDialogOptions ? (document.getElementById('includeIntersections')?.checked !== false) : true;

      const gridGroup = canvas.getObjects().find(obj => obj.id === 'grid-group');
      const airVolumeTexts = canvas.getObjects().filter(obj => obj.id === 'air-volume-text');
      const intersectionPoints = canvas.getObjects().filter(obj => obj.id === 'intersection-point' || obj.id === 'intersection-point-label');

      if (!includeGrid && gridGroup) gridGroup.set('visible', false);
      if (!includeAirVolumes) airVolumeTexts.forEach(text => text.set('visible', false));
      if (!includeIntersections) intersectionPoints.forEach(point => point.set('visible', false));
      canvas.renderAll();

      const { jsPDF } = global.jspdf;
      const pdf = new jsPDF({ orientation, unit: 'mm', format });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;

      const canvasElement = canvas.getElement();
      // quality: 1=обычное(0.7), 2=высокое(0.85), 3=максимальное(1.0)
      const imgQuality = quality === 1 ? 0.7 : quality === 3 ? 1.0 : 0.85;
      const imgData = canvasElement.toDataURL('image/png', imgQuality);
      const imgWidth = pageWidth - 2 * margin;
      const imgHeight = (canvasElement.height * imgWidth) / canvasElement.width;
      const drawHeight = Math.min(imgHeight, pageHeight - 60);

      pdf.setFontSize(14);
      pdf.text('Схема вентиляционной сети', margin, margin);
      pdf.addImage(imgData, 'PNG', margin, margin + 6, imgWidth, drawHeight);

      const calc = typeof global.getLastCalculationResult === 'function' ? global.getLastCalculationResult() : null;
      pdf.setFontSize(9);
      let metaY = Math.min(pageHeight - 24, margin + 12 + drawHeight);
      if (calc) {
        pdf.text(`Подача: ${formatTo5(calc.totalSourceFlow || 0)} м³/с`, margin, metaY);
        metaY += 5;
        pdf.text(`Hсети: ${formatTo5(calc.networkDepressionPa || 0)} Па; He: ${formatTo5(calc.naturalDraftPa || 0)} Па; Hвент,тр: ${formatTo5(calc.requiredFanPressurePa || 0)} Па`, margin, metaY);
        metaY += 5;
      }
      pdf.text(`Сгенерировано: ${new Date().toLocaleString()}`, margin, metaY);

      const rows = getPdfRows();
      if (rows.length) {
        pdf.addPage();
        pdf.setFontSize(12);
        pdf.text('Таблица ветвей', margin, margin);
        addRowsTable(pdf, rows, margin + 8, pageWidth, pageHeight, margin);
      }

      pdf.save(`${fileName}.pdf`);

      if (!includeGrid && gridGroup) gridGroup.set('visible', true);
      if (!includeAirVolumes) airVolumeTexts.forEach(text => text.set('visible', true));
      if (!includeIntersections) intersectionPoints.forEach(point => point.set('visible', true));
      canvas.renderAll();

      if (withDialogOptions) closePDFExportModal();
      showNotification('PDF успешно создан!', 'success');
    } catch (error) {
      console.error('Ошибка при создании PDF:', error);
      showNotification('Ошибка при создании PDF: ' + error.message, 'error');
    }
  }

  global.exportToPDFWithOptions = function() {
    if (!canvas) {
      showNotification('Холст не инициализирован', 'error');
      return;
    }
    if (typeof global.jspdf === 'undefined') {
      showNotification('Библиотека jsPDF не загружена', 'error');
      return;
    }

    const modalHTML = `
      <div id="pdfExportModal" class="modal" style="display:flex;">
        <div class="modal-content" style="max-width: 400px;">
          <div class="modal-header">
            <h3>📄 Экспорт в PDF</h3>
            <button class="close-btn" onclick="closePDFExportModal()">×</button>
          </div>
          <div class="modal-body">
            <div class="property-group">
              <h4>Настройки экспорта</h4>
              <div class="property-row">
                <div class="property-label"><label for="pdfFileName">Имя файла:</label></div>
                <div class="property-value"><input type="text" id="pdfFileName" value="вентсеть_${new Date().toISOString().slice(0, 10)}" style="width:100%;"></div>
              </div>
              <div class="property-row">
                <div class="property-label"><label for="pdfFormat">Формат страницы:</label></div>
                <div class="property-value">
                  <select id="pdfFormat" style="width:100%;">
                    <option value="a4">A4</option>
                    <option value="a3">A3</option>
                    <option value="letter">Letter</option>
                  </select>
                </div>
              </div>
              <div class="property-row">
                <div class="property-label"><label for="pdfOrientation">Ориентация:</label></div>
                <div class="property-value">
                  <select id="pdfOrientation" style="width:100%;">
                    <option value="portrait">Книжная</option>
                    <option value="landscape" selected>Альбомная</option>
                  </select>
                </div>
              </div>
              <div class="property-row">
                <div class="property-label"><label for="pdfQuality">Качество:</label></div>
                <div class="property-value">
                  <select id="pdfQuality" style="width:100%;">
                    <option value="1">Обычное</option>
                    <option value="2" selected>Высокое</option>
                    <option value="3">Максимальное</option>
                  </select>
                </div>
              </div>
              <div class="property-row"><div class="property-label"><label for="includeGrid">Включать сетку:</label></div><div class="property-value"><input type="checkbox" id="includeGrid" checked></div></div>
              <div class="property-row"><div class="property-label"><label for="includeAirVolumes">Включать расход на ветвях:</label></div><div class="property-value"><input type="checkbox" id="includeAirVolumes" checked></div></div>
              <div class="property-row"><div class="property-label"><label for="includeIntersections">Включать точки пересечений:</label></div><div class="property-value"><input type="checkbox" id="includeIntersections" checked></div></div>
            </div>
          </div>
          <div class="modal-footer">
            <button onclick="exportToPDF()" class="btn btn-primary"><span>📥</span> Экспорт</button>
            <button onclick="closePDFExportModal()" class="btn btn-secondary">Отмена</button>
          </div>
        </div>
      </div>`;

    const existingModal = document.getElementById('pdfExportModal');
    if (existingModal) existingModal.remove();
    document.body.insertAdjacentHTML('beforeend', modalHTML);
  };

  global.closePDFExportModal = function() {
    const modal = document.getElementById('pdfExportModal');
    if (modal) modal.remove();
  };

  // Псевдоним с другим регистром для совместимости с вызовами из HTML (onclick="closePdfExportModal()")
  global.closePdfExportModal = global.closePDFExportModal;

  // startPdfExport вызывается из статического модала в HTML (onclick="startPdfExport()")
  global.startPdfExport = function() {
    exportInternal(true);
  };

  global.exportToPDF = function() {
    exportInternal(true);
  };

  global.quickExportToPDF = function() {
    exportInternal(false);
  };

})(window);
