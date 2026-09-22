let currentFileName = 'documento';
let activeFloatingItem = null;
let floatingCounter = 0;
let docPages = [];       // Contiene todas las páginas reales generadas por docx-preview
let currentPage = 0;      // Índice de la página actualmente visible

// Historial
const undoStack = [];
const redoStack = [];

// DOM
const viewport = document.getElementById('viewport');
const sheetWrapper = document.getElementById('sheet-wrapper');
const docContent = document.getElementById('doc-content');
const emptyState = document.getElementById('empty-state');
const gridOverlay = document.getElementById('grid-overlay');

const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnQuickDelete = document.getElementById('btn-quick-delete');
const btnEditFloating = document.getElementById('btn-edit-floating');
const statusBadge = document.getElementById('status-badge');
const layerBadge = document.getElementById('layer-badge');

// Controles del selector de páginas
const btnPageSelector = document.getElementById('btn-page-selector');
const btnPrevPage = document.getElementById('btn-prev-page');
const btnNextPage = document.getElementById('btn-next-page');
const pageIndicator = document.getElementById('page-indicator');
const pageModalBackdrop = document.getElementById('page-modal-backdrop');
const closePageModal = document.getElementById('close-page-modal');
const modalTotalPages = document.getElementById('modal-total-pages');
const pageButtonsGrid = document.getElementById('page-buttons-grid');

// Herramientas flotantes
const precisionTools = document.getElementById('precision-tools');
const btnToggleGrid = document.getElementById('btn-toggle-grid');
const openToolsBtn = document.getElementById('open-tools-btn');
const closeToolsBtn = document.getElementById('close-tools-btn');
const sheetBackdrop = document.getElementById('sheet-backdrop');

// Modal editor de textos flotantes
const inlineEditorCard = document.getElementById('inline-editor-card');
const inlineEditorInput = document.getElementById('inline-editor-input');
const editorTitle = document.getElementById('editor-title');
const closeInlineEditor = document.getElementById('close-inline-editor');
const btnApplyFloating = document.getElementById('btn-apply-floating');
const btnCenterFloating = document.getElementById('btn-center-floating');

// Tipografías
const fontFamilySelect = document.getElementById('font-family-select');
const btnToggleBold = document.getElementById('btn-toggle-bold');
const btnToggleItalic = document.getElementById('btn-toggle-italic');
const fontSizeInput = document.getElementById('font-size-input');
const btnSizeDec = document.getElementById('btn-size-dec');
const btnSizeInc = document.getElementById('btn-size-inc');
const fontColorPicker = document.getElementById('font-color-picker');

// Menú
const docxInput = document.getElementById('docx-input');
const imgInput = document.getElementById('img-input');
const btnToggleDocEdit = document.getElementById('btn-toggle-doc-edit');
const btnAddFloatingText = document.getElementById('btn-add-floating-text');
const btnResetZoom = document.getElementById('btn-reset-zoom');
const btnExportPdf = document.getElementById('btn-export-pdf');

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

  if (action.type === 'DOC_PAGE_EDIT') {
    action.pageElement.innerHTML = action.prevHTML;
  } else if (action.type === 'FLOATING_ADD') {
    action.element.remove();
    clearSelection();
  } else if (action.type === 'FLOATING_REMOVE') {
    docPages[action.pageIndex].appendChild(action.element);
    selectFloatingItem(action.element);
  }

  redoStack.push(action);
  updateUndoRedoUI();
  statusBadge.textContent = 'Acción deshecha';
}

function redo() {
  if (redoStack.length === 0) return;
  const action = redoStack.pop();

  if (action.type === 'DOC_PAGE_EDIT') {
    action.pageElement.innerHTML = action.newHTML;
  } else if (action.type === 'FLOATING_ADD') {
    docPages[action.pageIndex].appendChild(action.element);
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

function centerDocument(w = 794, h = 1123) {
  const vW = window.innerWidth;
  const vH = window.innerHeight;
  const scale = (vW * 0.92) / w;
  zoom = Math.min(scale, 1.0);
  panX = (vW - (w * zoom)) / 2;
  panY = Math.max(25, (vH - (h * zoom)) / 2);
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
// CARGA CON ALTA FIDELIDAD (DOCX-PREVIEW + JSZIP)
// =========================================================
docxInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  currentFileName = file.name.replace(/\.[^/.]+$/, "");
  sheetBackdrop.classList.remove('active');
  statusBadge.textContent = 'Procesando formato exacto...';

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const arrayBuffer = event.target.result;
      docContent.innerHTML = '';

      // Opciones para mantener saltos de página y estilos nativos de Word
      const options = {
        className: 'docx',
        inWrapper: false,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: false, // Respeta los saltos de página de Microsoft Word
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true
      };

      await docx.renderAsync(arrayBuffer, docContent, null, options);

      // Detectar las páginas generadas (cada section.docx es una hoja)
      const sections = docContent.querySelectorAll('section.docx');
      if (sections.length > 0) {
        docPages = Array.from(sections);
      } else {
        // En caso de que no tenga saltos de página explícitos
        docPages = [docContent];
      }

      emptyState.style.display = 'none';
      sheetWrapper.style.display = 'block';

      setupPagination();
      showPage(0);

      document.querySelectorAll('.disabled-tool').forEach(b => b.classList.remove('disabled-tool'));
      statusBadge.textContent = 'Documento listo';
    } catch (err) {
      console.error(err);
      alert('Error al abrir el archivo Word: ' + err.message);
      statusBadge.textContent = 'Error al abrir';
    }
  };
  reader.readAsArrayBuffer(file);
});

// =========================================================
// SISTEMA DE NAVEGACIÓN Y SELECTOR DE PÁGINAS
// =========================================================
function setupPagination() {
  const total = docPages.length;

  if (total > 1) {
    // Mostrar botones de paginación solo si hay más de 1 hoja
    btnPageSelector.style.display = 'flex';
    btnPrevPage.style.display = 'flex';
    btnNextPage.style.display = 'flex';
  } else {
    btnPageSelector.style.display = 'none';
    btnPrevPage.style.display = 'none';
    btnNextPage.style.display = 'none';
  }

  // Generar cuadrícula en el modal selector
  modalTotalPages.textContent = total;
  pageButtonsGrid.innerHTML = '';

  for (let i = 0; i < total; i++) {
    const tile = document.createElement('button');
    tile.className = 'page-tile';
    tile.dataset.pageIndex = i;
    tile.innerHTML = `<span>📄</span><span>Hoja ${i + 1}</span>`;
    tile.addEventListener('click', () => {
      showPage(i);
      closeModal();
    });
    pageButtonsGrid.appendChild(tile);
  }
}

function showPage(pageIndex) {
  if (pageIndex < 0 || pageIndex >= docPages.length) return;
  currentPage = pageIndex;

  clearSelection();

  // Ocultar todas las páginas y mostrar únicamente la seleccionada
  docPages.forEach((sec, idx) => {
    if (idx === currentPage) {
      sec.style.display = 'block';
      sec.contentEditable = isEditingDocActive ? 'true' : 'false';
    } else {
      sec.style.display = 'none';
      sec.contentEditable = 'false';
    }
  });

  // Actualizar indicadores
  pageIndicator.textContent = `Pág. ${currentPage + 1} / ${docPages.length}`;
  btnPrevPage.disabled = (currentPage === 0);
  btnNextPage.disabled = (currentPage === docPages.length - 1);

  // Marcar como activa en el modal
  document.querySelectorAll('.page-tile').forEach((tile, idx) => {
    tile.classList.toggle('active-page', idx === currentPage);
  });

  // Centrar la hoja activa
  const activeSec = docPages[currentPage];
  centerDocument(activeSec.offsetWidth || 794, activeSec.offsetHeight || 1123);
  statusBadge.textContent = `Hoja ${currentPage + 1} activa`;
}

// Flechas anterior y siguiente
btnPrevPage.addEventListener('click', () => showPage(currentPage - 1));
btnNextPage.addEventListener('click', () => showPage(currentPage + 1));

// Abrir y cerrar modal selector de páginas
btnPageSelector.addEventListener('click', () => {
  pageModalBackdrop.classList.add('active');
});

function closeModal() {
  pageModalBackdrop.classList.remove('active');
}
closePageModal.addEventListener('click', closeModal);
pageModalBackdrop.addEventListener('click', (e) => {
  if (e.target === pageModalBackdrop) closeModal();
});

// =========================================================
// MODO EDICIÓN DIRECTA EN LA HOJA
// =========================================================
let pageHTMLBeforeEdit = '';

btnToggleDocEdit.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  isEditingDocActive = !isEditingDocActive;

  const activeSec = docPages[currentPage];
  if (!activeSec) return;

  activeSec.contentEditable = isEditingDocActive ? 'true' : 'false';
  activeSec.classList.toggle('editing-active', isEditingDocActive);
  btnToggleDocEdit.classList.toggle('active-state', isEditingDocActive);

  if (isEditingDocActive) {
    pageHTMLBeforeEdit = activeSec.innerHTML;
    statusBadge.textContent = `✏️ Editando Hoja ${currentPage + 1}`;
    activeSec.focus();
  } else {
    if (activeSec.innerHTML !== pageHTMLBeforeEdit) {
      pushHistoryAction({
        type: 'DOC_PAGE_EDIT',
        pageElement: activeSec,
        pageIndex: currentPage,
        prevHTML: pageHTMLBeforeEdit,
        newHTML: activeSec.innerHTML
      });
    }
    statusBadge.textContent = `Hoja ${currentPage + 1} lista`;
  }
});

// =========================================================
// CUADROS Y ELEMENTOS FLOTANTES CON CRUCETA
// =========================================================
function selectFloatingItem(item) {
  if (activeFloatingItem) activeFloatingItem.classList.remove('selected');
  activeFloatingItem = item;
  activeFloatingItem.classList.add('selected');

  layerBadge.style.display = 'inline-block';
  layerBadge.textContent = `Capa #${item.dataset.layerId}`;
  btnQuickDelete.disabled = false;

  btnEditFloating.disabled = (item.dataset.type !== 'text');
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

viewport.addEventListener('click', (e) => {
  if (!e.target.closest('.floating-item') && !e.target.closest('#precision-tools') && !e.target.closest('.top-nav')) {
    clearSelection();
  }
});

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

    // Ajuste magnético al centro de la hoja activa
    const parentWidth = el.parentElement.offsetWidth || 794;
    const sheetCenter = parentWidth / 2;
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

btnQuickDelete.addEventListener('click', () => {
  if (!activeFloatingItem) return;
  const removed = activeFloatingItem;
  const pageIdx = parseInt(removed.dataset.pageIndex, 10);
  removed.remove();
  pushHistoryAction({ type: 'FLOATING_REMOVE', element: removed, pageIndex: pageIdx });
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
  activeFloatingItem = null;

  inlineEditorInput.value = '';
  editorTitle.textContent = `🔤 Nuevo Cuadro (Capa #${floatingCounter + 1})`;
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
    activeFloatingItem.innerText = text;
    activeFloatingItem.style.fontFamily = fontFamilySelect.value;
    activeFloatingItem.style.fontSize = `${fontSizeInput.value}px`;
    activeFloatingItem.style.color = fontColorPicker.value;
    activeFloatingItem.style.fontWeight = isBoldActive ? 'bold' : 'normal';
    activeFloatingItem.style.fontStyle = isItalicActive ? 'italic' : 'normal';
  } else {
    // Insertar en la página actual activa
    const item = document.createElement('div');
    item.className = 'floating-item';
    item.dataset.type = 'text';
    item.dataset.layerId = ++floatingCounter;
    item.dataset.pageIndex = currentPage;
    item.innerText = text;

    item.style.left = '200px';
    item.style.top = '150px';
    item.style.fontFamily = fontFamilySelect.value;
    item.style.fontSize = `${fontSizeInput.value}px`;
    item.style.color = fontColorPicker.value;
    item.style.fontWeight = isBoldActive ? 'bold' : 'normal';
    item.style.fontStyle = isItalicActive ? 'italic' : 'normal';

    makeFloatingDraggable(item);
    docPages[currentPage].appendChild(item);
    selectFloatingItem(item);
    pushHistoryAction({ type: 'FLOATING_ADD', element: item, pageIndex: currentPage });
  }

  inlineEditorCard.classList.remove('visible');
  statusBadge.textContent = 'Cuadro añadido';
});

btnCenterFloating.addEventListener('click', () => {
  if (!activeFloatingItem) return;
  const parentWidth = activeFloatingItem.parentElement.offsetWidth || 794;
  activeFloatingItem.style.left = `${(parentWidth - activeFloatingItem.offsetWidth) / 2}px`;
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
    item.dataset.pageIndex = currentPage;

    item.style.left = '220px';
    item.style.top = '250px';
    item.style.width = '160px';

    const img = document.createElement('img');
    img.src = ev.target.result;
    item.appendChild(img);

    makeFloatingDraggable(item);
    docPages[currentPage].appendChild(item);
    selectFloatingItem(item);
    pushHistoryAction({ type: 'FLOATING_ADD', element: item, pageIndex: currentPage });
  };
  reader.readAsDataURL(file);
});

// Herramientas generales
openToolsBtn.addEventListener('click', () => sheetBackdrop.classList.add('active'));
closeToolsBtn.addEventListener('click', () => sheetBackdrop.classList.remove('active'));
sheetBackdrop.addEventListener('click', (e) => {
  if (e.target === sheetBackdrop) sheetBackdrop.classList.remove('active');
});

btnResetZoom.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  const activeSec = docPages[currentPage];
  centerDocument(activeSec ? activeSec.offsetWidth : 794, activeSec ? activeSec.offsetHeight : 1123);
});

// =========================================================
// CONVERTIR TODAS LAS PÁGINAS A PDF
// =========================================================
btnExportPdf.addEventListener('click', () => {
  if (!docPages || docPages.length === 0) {
    alert('Primero debes abrir un archivo Word (.docx).');
    return;
  }

  sheetBackdrop.classList.remove('active');
  clearSelection();
  gridOverlay.classList.remove('active');
  btnToggleGrid.classList.remove('active');

  statusBadge.textContent = 'Convirtiendo todas las páginas a PDF...';

  // 1. Mostrar todas las páginas para que html2pdf procese el documento completo
  docPages.forEach(sec => {
    sec.style.display = 'block';
    sec.style.marginBottom = '0px';
    sec.style.boxShadow = 'none';
  });

  // Configuración de html2pdf con separación de páginas idéntica a Word
  const opt = {
    margin: [0, 0, 0, 0],
    filename: `${currentFileName}_editado.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'], before: 'section.docx:not(:first-child)' }
  };

  html2pdf().set(opt).from(docContent).save().then(() => {
    statusBadge.textContent = '¡PDF descargado con éxito!';
    // Restaurar vista exclusiva de la página actual
    showPage(currentPage);
  }).catch((err) => {
    console.error(err);
    alert('Error al convertir a PDF: ' + err.message);
    statusBadge.textContent = 'Error al convertir';
    showPage(currentPage);
  });
});
