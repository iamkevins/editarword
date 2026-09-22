
let currentFileName = 'documento';
let activeFloatingItem = null;
let floatingCounter = 0;

// Historial
const undoStack = [];
const redoStack = [];

// DOM
const viewport = document.getElementById('viewport');
const sheetWrapper = document.getElementById('sheet-wrapper');
const docContent = document.getElementById('doc-content');
const floatingLayer = document.getElementById('floating-layer');
const emptyState = document.getElementById('empty-state');
const gridOverlay = document.getElementById('grid-overlay');

const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnQuickDelete = document.getElementById('btn-quick-delete');
const btnEditFloating = document.getElementById('btn-edit-floating');
const statusBadge = document.getElementById('status-badge');
const layerBadge = document.getElementById('layer-badge');

// Herramientas flotantes
const precisionTools = document.getElementById('precision-tools');
const btnToggleGrid = document.getElementById('btn-toggle-grid');
const openToolsBtn = document.getElementById('open-tools-btn');
const closeToolsBtn = document.getElementById('close-tools-btn');
const sheetBackdrop = document.getElementById('sheet-backdrop');

// Modal editor
const inlineEditorCard = document.getElementById('inline-editor-card');
const inlineEditorInput = document.getElementById('inline-editor-input');
const editorTitle = document.getElementById('editor-title');
const closeInlineEditor = document.getElementById('close-inline-editor');
const btnApplyFloating = document.getElementById('btn-apply-floating');
const btnCenterFloating = document.getElementById('btn-center-floating');

// Opciones de tipografía
const fontFamilySelect = document.getElementById('font-family-select');
const btnToggleBold = document.getElementById('btn-toggle-bold');
const btnToggleItalic = document.getElementById('btn-toggle-italic');
const fontSizeInput = document.getElementById('font-size-input');
const btnSizeDec = document.getElementById('btn-size-dec');
const btnSizeInc = document.getElementById('btn-size-inc');
const fontColorPicker = document.getElementById('font-color-picker');

// Herramientas del menú
const docxInput = document.getElementById('docx-input');
const imgInput = document.getElementById('img-input');
const btnToggleDocEdit = document.getElementById('btn-toggle-doc-edit');
const btnAddFloatingText = document.getElementById('btn-add-floating-text');
const btnResetZoom = document.getElementById('btn-reset-zoom');
const btnExportPdf = document.getElementById('btn-export-pdf');
const btnExportDocx = document.getElementById('btn-export-docx');

let isBoldActive = false;
let isItalicActive = false;
let isEditingDocActive = false;

// =========================================================
// HISTORIAL (DESHACER / REHACER)
// =========================================================
function updateUndoRedoUI() {
  btnUndo.disabled = undoStack.length === 0;
  btnRedo.disabled = redoStack.length === 0;
}

function pushHistoryAction(action) {
  undoStack.push(action);
  redoStack.length = 0;
  updateUndoRedoUI();
}

function undo() {
  if (undoStack.length === 0) return;
  const action = undoStack.pop();

  if (action.type === 'DOC_TEXT_CHANGE') {
    docContent.innerHTML = action.prevHTML;
  } else if (action.type === 'FLOATING_ADD') {
    action.element.remove();
    clearSelection();
  } else if (action.type === 'FLOATING_REMOVE') {
    floatingLayer.appendChild(action.element);
    selectFloatingItem(action.element);
  }

  redoStack.push(action);
  updateUndoRedoUI();
  statusBadge.textContent = 'Acción deshecha';
}

function redo() {
  if (redoStack.length === 0) return;
  const action = redoStack.pop();

  if (action.type === 'DOC_TEXT_CHANGE') {
    docContent.innerHTML = action.newHTML;
  } else if (action.type === 'FLOATING_ADD') {
    floatingLayer.appendChild(action.element);
    selectFloatingItem(action.element);
  } else if (action.type === 'FLOATING_REMOVE') {
    action.element.remove();
    clearSelection();
  }

  undoStack.push(action);
  updateUndoRedoUI();
  statusBadge.textContent = 'Acción rehecha';
}

btnUndo.addEventListener('click', undo);
btnRedo.addEventListener('click', redo);

// =========================================================
// NAVEGACIÓN Y ZOOM MULTITÁCTIL CON 2 DEDOS
// =========================================================
let zoom = 1.0;
let panX = 0;
let panY = 0;

function updateTransform() {
  sheetWrapper.style.transform = `translate3d(${panX}px, ${panY}px, 0px) scale(${zoom})`;
}

function centerDocument(w = 794) {
  const vW = window.innerWidth;
  const vH = window.innerHeight;
  const scale = (vW * 0.92) / w;
  zoom = Math.min(scale, 1.0);
  panX = (vW - (w * zoom)) / 2;
  panY = Math.max(30, (vH - (1123 * zoom)) / 2);
  updateTransform();
}

let isTwoFinger = false;
let initialDist = 0;
let initialZoom = 1.0;
let initialMid = { x: 0, y: 0 };
let initialPan = { x: 0, y: 0 };

viewport.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    isTwoFinger = true;
    initialDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    initialZoom = zoom;
    initialMid = {
      x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
      y: (e.touches[0].clientY + e.touches[1].clientY) / 2
    };
    initialPan = { x: panX, y: panY };
  }
}, { passive: false });

viewport.addEventListener('touchmove', (e) => {
  if (isTwoFinger && e.touches.length === 2) {
    e.preventDefault();
    const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const mid = {
      x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
      y: (e.touches[0].clientY + e.touches[1].clientY) / 2
    };

    if (initialDist > 0) {
      const targetZoom = Math.min(Math.max(initialZoom * (dist / initialDist), 0.35), 4.5);
      const anchorX = (initialMid.x - initialPan.x) / initialZoom;
      const anchorY = (initialMid.y - initialPan.y) / initialZoom;

      panX = mid.x - (anchorX * targetZoom);
      panY = mid.y - (anchorY * targetZoom);
      zoom = targetZoom;
      updateTransform();
    }
  }
}, { passive: false });

viewport.addEventListener('touchend', (e) => {
  if (isTwoFinger && e.touches.length < 2) isTwoFinger = false;
});

// =========================================================
// CARGA Y PARSEO DE ARCHIVOS WORD (.docx)
// =========================================================
docxInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  currentFileName = file.name.replace(/\.[^/.]+$/, "");
  sheetBackdrop.classList.remove('active');
  statusBadge.textContent = 'Leyendo documento Word...';

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const arrayBuffer = event.target.result;
      const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
      
      docContent.innerHTML = result.value || '<p>Documento vacío.</p>';
      
      emptyState.style.display = 'none';
      sheetWrapper.style.display = 'block';

      centerDocument();
      document.querySelectorAll('.disabled-tool').forEach(b => b.classList.remove('disabled-tool'));
      statusBadge.textContent = 'Documento listo';
    } catch (err) {
      console.error(err);
      alert('Error al leer el archivo Word: ' + err.message);
      statusBadge.textContent = 'Error al abrir Word';
    }
  };
  reader.readAsArrayBuffer(file);
});

// =========================================================
// MODO EDICIÓN DIRECTA DEL TEXTO WORD
// =========================================================
let docHTMLBeforeEdit = '';

btnToggleDocEdit.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  isEditingDocActive = !isEditingDocActive;

  docContent.contentEditable = isEditingDocActive ? 'true' : 'false';
  docContent.classList.toggle('editing-active', isEditingDocActive);
  btnToggleDocEdit.classList.toggle('active-state', isEditingDocActive);

  if (isEditingDocActive) {
    docHTMLBeforeEdit = docContent.innerHTML;
    statusBadge.textContent = '✏️ Escribe directamente en el texto';
    docContent.focus();
  } else {
    if (docContent.innerHTML !== docHTMLBeforeEdit) {
      pushHistoryAction({
        type: 'DOC_TEXT_CHANGE',
        prevHTML: docHTMLBeforeEdit,
        newHTML: docContent.innerHTML
      });
    }
    statusBadge.textContent = 'Documento listo';
  }
});

// =========================================================
// SISTEMA DE ELEMENTOS FLOTANTES CON CRUCETA
// =========================================================
function selectFloatingItem(item) {
  if (activeFloatingItem) activeFloatingItem.classList.remove('selected');
  activeFloatingItem = item;
  activeFloatingItem.classList.add('selected');

  layerBadge.style.display = 'inline-block';
  layerBadge.textContent = `Capa #${item.dataset.layerId}`;
  btnQuickDelete.disabled = false;

  if (item.dataset.type === 'text') {
    btnEditFloating.disabled = false;
  } else {
    btnEditFloating.disabled = true;
  }

  precisionTools.classList.add('visible');
}

function clearSelection() {
  if (activeFloatingItem) activeFloatingItem.classList.remove('selected');
  activeFloatingItem = null;
  layerBadge.style.display = 'none';
  btnQuickDelete.disabled = true;
  btnEditFloating.disabled = true;
  precisionTools.classList.remove('visible');
}

// Deseleccionar al tocar el fondo
viewport.addEventListener('click', (e) => {
  if (!e.target.closest('.floating-item') && !e.target.closest('#precision-tools') && !e.target.closest('.top-nav')) {
    clearSelection();
  }
});

// Arrastre fluido de elementos flotantes con el dedo o ratón
function makeFloatingDraggable(el) {
  let isDragging = false;
  let startX, startY, origLeft, origTop;

  const onDown = (e) => {
    if (isTwoFinger) return;
    e.stopPropagation();
    selectFloatingItem(el);

    isDragging = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    startX = clientX;
    startY = clientY;
    origLeft = parseFloat(el.style.left) || 0;
    origTop = parseFloat(el.style.top) || 0;

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onMove = (e) => {
    if (!isDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const dx = (clientX - startX) / zoom;
    const dy = (clientY - startY) / zoom;

    let targetLeft = origLeft + dx;
    let targetTop = origTop + dy;

    // Ajuste magnético al centro de la hoja A4
    const sheetCenter = 794 / 2;
    const elCenter = targetLeft + (el.offsetWidth / 2);
    if (Math.abs(elCenter - sheetCenter) < 10) {
      targetLeft = sheetCenter - (el.offsetWidth / 2);
    }

    el.style.left = `${targetLeft}px`;
    el.style.top = `${targetTop}px`;
  };

  const onUp = () => {
    isDragging = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };

  el.addEventListener('pointerdown', onDown);
}

// Botón de eliminar capa seleccionada
btnQuickDelete.addEventListener('click', () => {
  if (!activeFloatingItem) return;
  const removed = activeFloatingItem;
  removed.remove();
  pushHistoryAction({ type: 'FLOATING_REMOVE', element: removed });
  clearSelection();
  statusBadge.textContent = 'Capa eliminada';
});

// =========================================================
// CRUCETA (D-PAD) MILIMÉTRICA PÍXEL A PÍXEL
// =========================================================
function nudgeItem(dx, dy) {
  if (!activeFloatingItem) return;
  const currentLeft = parseFloat(activeFloatingItem.style.left) || 0;
  const currentTop = parseFloat(activeFloatingItem.style.top) || 0;

  activeFloatingItem.style.left = `${currentLeft + dx}px`;
  activeFloatingItem.style.top = `${currentTop + dy}px`;
}

function bindDpad(btnId, dx, dy) {
  const btn = document.getElementById(btnId);
  let holdTimer, repeatTimer;

  const start = (e) => {
    e.preventDefault();
    nudgeItem(dx, dy);
    holdTimer = setTimeout(() => {
      repeatTimer = setInterval(() => nudgeItem(dx, dy), 50);
    }, 280);
  };

  const stop = () => {
    clearTimeout(holdTimer);
    clearInterval(repeatTimer);
  };

  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
}

bindDpad('dpad-up', 0, -1);
bindDpad('dpad-down', 0, 1);
bindDpad('dpad-left', -1, 0);
bindDpad('dpad-right', 1, 0);

// Alternar Grilla
btnToggleGrid.addEventListener('click', () => {
  const active = gridOverlay.classList.toggle('active');
  btnToggleGrid.classList.toggle('active', active);
});

// =========================================================
// AÑADIR Y EDITAR CUADRO DE TEXTO FLOTANTE
// =========================================================
btnToggleBold.addEventListener('click', () => {
  isBoldActive = !isBoldActive;
  btnToggleBold.classList.toggle('active', isBoldActive);
});

btnToggleItalic.addEventListener('click', () => {
  isItalicActive = !isItalicActive;
  btnToggleItalic.classList.toggle('active', isItalicActive);
});

btnSizeDec.addEventListener('click', () => fontSizeInput.value = Math.max(8, parseInt(fontSizeInput.value) - 1));
btnSizeInc.addEventListener('click', () => fontSizeInput.value = Math.min(72, parseInt(fontSizeInput.value) + 1));

btnAddFloatingText.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  activeFloatingItem = null; // Modo creación

  inlineEditorInput.value = '';
  editorTitle.textContent = `🔤 Nuevo Cuadro Flotante (Capa #${floatingCounter + 1})`;
  inlineEditorCard.classList.add('visible');
  inlineEditorInput.focus();
});

btnEditFloating.addEventListener('click', () => {
  if (!activeFloatingItem || activeFloatingItem.dataset.type !== 'text') return;

  inlineEditorInput.value = activeFloatingItem.innerText;
  editorTitle.textContent = `✏️ Modificar Capa #${activeFloatingItem.dataset.layerId}`;

  fontFamilySelect.value = activeFloatingItem.style.fontFamily || 'Arial';
  fontSizeInput.value = parseInt(activeFloatingItem.style.fontSize) || 16;
  fontColorPicker.value = activeFloatingItem.style.color || '#000000';

  isBoldActive = activeFloatingItem.style.fontWeight === 'bold';
  isItalicActive = activeFloatingItem.style.fontStyle === 'italic';
  btnToggleBold.classList.toggle('active', isBoldActive);
  btnToggleItalic.classList.toggle('active', isItalicActive);

  inlineEditorCard.classList.add('visible');
});

closeInlineEditor.addEventListener('click', () => inlineEditorCard.classList.remove('visible'));

btnApplyFloating.addEventListener('click', () => {
  const text = inlineEditorInput.value.trim();
  if (!text.length) return;

  if (activeFloatingItem && activeFloatingItem.dataset.type === 'text') {
    // Actualizar elemento existente
    activeFloatingItem.innerText = text;
    activeFloatingItem.style.fontFamily = fontFamilySelect.value;
    activeFloatingItem.style.fontSize = `${fontSizeInput.value}px`;
    activeFloatingItem.style.color = fontColorPicker.value;
    activeFloatingItem.style.fontWeight = isBoldActive ? 'bold' : 'normal';
    activeFloatingItem.style.fontStyle = isItalicActive ? 'italic' : 'normal';
  } else {
    // Crear nuevo elemento flotante
    const item = document.createElement('div');
    item.className = 'floating-item';
    item.dataset.type = 'text';
    item.dataset.layerId = ++floatingCounter;
    item.innerText = text;

    item.style.left = '250px';
    item.style.top = '150px';
    item.style.fontFamily = fontFamilySelect.value;
    item.style.fontSize = `${fontSizeInput.value}px`;
    item.style.color = fontColorPicker.value;
    item.style.fontWeight = isBoldActive ? 'bold' : 'normal';
    item.style.fontStyle = isItalicActive ? 'italic' : 'normal';

    makeFloatingDraggable(item);
    floatingLayer.appendChild(item);
    selectFloatingItem(item);
    pushHistoryAction({ type: 'FLOATING_ADD', element: item });
  }

  inlineEditorCard.classList.remove('visible');
  statusBadge.textContent = 'Cuadro aplicado. Muévelo con el dedo o la cruceta.';
});

btnCenterFloating.addEventListener('click', () => {
  if (!activeFloatingItem) return;
  activeFloatingItem.style.left = `${(794 - activeFloatingItem.offsetWidth) / 2}px`;
  statusBadge.textContent = 'Centrado';
});

// =========================================================
// INSERTAR FIRMA O FOTO
// =========================================================
imgInput.addEventListener('change', (e) => {
  sheetBackdrop.classList.remove('active');
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const item = document.createElement('div');
    item.className = 'floating-item';
    item.dataset.type = 'image';
    item.dataset.layerId = ++floatingCounter;

    item.style.left = '280px';
    item.style.top = '300px';
    item.style.width = '160px';

    const img = document.createElement('img');
    img.src = ev.target.result;
    item.appendChild(img);

    makeFloatingDraggable(item);
    floatingLayer.appendChild(item);
    selectFloatingItem(item);
    pushHistoryAction({ type: 'FLOATING_ADD', element: item });
  };
  reader.readAsDataURL(file);
});

// Botones de interfaz
openToolsBtn.addEventListener('click', () => sheetBackdrop.classList.add('active'));
closeToolsBtn.addEventListener('click', () => sheetBackdrop.classList.remove('active'));
sheetBackdrop.addEventListener('click', (e) => {
  if (e.target === sheetBackdrop) sheetBackdrop.classList.remove('active');
});

btnResetZoom.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  centerDocument();
});

// =========================================================
// CONVERTIR Y DESCARGAR EN PDF
// =========================================================
btnExportPdf.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  clearSelection();
  gridOverlay.classList.remove('active');

  statusBadge.textContent = 'Convirtiendo a PDF...';

  // Configuración de html2pdf para salida A4 idéntica
  const opt = {
    margin: [0, 0, 0, 0],
    filename: `${currentFileName}_editado.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'px', format: [794, sheetWrapper.offsetHeight], orientation: 'portrait' }
  };

  html2pdf().set(opt).from(sheetWrapper).save().then(() => {
    statusBadge.textContent = '¡PDF descargado con éxito!';
  }).catch((err) => {
    console.error(err);
    alert('Error al generar PDF: ' + err.message);
    statusBadge.textContent = 'Error al convertir';
  });
});

// =========================================================
// EXPORTAR DE VUELTA A WORD (.docx / HTML-DOCX)
// =========================================================
btnExportDocx.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  clearSelection();

  statusBadge.textContent = 'Exportando archivo Word...';

  const content = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${currentFileName}</title>
      <style>
        body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; }
      </style>
    </head>
    <body>
      ${docContent.innerHTML}
    </body>
    </html>
  `;

  const blob = new Blob([content], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentFileName}_editado.docx`;
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 2000);

  statusBadge.textContent = '¡Archivo Word descargado!';
});
