let currentFileName = 'documento';
let activeFloatingItem = null;
let floatingCounter = 0;
let docPages = [];
let currentPage = 0;

// Historial en vivo (Deshacer / Rehacer)
const undoStack = [];
const redoStack = [];
let isInternalUndoRedo = false;

// DOM
const viewport = document.getElementById('viewport');
const sheetWrapper = document.getElementById('sheet-wrapper');
const docContent = document.getElementById('doc-content');
const emptyState = document.getElementById('empty-state');
const gridOverlay = document.getElementById('grid-overlay');

const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const statusBadge = document.getElementById('status-badge');
const layerBadge = document.getElementById('layer-badge');

// Paginador simplificado (solo números directos)
const btnPageSelector = document.getElementById('btn-page-selector');
const btnPrevPage = document.getElementById('btn-prev-page');
const btnNextPage = document.getElementById('btn-next-page');
const pageIndicator = document.getElementById('page-indicator');
const pageModalBackdrop = document.getElementById('page-modal-backdrop');
const closePageModal = document.getElementById('close-page-modal');
const pageButtonsGrid = document.getElementById('page-buttons-grid');

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
// HISTORIAL INTELIGENTE (DESHACER / REHACER ACTIVO)
// =========================================================
function updateUndoRedoUI() {
  btnUndo.disabled = !isEditingDocActive && undoStack.length === 0;
  btnRedo.disabled = !isEditingDocActive && redoStack.length === 0;
}

function pushHistoryAction(action) {
  if (isInternalUndoRedo) return;
  undoStack.push(action);
  redoStack.length = 0;
  updateUndoRedoUI();
}

function executeUndo() {
  // 1. Si el usuario está editando el texto del documento, usar el historial nativo
  if (isEditingDocActive) {
    document.execCommand('undo', false, null);
    statusBadge.textContent = 'Texto deshecho';
    return;
  }

  // 2. Historial de elementos flotantes
  if (undoStack.length === 0) return;
  isInternalUndoRedo = true;
  const action = undoStack.pop();

  if (action.type === 'FLOATING_ADD') {
    action.element.remove();
    clearSelection();
  }

  redoStack.push(action);
  isInternalUndoRedo = false;
  updateUndoRedoUI();
  statusBadge.textContent = 'Acción deshecha';
}

function executeRedo() {
  if (isEditingDocActive) {
    document.execCommand('redo', false, null);
    statusBadge.textContent = 'Texto rehecho';
    return;
  }

  if (redoStack.length === 0) return;
  isInternalUndoRedo = true;
  const action = redoStack.pop();

  if (action.type === 'FLOATING_ADD') {
    docPages[action.pageIndex].appendChild(action.element);
    selectFloatingItem(action.element);
  }

  undoStack.push(action);
  isInternalUndoRedo = false;
  updateUndoRedoUI();
  statusBadge.textContent = 'Acción rehecha';
}

btnUndo.addEventListener('click', executeUndo);
btnRedo.addEventListener('click', executeRedo);

// Atajos universales Ctrl+Z y Ctrl+Y
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA') return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? executeRedo() : executeUndo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    executeRedo();
  }
});

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
  const scale = (vW * 0.94) / w;
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
// CARGA Y ELIMINACIÓN DE HOJAS FANTASMA
// =========================================================
docxInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  currentFileName = file.name.replace(/\.[^/.]+$/, "");
  sheetBackdrop.classList.remove('active');
  statusBadge.textContent = 'Interpretando formato exacto...';

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const arrayBuffer = event.target.result;
      docContent.innerHTML = '';

      const docxLib = window.docx || window.docxPreview;
      if (!docxLib) {
        throw new Error('La librería docx-preview no cargó correctamente.');
      }

      // Opciones para evitar saltos artificiales y hojas duplicadas
      const options = {
        className: 'docx',
        inWrapper: false,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: true, // Ignora cortes de página fantasmas de Word
        experimental: false,
        trimXmlDeclaration: true,
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true
      };

      await docxLib.renderAsync(arrayBuffer, docContent, null, options);

      // Detectar secciones generadas
      let sections = Array.from(docContent.querySelectorAll('section.docx'));

      // FILTRO: Eliminar páginas vacías al final causadas por saltos residuales
      for (let i = sections.length - 1; i > 0; i--) {
        const sec = sections[i];
        const hasMedia = sec.querySelector('img, table, canvas, svg');
        const text = (sec.innerText || '').trim();
        if (!hasMedia && text.length === 0) {
          sec.remove();
        }
      }

      sections = Array.from(docContent.querySelectorAll('section.docx'));
      docPages = sections.length > 0 ? sections : [docContent];

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
// SISTEMA NUMÉRICO DE NAVEGACIÓN (1 / 2)
// =========================================================
function setupPagination() {
  const total = docPages.length;

  if (total > 1) {
    btnPageSelector.style.display = 'flex';
    btnPrevPage.style.display = 'flex';
    btnNextPage.style.display = 'flex';
  } else {
    btnPageSelector.style.display = 'none';
    btnPrevPage.style.display = 'none';
    btnNextPage.style.display = 'none';
  }

  // Generar cuadrícula modal con números directos
  pageButtonsGrid.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const tile = document.createElement('button');
    tile.className = 'page-num-tile';
    tile.dataset.pageIndex = i;
    tile.textContent = `${i + 1}`;
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

  // Ocultar hojas inactivas y mostrar la actual
  docPages.forEach((sec, idx) => {
    if (idx === currentPage) {
      sec.style.display = 'block';
      sec.contentEditable = isEditingDocActive ? 'true' : 'false';
    } else {
      sec.style.display = 'none';
      sec.contentEditable = 'false';
    }
  });

  pageIndicator.textContent = `${currentPage + 1} / ${docPages.length}`;
  btnPrevPage.disabled = (currentPage === 0);
  btnNextPage.disabled = (currentPage === docPages.length - 1);

  document.querySelectorAll('.page-num-tile').forEach((tile, idx) => {
    tile.classList.toggle('active-page', idx === currentPage);
  });

  const activeSec = docPages[currentPage];
  centerDocument(activeSec.offsetWidth || 794, activeSec.offsetHeight || 1123);
  statusBadge.textContent = `${currentPage + 1} de ${docPages.length}`;
}

btnPrevPage.addEventListener('click', () => showPage(currentPage - 1));
btnNextPage.addEventListener('click', () => showPage(currentPage + 1));

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
btnToggleDocEdit.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  isEditingDocActive = !isEditingDocActive;

  const activeSec = docPages[currentPage];
  if (!activeSec) return;

  activeSec.contentEditable = isEditingDocActive ? 'true' : 'false';
  activeSec.classList.toggle('editing-active', isEditingDocActive);
  btnToggleDocEdit.classList.toggle('active-state', isEditingDocActive);

  // Al activar la edición, los botones de deshacer/rehacer se habilitan inmediatamente
  updateUndoRedoUI();

  if (isEditingDocActive) {
    statusBadge.textContent = `✏️ Editando (${currentPage + 1})`;
    activeSec.focus();
  } else {
    statusBadge.textContent = `Listo (${currentPage + 1})`;
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

  precisionTools.classList.add('visible');
}

function clearSelection() {
  if (activeFloatingItem) activeFloatingItem.classList.remove('selected');
  activeFloatingItem = null;
  layerBadge.style.display = 'none';
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

  // Doble toque / doble clic para re-editar el texto flotante
  el.addEventListener('dblclick', () => {
    if (el.dataset.type === 'text') {
      openEditorForFloating(el);
    }
  });
}

function openEditorForFloating(el) {
  inlineEditorInput.value = el.innerText;
  editorTitle.textContent = `✏️ Modificar Capa #${el.dataset.layerId}`;

  fontFamilySelect.value = el.style.fontFamily || 'Arial';
  fontSizeInput.value = parseInt(el.style.fontSize) || 16;
  fontColorPicker.value = el.style.color || '#000000';

  isBoldActive = el.style.fontWeight === 'bold';
  isItalicActive = el.style.fontStyle === 'italic';
  btnToggleBold.classList.toggle('active', isBoldActive);
  btnToggleItalic.classList.toggle('active', isItalicActive);

  inlineEditorCard.classList.add('visible');
}

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
  editorTitle.textContent = `🔤 Cuadro (Capa #${floatingCounter + 1})`;
  inlineEditorCard.classList.add('visible');
  inlineEditorInput.focus();
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

// Menú
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
// CONVERTIR A PDF
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

  statusBadge.textContent = 'Generando PDF...';

  // Mostrar todas las hojas en orden correlativo
  docPages.forEach(sec => {
    sec.style.display = 'block';
    sec.style.marginBottom = '0px';
    sec.style.boxShadow = 'none';
  });

  const opt = {
    margin: [0, 0, 0, 0],
    filename: `${currentFileName}_convertido.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'], before: 'section.docx:not(:first-child)' }
  };

  html2pdf().set(opt).from(docContent).save().then(() => {
    statusBadge.textContent = '¡PDF descargado con éxito!';
    showPage(currentPage);
  }).catch((err) => {
    console.error(err);
    alert('Error al convertir a PDF: ' + err.message);
    statusBadge.textContent = 'Error al convertir';
    showPage(currentPage);
  });
});
