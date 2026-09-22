pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfDocInstance = null;
let originalPdfBytes = null;
let fabricCanvas = null;
let currentPageNumber = 1;
let totalPages = 1;
const RENDER_SCALE = 1.5;

// Almacén de modificaciones por página { pageNum: { patches: [], fabricObjectsJson: ... } }
const pagesData = {};

// Historial (Deshacer / Rehacer)
const undoStack = [];
const redoStack = [];

// DOM
const viewport = document.getElementById('viewport');
const sheetWrapper = document.getElementById('sheet-wrapper');
const pdfCanvas = document.getElementById('pdf-canvas');
const textDetectLayer = document.getElementById('text-detect-layer');
const emptyState = document.getElementById('empty-state');
const gridOverlay = document.getElementById('grid-overlay');

const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnEditSelected = document.getElementById('btn-edit-selected');
const statusBadge = document.getElementById('status-badge');
const layerBadge = document.getElementById('layer-badge');

// Paginador
const btnPageSelector = document.getElementById('btn-page-selector');
const btnPrevPage = document.getElementById('btn-prev-page');
const btnNextPage = document.getElementById('btn-next-page');
const pageIndicator = document.getElementById('page-indicator');
const pageModalBackdrop = document.getElementById('page-modal-backdrop');
const closePageModal = document.getElementById('close-page-modal');
const pageButtonsGrid = document.getElementById('page-buttons-grid');

// Herramientas
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
const btnApplyText = document.getElementById('btn-apply-text');
const btnCenterText = document.getElementById('btn-center-text');

// Tipografías
const fontFamilySelect = document.getElementById('font-family-select');
const btnToggleBold = document.getElementById('btn-toggle-bold');
const btnToggleItalic = document.getElementById('btn-toggle-italic');
const fontSizeInput = document.getElementById('font-size-input');
const btnSizeDec = document.getElementById('btn-size-dec');
const btnSizeInc = document.getElementById('btn-size-inc');
const fontColorPicker = document.getElementById('font-color-picker');

// Herramientas menú
const docInput = document.getElementById('doc-input');
const imgInput = document.getElementById('img-input');
const btnModeEditText = document.getElementById('btn-mode-edit-text');
const btnAddText = document.getElementById('btn-add-text');
const btnWhiteout = document.getElementById('btn-whiteout');
const btnDraw = document.getElementById('btn-draw');
const btnResetZoom = document.getElementById('btn-reset-zoom');
const btnSave = document.getElementById('btn-save');

let isEditModeActive = false;
let currentTargetObject = null;
let isBoldActive = false;
let isItalicActive = false;
let layerSequence = 0;

// =========================================================
// CARGADOR SEGURO DE PDF-LIB
// =========================================================
async function getSafePDFLib() {
  if (window.PDFLib) return window.PDFLib;
  if (window.pdfLib) return window.pdfLib;

  const fallbackUrls = [
    'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.9/dist/pdf-lib.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
  ];

  for (const url of fallbackUrls) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      if (window.PDFLib || window.pdfLib) return window.PDFLib || window.pdfLib;
    } catch (e) {
      console.warn('Fallo cargando CDN:', url);
    }
  }
  throw new Error('No se pudo cargar la librería PDF-Lib.');
}

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

  if (action.type === 'FABRIC_ADD') {
    fabricCanvas.remove(action.object);
    fabricCanvas.renderAll();
  } else if (action.type === 'TEXT_EDIT') {
    const ctx = pdfCanvas.getContext('2d');
    ctx.putImageData(action.eraseData.imageData, action.eraseData.box.x, action.eraseData.box.y);
    fabricCanvas.remove(action.textRender);
    fabricCanvas.renderAll();

    // Eliminar parche
    const pagePatches = pagesData[currentPageNumber].patches;
    pagesData[currentPageNumber].patches = pagePatches.filter(p => p !== action.patchRef);
  }

  redoStack.push(action);
  updateUndoRedoUI();
  statusBadge.textContent = 'Acción deshecha';
}

function redo() {
  if (redoStack.length === 0) return;
  const action = redoStack.pop();

  if (action.type === 'FABRIC_ADD') {
    fabricCanvas.add(action.object);
    fabricCanvas.renderAll();
  } else if (action.type === 'TEXT_EDIT') {
    const ctx = pdfCanvas.getContext('2d');
    ctx.fillStyle = action.eraseData.bgColor;
    ctx.fillRect(action.eraseData.box.x, action.eraseData.box.y, action.eraseData.box.w, action.eraseData.box.h);
    fabricCanvas.add(action.textRender);
    fabricCanvas.renderAll();

    pagesData[currentPageNumber].patches.push(action.patchRef);
  }

  undoStack.push(action);
  updateUndoRedoUI();
  statusBadge.textContent = 'Acción rehecha';
}

btnUndo.addEventListener('click', undo);
btnRedo.addEventListener('click', redo);

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
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

function centerDocument(w, h) {
  const vW = window.innerWidth;
  const vH = window.innerHeight;
  const scale = (vW * 0.94) / w;
  zoom = Math.min(scale, 1.0);
  panX = (vW - (w * zoom)) / 2;
  panY = Math.max(20, (vH - (h * zoom)) / 2);
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
// CONVERSIÓN EN BACKEND DE WORD (.DOCX) A PDF
// =========================================================
async function convertDocxToPdfBackend(file) {
  statusBadge.textContent = 'Convirtiendo Word con fidelidad 100%...';

  const formData = new FormData();
  formData.append('file', file);

  // Llamada al endpoint backend (serverless en Vercel)
  const res = await fetch('/api/convert', {
    method: 'POST',
    body: formData
  });

  if (!res.ok) {
    throw new Error('El servicio de conversión no pudo procesar el archivo Word.');
  }

  return await res.arrayBuffer();
}

// =========================================================
// CARGA UNIFICADA (WORD O PDF)
// =========================================================
docInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  sheetBackdrop.classList.remove('active');
  const isDocx = file.name.endsWith('.docx') || file.type.includes('wordprocessingml');

  try {
    let pdfBuffer;
    if (isDocx) {
      pdfBuffer = await convertDocxToPdfBackend(file);
    } else {
      pdfBuffer = await file.arrayBuffer();
    }

    originalPdfBytes = pdfBuffer.slice(0);
    pdfDocInstance = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
    totalPages = pdfDocInstance.numPages;

    // Inicializar almacén por página
    for (let i = 1; i <= totalPages; i++) {
      pagesData[i] = { patches: [], fabricObjectsJson: null };
    }

    setupPaginationUI();
    await loadPage(1);

    emptyState.style.display = 'none';
    sheetWrapper.style.display = 'block';
    document.querySelectorAll('.disabled-tool').forEach(b => b.classList.remove('disabled-tool'));
    statusBadge.textContent = `Documento cargado (${totalPages} pág.)`;
  } catch (err) {
    console.error(err);
    alert('Error al abrir el documento: ' + err.message);
    statusBadge.textContent = 'Error al cargar';
  }
});

// =========================================================
// RENDERIZADO DE PÁGINAS Y FABRIC
// =========================================================
async function loadPage(pageNum) {
  // Guardar estado de la página previa antes de cambiar
  if (fabricCanvas && pagesData[currentPageNumber]) {
    pagesData[currentPageNumber].fabricObjectsJson = fabricCanvas.toJSON();
  }

  currentPageNumber = pageNum;
  clearSelectionUI();

  const page = await pdfDocInstance.getPage(pageNum);
  const viewportObj = page.getViewport({ scale: RENDER_SCALE });

  pdfCanvas.width = viewportObj.width;
  pdfCanvas.height = viewportObj.height;
  sheetWrapper.style.width = `${viewportObj.width}px`;
  sheetWrapper.style.height = `${viewportObj.height}px`;

  await page.render({
    canvasContext: pdfCanvas.getContext('2d'),
    viewport: viewportObj
  }).promise;

  // Recrear canvas de Fabric
  if (fabricCanvas) fabricCanvas.dispose();
  fabricCanvas = new fabric.Canvas('fabric-canvas', {
    isDrawingMode: false,
    preserveObjectStacking: true,
    selection: false,
    targetFindTolerance: 18
  });

  fabricCanvas.setWidth(viewportObj.width);
  fabricCanvas.setHeight(viewportObj.height);
  fabricCanvas.freeDrawingBrush.width = 3 * RENDER_SCALE;

  fabric.Object.prototype.set({
    transparentCorners: false,
    cornerColor: '#2563eb',
    cornerStrokeColor: '#ffffff',
    borderColor: '#2563eb',
    cornerSize: 12,
    touchCornerSize: 36,
    padding: 6,
    hasRotatingPoint: false
  });

  initSmartGuidelines(fabricCanvas);

  fabricCanvas.on('selection:created', onSelectionChanged);
  fabricCanvas.on('selection:updated', onSelectionChanged);
  fabricCanvas.on('selection:cleared', clearSelectionUI);

  fabricCanvas.on('mouse:dblclick', (opt) => {
    if (opt.target && opt.target.type === 'text') openEditorForTarget(opt.target);
  });

  fabricCanvas.on('path:created', (opt) => {
    opt.path.layerNum = ++layerSequence;
    pushHistoryAction({ type: 'FABRIC_ADD', object: opt.path });
  });

  // Restaurar objetos previos si existen en esta página
  if (pagesData[pageNum].fabricObjectsJson) {
    await new Promise(resolve => fabricCanvas.loadFromJSON(pagesData[pageNum].fabricObjectsJson, resolve));
  }

  await buildSmartTextLayer(page, viewportObj);

  // Actualizar indicadores
  pageIndicator.textContent = `${currentPageNumber} / ${totalPages}`;
  btnPrevPage.disabled = (currentPageNumber === 1);
  btnNextPage.disabled = (currentPageNumber === totalPages);

  document.querySelectorAll('.page-num-tile').forEach((tile, idx) => {
    tile.classList.toggle('active-page', idx + 1 === currentPageNumber);
  });

  centerDocument(viewportObj.width, viewportObj.height);
  statusBadge.textContent = `${currentPageNumber} de ${totalPages}`;
}

// =========================================================
// SISTEMA NUMÉRICO DE NAVEGACIÓN
// =========================================================
function setupPaginationUI() {
  if (totalPages > 1) {
    btnPageSelector.style.display = 'flex';
    btnPrevPage.style.display = 'flex';
    btnNextPage.style.display = 'flex';
  } else {
    btnPageSelector.style.display = 'none';
    btnPrevPage.style.display = 'none';
    btnNextPage.style.display = 'none';
  }

  pageButtonsGrid.innerHTML = '';
  for (let i = 1; i <= totalPages; i++) {
    const tile = document.createElement('button');
    tile.className = 'page-num-tile';
    tile.textContent = `${i}`;
    tile.addEventListener('click', () => {
      loadPage(i);
      closePageModalFn();
    });
    pageButtonsGrid.appendChild(tile);
  }
}

btnPrevPage.addEventListener('click', () => {
  if (currentPageNumber > 1) loadPage(currentPageNumber - 1);
});

btnNextPage.addEventListener('click', () => {
  if (currentPageNumber < totalPages) loadPage(currentPageNumber + 1);
});

btnPageSelector.addEventListener('click', () => pageModalBackdrop.classList.add('active'));
function closePageModalFn() { pageModalBackdrop.classList.remove('active'); }
closePageModal.addEventListener('click', closePageModalFn);
pageModalBackdrop.addEventListener('click', (e) => {
  if (e.target === pageModalBackdrop) closePageModalFn();
});

// =========================================================
// DETECCIÓN INTELIGENTE DE TEXTO ORIGINAL
// =========================================================
async function buildSmartTextLayer(page, viewportObj) {
  textDetectLayer.innerHTML = '';
  const textContent = await page.getTextContent();
  const rawItems = textContent.items;

  const items = rawItems.map(item => {
    if (!item.str || item.str.trim() === '') return null;
    const [vx, vy] = viewportObj.convertToViewportPoint(item.transform[4], item.transform[5]);
    const fHeight = (item.height || Math.abs(item.transform[3]) || 12) * RENDER_SCALE;

    const fontNameLower = (item.fontName || '').toLowerCase();
    let family = 'Arial';
    if (fontNameLower.includes('times') || fontNameLower.includes('serif') || fontNameLower.includes('roman')) {
      family = 'Times New Roman';
    } else if (fontNameLower.includes('courier') || fontNameLower.includes('mono')) {
      family = 'Courier New';
    }

    const bold = fontNameLower.includes('bold') || fontNameLower.includes('black');
    const italic = fontNameLower.includes('italic') || fontNameLower.includes('oblique');

    return {
      str: item.str,
      x: vx,
      y: vy - fHeight,
      w: item.width * RENDER_SCALE,
      h: fHeight,
      family,
      bold,
      italic,
      origPdfX: item.transform[4],
      origPdfY: item.transform[5],
      origPdfW: item.width,
      origPdfH: item.height || Math.abs(item.transform[3]) || 12
    };
  }).filter(Boolean);

  items.sort((a, b) => Math.abs(a.y - b.y) > 5 ? a.y - b.y : a.x - b.x);

  const lines = [];
  let cur = null;

  items.forEach(it => {
    if (!cur) {
      cur = { ...it, fullStr: it.str, pieces: [it] };
      return;
    }

    const sameLine = Math.abs(it.y - cur.y) < (cur.h * 0.5);
    const gap = it.x - (cur.x + cur.w);
    const adjacent = gap > -4 && gap < (cur.h * 1.6);

    if (sameLine && adjacent) {
      const space = gap > (cur.h * 0.15) && !cur.fullStr.endsWith(' ') && !it.str.startsWith(' ');
      cur.fullStr += (space ? ' ' : '') + it.str;
      cur.w = (it.x + it.w) - cur.x;
      cur.h = Math.max(cur.h, it.h);
      cur.pieces.push(it);
    } else {
      lines.push(cur);
      cur = { ...it, fullStr: it.str, pieces: [it] };
    }
  });
  if (cur) lines.push(cur);

  lines.forEach(line => {
    line.id = ++layerSequence;
    const el = document.createElement('div');
    el.className = 'detected-line';
    el.style.left = `${line.x - 2}px`;
    el.style.top = `${line.y - 1}px`;
    el.style.width = `${line.w + 4}px`;
    el.style.height = `${line.h + 2}px`;

    let startX = 0, startY = 0, startTime = 0;
    el.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      startY = e.clientY;
      startTime = Date.now();
    });

    el.addEventListener('pointerup', (e) => {
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      const duration = Date.now() - startTime;
      if (dist < 10 && duration < 400 && !isTwoFinger) {
        e.stopPropagation();
        e.preventDefault();
        openEditorForLine(line, el);
      }
    });

    textDetectLayer.appendChild(el);
  });
}

function getBackgroundColorAround(x, y) {
  try {
    const ctx = pdfCanvas.getContext('2d');
    const pixel = ctx.getImageData(Math.max(0, Math.floor(x - 5)), Math.max(0, Math.floor(y - 5)), 1, 1).data;
    return `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
  } catch (err) {
    return '#ffffff';
  }
}

// =========================================================
// MODO EDICIÓN DIRECTA
// =========================================================
btnModeEditText.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  isEditModeActive = !isEditModeActive;

  textDetectLayer.classList.toggle('interactive', isEditModeActive);
  btnModeEditText.classList.toggle('active-state', isEditModeActive);

  if (isEditModeActive) {
    statusBadge.textContent = '📝 Toca cualquier texto azul para editar';
  } else {
    statusBadge.textContent = 'Modo normal';
  }
});

function openEditorForLine(lineData, domElement) {
  currentTargetObject = { isOriginalLine: true, lineData, domElement };
  hidePrecisionTools();

  inlineEditorInput.value = lineData.fullStr;
  editorTitle.textContent = `✏️ Modificar Frase (Capa #${lineData.id})`;
  fontFamilySelect.value = lineData.family;
  isBoldActive = lineData.bold;
  isItalicActive = lineData.italic;
  fontSizeInput.value = Math.round(lineData.origPdfH);
  fontColorPicker.value = '#000000';

  btnToggleBold.classList.toggle('active', isBoldActive);
  btnToggleItalic.classList.toggle('active', isItalicActive);

  layerBadge.style.display = 'inline-block';
  layerBadge.textContent = `Capa #${lineData.id}`;

  inlineEditorCard.classList.add('visible');
  inlineEditorInput.focus();
}

function openEditorForTarget(target) {
  currentTargetObject = { isFabricObject: true, target };
  hidePrecisionTools();

  inlineEditorInput.value = target.text;
  editorTitle.textContent = `✏️ Modificar Texto (Capa #${target.layerNum || '--'})`;
  fontFamilySelect.value = target.fontFamily || 'Arial';
  isBoldActive = target.fontWeight === 'bold';
  isItalicActive = target.fontStyle === 'italic';
  fontSizeInput.value = Math.round(target.fontSize / RENDER_SCALE);
  fontColorPicker.value = target.fill || '#000000';

  btnToggleBold.classList.toggle('active', isBoldActive);
  btnToggleItalic.classList.toggle('active', isItalicActive);

  layerBadge.style.display = 'inline-block';
  layerBadge.textContent = `Capa #${target.layerNum || '--'}`;

  inlineEditorCard.classList.add('visible');
  inlineEditorInput.focus();
}

closeInlineEditor.addEventListener('click', () => {
  inlineEditorCard.classList.remove('visible');
  if (fabricCanvas && fabricCanvas.getActiveObject()) showPrecisionTools();
});

btnCenterText.addEventListener('click', () => {
  if (!fabricCanvas) return;
  const active = fabricCanvas.getActiveObject();
  if (active) {
    active.viewportCenterH();
    active.setCoords();
    fabricCanvas.renderAll();
    statusBadge.textContent = 'Texto centrado';
  }
});

// =========================================================
// AÑADIR NUEVO TEXTO
// =========================================================
btnAddText.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  hidePrecisionTools();

  currentTargetObject = { isNewText: true };
  inlineEditorInput.value = '';
  editorTitle.textContent = `🔤 Añadir Nuevo Texto (Capa #${layerSequence + 1})`;
  fontFamilySelect.value = 'Arial';
  isBoldActive = false;
  isItalicActive = false;
  btnToggleBold.classList.remove('active');
  btnToggleItalic.classList.remove('active');
  fontSizeInput.value = '16';
  fontColorPicker.value = '#000000';

  layerBadge.style.display = 'inline-block';
  layerBadge.textContent = `Capa #${layerSequence + 1}`;

  inlineEditorCard.classList.add('visible');
  inlineEditorInput.focus();
});

// =========================================================
// APLICAR CAMBIOS
// =========================================================
btnApplyText.addEventListener('click', () => {
  if (!currentTargetObject) return;
  const newStr = inlineEditorInput.value;
  if (!newStr.trim().length) {
    alert('Por favor escribe un texto.');
    return;
  }

  const chosenFamily = fontFamilySelect.value;
  const chosenBold = isBoldActive;
  const chosenItalic = isItalicActive;
  const chosenPtSize = parseInt(fontSizeInput.value, 10) || 16;
  const chosenColor = fontColorPicker.value;

  // CASO 1: TEXTO NUEVO
  if (currentTargetObject.isNewText) {
    const spawnX = Math.max(20, ((-panX + (window.innerWidth / 2)) / zoom) - 70);
    const spawnY = Math.max(20, ((-panY + (window.innerHeight / 2)) / zoom) - 15);

    const newTextObj = new fabric.Text(newStr, {
      left: spawnX,
      top: spawnY,
      fontSize: chosenPtSize * RENDER_SCALE,
      fontFamily: chosenFamily,
      fontWeight: chosenBold ? 'bold' : 'normal',
      fontStyle: chosenItalic ? 'italic' : 'normal',
      fill: chosenColor,
      selectable: true,
      hasControls: true,
      hasBorders: true
    });

    newTextObj.layerNum = ++layerSequence;
    fabricCanvas.add(newTextObj);
    fabricCanvas.setActiveObject(newTextObj);
    fabricCanvas.renderAll();

    pushHistoryAction({ type: 'FABRIC_ADD', object: newTextObj });
    inlineEditorCard.classList.remove('visible');
    statusBadge.textContent = `Capa #${newTextObj.layerNum} añadida`;
    showPrecisionTools();
    return;
  }

  // CASO 2: MODIFICAR TEXTO EXISTENTE EN FABRIC
  if (currentTargetObject.isFabricObject) {
    const obj = currentTargetObject.target;
    obj.set({
      text: newStr,
      fontFamily: chosenFamily,
      fontWeight: chosenBold ? 'bold' : 'normal',
      fontStyle: chosenItalic ? 'italic' : 'normal',
      fontSize: chosenPtSize * RENDER_SCALE,
      fill: chosenColor
    });
    obj.setCoords();
    fabricCanvas.renderAll();

    inlineEditorCard.classList.remove('visible');
    statusBadge.textContent = `Capa actualizada`;
    showPrecisionTools();
    return;
  }

  // CASO 3: MODIFICAR TEXTO ORIGINAL
  if (currentTargetObject.isOriginalLine) {
    const { lineData, domElement } = currentTargetObject;

    const ctx = pdfCanvas.getContext('2d');
    const padTop = lineData.h * 0.28;
    const padBottom = lineData.h * 0.38;
    const padX = 4;

    const boxX = Math.max(0, Math.floor(lineData.x - padX));
    const boxY = Math.max(0, Math.floor(lineData.y - padTop));
    const boxW = Math.ceil(lineData.w + (padX * 2));
    const boxH = Math.ceil(lineData.h + padTop + padBottom);

    const originalImageData = ctx.getImageData(boxX, boxY, boxW, boxH);
    const bgColor = getBackgroundColorAround(lineData.x, lineData.y);

    ctx.fillStyle = bgColor;
    ctx.fillRect(boxX, boxY, boxW, boxH);

    domElement.style.display = 'none';

    const newTextRender = new fabric.Text(newStr, {
      left: lineData.x,
      top: lineData.y,
      fontSize: chosenPtSize * RENDER_SCALE,
      fontFamily: chosenFamily,
      fontWeight: chosenBold ? 'bold' : 'normal',
      fontStyle: chosenItalic ? 'italic' : 'normal',
      fill: chosenColor,
      selectable: true,
      hasControls: true,
      hasBorders: true
    });

    newTextRender.layerNum = lineData.id;
    fabricCanvas.add(newTextRender);
    fabricCanvas.setActiveObject(newTextRender);
    fabricCanvas.renderAll();

    const patchRef = {
      originalLine: lineData,
      newText: newStr,
      fontFamily: chosenFamily,
      bold: chosenBold,
      italic: chosenItalic,
      fontSize: chosenPtSize,
      color: chosenColor,
      textRender: newTextRender
    };

    pagesData[currentPageNumber].patches.push(patchRef);

    pushHistoryAction({
      type: 'TEXT_EDIT',
      textRender: newTextRender,
      patchRef,
      eraseData: { imageData: originalImageData, bgColor, box: { x: boxX, y: boxY, w: boxW, h: boxH } }
    });

    inlineEditorCard.classList.remove('visible');
    statusBadge.textContent = `Capa #${lineData.id} editada`;
    showPrecisionTools();
  }
});

// =========================================================
// CRUCETA (D-PAD) MILIMÉTRICA PÍXEL A PÍXEL Y GRILLA
// =========================================================
function nudgeSelected(dx, dy) {
  if (!fabricCanvas) return;
  const active = fabricCanvas.getActiveObject();
  if (!active) return;

  active.left += dx;
  active.top += dy;
  active.setCoords();
  fabricCanvas.renderAll();
}

function bindDpad(btnId, dx, dy) {
  const btn = document.getElementById(btnId);
  let holdTimer, repeatTimer;

  const start = (e) => {
    e.preventDefault();
    nudgeSelected(dx, dy);
    holdTimer = setTimeout(() => {
      repeatTimer = setInterval(() => nudgeSelected(dx, dy), 50);
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

function showPrecisionTools() {
  if (!inlineEditorCard.classList.contains('visible')) {
    precisionTools.classList.add('visible');
  }
}

function hidePrecisionTools() {
  precisionTools.classList.remove('visible');
}

function onSelectionChanged(e) {
  const selected = e.selected ? e.selected[0] : fabricCanvas.getActiveObject();
  if (!selected) return;

  layerBadge.style.display = 'inline-block';
  layerBadge.textContent = `Capa #${selected.layerNum || '--'}`;

  if (selected.type === 'text') {
    btnEditSelected.disabled = false;
    statusBadge.textContent = `"${(selected.text || '').slice(0, 16)}..."`;
  } else {
    btnEditSelected.disabled = true;
    statusBadge.textContent = 'Elemento seleccionado';
  }

  showPrecisionTools();
}

function clearSelectionUI() {
  layerBadge.style.display = 'none';
  btnEditSelected.disabled = true;
  statusBadge.textContent = `${currentPageNumber} de ${totalPages}`;
  hidePrecisionTools();
}

btnEditSelected.addEventListener('click', () => {
  const active = fabricCanvas.getActiveObject();
  if (active && active.type === 'text') openEditorForTarget(active);
});

// =========================================================
// GUÍAS INTELIGENTES (SNAP TO CENTER)
// =========================================================
let showVerticalCenterGuide = false;
let showHorizontalCenterGuide = false;

function initSmartGuidelines(canvas) {
  const SNAP_THRESHOLD = 9;

  canvas.on('object:moving', (e) => {
    const obj = e.target;
    if (!obj) return;

    const centerPoint = obj.getCenterPoint();
    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;

    if (Math.abs(centerPoint.x - canvasCenterX) < SNAP_THRESHOLD) {
      obj.setPositionByOrigin(new fabric.Point(canvasCenterX, centerPoint.y), 'center', 'center');
      showVerticalCenterGuide = true;
    } else {
      showVerticalCenterGuide = false;
    }

    if (Math.abs(centerPoint.y - canvasCenterY) < SNAP_THRESHOLD) {
      obj.setPositionByOrigin(new fabric.Point(centerPoint.x, canvasCenterY), 'center', 'center');
      showHorizontalCenterGuide = true;
    } else {
      showHorizontalCenterGuide = false;
    }
  });

  canvas.on('after:render', () => {
    const ctx = canvas.getSelectionContext ? canvas.getSelectionContext() : (canvas.contextContainer || canvas.lowerCanvasEl.getContext('2d'));
    if (!ctx || (!showVerticalCenterGuide && !showHorizontalCenterGuide)) return;

    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ef4444';
    ctx.setLineDash([6, 4]);

    if (showVerticalCenterGuide) {
      const centerX = Math.round(canvas.width / 2);
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, canvas.height);
      ctx.stroke();
    }

    if (showHorizontalCenterGuide) {
      const centerY = Math.round(canvas.height / 2);
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(canvas.width, centerY);
      ctx.stroke();
    }

    ctx.restore();
  });

  canvas.on('object:modified', () => {
    showVerticalCenterGuide = false;
    showHorizontalCenterGuide = false;
    canvas.renderAll();
  });

  canvas.on('mouse:up', () => {
    showVerticalCenterGuide = false;
    showHorizontalCenterGuide = false;
    canvas.renderAll();
  });
}

// =========================================================
// OTRAS HERRAMIENTAS
// =========================================================
openToolsBtn.addEventListener('click', () => sheetBackdrop.classList.add('active'));
closeToolsBtn.addEventListener('click', () => sheetBackdrop.classList.remove('active'));
sheetBackdrop.addEventListener('click', (e) => {
  if (e.target === sheetBackdrop) sheetBackdrop.classList.remove('active');
});

btnWhiteout.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  const r = new fabric.Rect({
    left: (-panX + (window.innerWidth / 2)) / zoom,
    top: (-panY + (window.innerHeight / 2)) / zoom,
    width: 120 * RENDER_SCALE,
    height: 35 * RENDER_SCALE,
    fill: '#ffffff',
    stroke: '#cbd5e1',
    strokeWidth: 1
  });
  r.layerNum = ++layerSequence;
  fabricCanvas.add(r);
  fabricCanvas.setActiveObject(r);
  pushHistoryAction({ type: 'FABRIC_ADD', object: r });
});

let isDrawing = false;
btnDraw.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  isDrawing = !isDrawing;
  fabricCanvas.isDrawingMode = isDrawing;
  btnDraw.classList.toggle('active-state', isDrawing);
  statusBadge.textContent = isDrawing ? '✏️ Modo firma activo' : 'Documento listo';
});

imgInput.addEventListener('change', (e) => {
  sheetBackdrop.classList.remove('active');
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    fabric.Image.fromURL(ev.target.result, (img) => {
      img.scaleToWidth(140 * RENDER_SCALE);
      img.set({
        left: (-panX + (window.innerWidth / 2)) / zoom,
        top: (-panY + (window.innerHeight / 2)) / zoom
      });
      img.layerNum = ++layerSequence;
      fabricCanvas.add(img);
      fabricCanvas.setActiveObject(img);
      pushHistoryAction({ type: 'FABRIC_ADD', object: img });
    });
  };
  reader.readAsDataURL(f);
});

btnResetZoom.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  centerDocument(pdfCanvas.width, pdfCanvas.height);
});

// =========================================================
// EXPORTACIÓN A PDF COMPLETO (MULTIPÁGINA)
// =========================================================
function base64ToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binaryStr = window.atob(base64);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i);
  return bytes;
}

btnSave.addEventListener('click', async () => {
  sheetBackdrop.classList.remove('active');
  if (!originalPdfBytes) return;

  statusBadge.textContent = 'Guardando PDF...';

  try {
    const PDFLibEngine = await getSafePDFLib();
    const pdfDoc = await PDFLibEngine.PDFDocument.load(originalPdfBytes);

    const fonts = {
      sans: await pdfDoc.embedFont(PDFLibEngine.StandardFonts.Helvetica),
      sansBold: await pdfDoc.embedFont(PDFLibEngine.StandardFonts.HelveticaBold),
      serif: await pdfDoc.embedFont(PDFLibEngine.StandardFonts.TimesRoman),
      serifBold: await pdfDoc.embedFont(PDFLibEngine.StandardFonts.TimesRomanBold),
      mono: await pdfDoc.embedFont(PDFLibEngine.StandardFonts.Courier)
    };

    function mapFont(family, bold) {
      const fam = (family || '').toLowerCase();
      if (fam.includes('times') || fam.includes('serif')) return bold ? fonts.serifBold : fonts.serif;
      if (fam.includes('courier') || fam.includes('mono')) return fonts.mono;
      return bold ? fonts.sansBold : fonts.sans;
    }

    function hexToRgb(hex) {
      const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return res ? PDFLibEngine.rgb(parseInt(res[1], 16) / 255, parseInt(res[2], 16) / 255, parseInt(res[3], 16) / 255) : PDFLibEngine.rgb(0, 0, 0);
    }

    // Guardar estado de la página actual antes de compilar
    if (fabricCanvas && pagesData[currentPageNumber]) {
      pagesData[currentPageNumber].fabricObjectsJson = fabricCanvas.toJSON();
    }

    // Inyectar modificaciones en cada página del PDF
    for (let pNum = 1; pNum <= totalPages; pNum++) {
      const page = pdfDoc.getPage(pNum - 1);
      const { width: pW, height: pH } = page.getSize();
      const pData = pagesData[pNum];

      if (pData) {
        // Parches de texto editado
        for (const patch of pData.patches) {
          const line = patch.originalLine;
          const firstPiece = line.pieces[0];
          const totalW = line.pieces.reduce((sum, p) => sum + p.origPdfW, 0);

          page.drawRectangle({
            x: firstPiece.origPdfX - 2,
            y: firstPiece.origPdfY - (firstPiece.origPdfH * 0.38),
            width: Math.max(totalW, (line.w / RENDER_SCALE)) + 8,
            height: firstPiece.origPdfH * 1.55,
            color: PDFLibEngine.rgb(1, 1, 1)
          });

          if (patch.newText.trim().length > 0) {
            const font = mapFont(patch.fontFamily, patch.bold);
            const targetPdfX = patch.textRender.left / RENDER_SCALE;
            const targetPdfY = pH - (patch.textRender.top / RENDER_SCALE) - patch.fontSize;

            page.drawText(patch.newText, {
              x: targetPdfX,
              y: targetPdfY,
              size: patch.fontSize,
              font: font,
              color: hexToRgb(patch.color)
            });
          }
        }
      }
    }

    // Si la página activa tiene trazos/firmas dibujadas, estampar capa
    const activeObjects = fabricCanvas.getObjects().filter(o => o.type !== 'text');
    if (activeObjects.length > 0) {
      fabricCanvas.getObjects().forEach(o => { if (o.type === 'text') o.visible = false; });
      fabricCanvas.renderAll();

      const pngUrl = fabricCanvas.toDataURL({ format: 'png', multiplier: 1 / RENDER_SCALE });
      const imgBytes = base64ToUint8Array(pngUrl);
      const embeddedImg = await pdfDoc.embedPng(imgBytes);

      fabricCanvas.getObjects().forEach(o => { o.visible = true; });
      fabricCanvas.renderAll();

      const curPage = pdfDoc.getPage(currentPageNumber - 1);
      const { width: pW, height: pH } = curPage.getSize();
      curPage.drawImage(embeddedImg, { x: 0, y: 0, width: pW, height: pH });
    }

    const resultBytes = await pdfDoc.save();
    const blob = new Blob([resultBytes], { type: 'application/pdf' });
    const downloadUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = downloadUrl;
    a.download = 'documento_final.pdf';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    }, 2000);

    statusBadge.textContent = '¡PDF descargado con éxito!';
  } catch (err) {
    console.error(err);
    alert('Error al generar el PDF: ' + err.message);
    statusBadge.textContent = 'Error al descargar';
  }
});
